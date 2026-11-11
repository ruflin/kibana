/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import fs from 'fs';
import type { Logger, CoreSetup } from '@kbn/core/server';
import { type ElasticsearchClient } from '@kbn/core/server';
import type {
  IntervalSchedule,
  TaskManagerStartContract,
  TaskManagerSetupContract,
} from '@kbn/task-manager-plugin/server';
import { type ConcreteTaskInstance } from '@kbn/task-manager-plugin/server';
import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import axios from 'axios';
import https from 'https';
import type { ActionsConfig } from '../config';
import type { ConnectorUsageReport } from './types';
import type { ActionsPluginsStart } from '../plugin';

export const CONNECTOR_USAGE_REPORTING_TASK_SCHEDULE: IntervalSchedule = { interval: '1h' };
export const CONNECTOR_USAGE_REPORTING_TASK_ID = 'connector_usage_reporting';
export const CONNECTOR_USAGE_REPORTING_TASK_TYPE = `actions:${CONNECTOR_USAGE_REPORTING_TASK_ID}`;
export const CONNECTOR_USAGE_REPORTING_TASK_TIMEOUT = 30000;
export const CONNECTOR_USAGE_TYPE = `connector_request_body_bytes`;
export const CONNECTOR_USAGE_REPORTING_SOURCE_ID = `task-connector-usage-report`;
export const MAX_PUSH_ATTEMPTS = 5;

export class ConnectorUsageReportingTask {
  private readonly logger: Logger;
  private readonly eventLogIndex: string;
  private readonly projectId: string | undefined;
  private readonly caCertificate: string | undefined;
  private readonly usageApiUrl: string | undefined;
  private readonly enabled: boolean;

  constructor({
    logger,
    eventLogIndex,
    core,
    taskManager,
    projectId,
    config,
  }: {
    logger: Logger;
    eventLogIndex: string;
    core: CoreSetup<ActionsPluginsStart>;
    taskManager: TaskManagerSetupContract;
    projectId: string | undefined;
    config: ActionsConfig['usage'];
  }) {
    this.logger = logger;
    this.projectId = projectId;
    this.eventLogIndex = eventLogIndex;
    this.usageApiUrl = config?.url;
    this.enabled = config?.enabled ?? true;
    const caCertificatePath = config?.ca?.path;

    if (caCertificatePath && caCertificatePath.length > 0) {
      try {
        this.caCertificate = fs.readFileSync(caCertificatePath, 'utf8');
      } catch (e) {
        this.caCertificate = undefined;
        this.logger.error(
          `CA Certificate for the project "${projectId}" couldn't be loaded, Error: ${e.message}`
        );
      }
    }

    taskManager.registerTaskDefinitions({
      [CONNECTOR_USAGE_REPORTING_TASK_TYPE]: {
        title: 'Connector usage reporting task',
        timeout: '1m',
        createTaskRunner: ({ taskInstance }: { taskInstance: ConcreteTaskInstance }) => {
          return {
            run: async () => this.runTask(taskInstance, core),
            cancel: async () => {},
          };
        },
      },
    });
  }

  public start = async (taskManager?: TaskManagerStartContract) => {
    if (!this.projectId) {
      return;
    }
    if (!taskManager) {
      this.logger.error(
        `Missing required task manager service during start of ${CONNECTOR_USAGE_REPORTING_TASK_TYPE}`
      );
      return;
    }

    try {
      await taskManager.ensureScheduled({
        id: CONNECTOR_USAGE_REPORTING_TASK_ID,
        taskType: CONNECTOR_USAGE_REPORTING_TASK_TYPE,
        schedule: {
          ...CONNECTOR_USAGE_REPORTING_TASK_SCHEDULE,
        },
        state: {},
        params: {},
      });
    } catch (e) {
      this.logger.error(
        `Error scheduling task ${CONNECTOR_USAGE_REPORTING_TASK_TYPE}, received ${e.message}`
      );
    }
  };

  private runTask = async (taskInstance: ConcreteTaskInstance, core: CoreSetup) => {
    const { state } = taskInstance;

    if (!this.enabled) {
      this.logger.warn(
        `Usage API is disabled, ${CONNECTOR_USAGE_REPORTING_TASK_TYPE} will be skipped`
      );
      return {
        state,
      };
    }

    if (!this.projectId) {
      this.logger.warn(
        `Missing required project id while running ${CONNECTOR_USAGE_REPORTING_TASK_TYPE}, reporting task will be deleted`
      );
      return {
        state,
        shouldDeleteTask: true,
      };
    }

    if (!this.caCertificate) {
      this.logger.error(
        `Missing required CA Certificate while running ${CONNECTOR_USAGE_REPORTING_TASK_TYPE}`
      );
      return {
        state,
      };
    }

    if (!this.usageApiUrl) {
      this.logger.error(
        `Missing required Usage API url while running ${CONNECTOR_USAGE_REPORTING_TASK_TYPE}`
      );
      return {
        state,
      };
    }

    const [{ elasticsearch }] = await core.getStartServices();
    const esClient = elasticsearch.client.asInternalUser;

    const now = new Date();
    const oneDayAgo = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
    const lastReportedUsageDate: Date = state.lastReportedUsageDate
      ? new Date(state.lastReportedUsageDate)
      : oneDayAgo;

    let attempts: number = state.attempts || 0;

    const fromDate = lastReportedUsageDate;
    const toDate = now;

    let totalUsage = 0;
    try {
      totalUsage = await this.getTotalUsage({
        esClient,
        fromDate,
        toDate,
      });
    } catch (e) {
      this.logger.error(`Usage data could not be fetched. It will be retried. Error:${e.message}`);
      return {
        state: {
          lastReportedUsageDate,
          attempts,
        },
        runAt: now,
      };
    }

    const record: ConnectorUsageReport = this.createUsageRecord({
      totalUsage,
      fromDate,
      toDate,
      projectId: this.projectId,
    });

    this.logger.debug(`Record: ${JSON.stringify(record)}`);

    try {
      attempts = attempts + 1;
      await this.pushUsageRecord({ url: this.usageApiUrl, record });
      this.logger.info(
        `Connector usage record has been successfully reported, ${record.creation_timestamp}, usage: ${record.usage.quantity}, period:${record.usage.period_seconds}`
      );
    } catch (e) {
      if (attempts < MAX_PUSH_ATTEMPTS) {
        this.logger.error(
          `Usage data could not be pushed to usage-api. It will be retried (${attempts}). Error:${e.message}`
        );

        return {
          state: {
            lastReportedUsageDate,
            attempts,
          },
          runAt: this.getDelayedRetryDate({ attempts, now }),
        };
      }
      this.logger.error(
        `Usage data could not be pushed to usage-api. Stopped retrying after ${attempts} attempts. Error:${e.message}`
      );
      return {
        state: {
          lastReportedUsageDate,
          attempts: 0,
        },
      };
    }

    return {
      state: { lastReportedUsageDate: toDate, attempts: 0 },
    };
  };

  private getTotalUsage = async ({
    esClient,
    fromDate,
    toDate,
  }: {
    esClient: ElasticsearchClient;
    fromDate: Date;
    toDate: Date;
  }): Promise<number> => {
    // `SUM` of a long overflows to null in ES|QL, so the bytes are summed as doubles like the DSL sum did.
    const { query, params } = esql.from([this.eventLogIndex]).pipe`WHERE event.action == "execute"
      AND event.provider == "actions"
      AND kibana.action.execution.usage.request_body_bytes IS NOT NULL
      AND @timestamp > TO_DATETIME(${{ fromDate: fromDate.toISOString() }})
      AND @timestamp <= TO_DATETIME(${{ toDate: toDate.toISOString() }})`
      .pipe`STATS total_usage = SUM(TO_DOUBLE(kibana.action.execution.usage.request_body_bytes))`.toRequest();

    try {
      const usageResult = (await esClient.esql.query({
        query,
        params,
      } as EsqlQueryRequest)) as unknown as { values: unknown[][] };
      const totalUsage = usageResult.values[0]?.[0];
      return typeof totalUsage === 'number' ? totalUsage : 0;
    } catch (error) {
      // A wildcard that matches no event log index summed to 0 with the search API, and ES|QL
      // reports it as a 400 `verification_exception` ("Unknown index").
      if (isEsqlUnknownIndexError(error)) return 0;
      throw error;
    }
  };

  private createUsageRecord = ({
    totalUsage,
    fromDate,
    toDate,
    projectId,
  }: {
    totalUsage: number;
    fromDate: Date;
    toDate: Date;
    projectId: string;
  }): ConnectorUsageReport => {
    const period = Math.round((toDate.getTime() - fromDate.getTime()) / 1000);
    const toStr = toDate.toISOString();
    const timestamp = new Date(toStr);
    timestamp.setMinutes(0);
    timestamp.setSeconds(0);
    timestamp.setMilliseconds(0);

    return {
      id: `connector-request-body-bytes-${projectId}-${timestamp.toISOString()}`,
      usage_timestamp: toStr,
      creation_timestamp: toStr,
      usage: {
        type: CONNECTOR_USAGE_TYPE,
        period_seconds: period,
        quantity: totalUsage,
      },
      source: {
        id: CONNECTOR_USAGE_REPORTING_SOURCE_ID,
        instance_group_id: projectId,
      },
    };
  };

  private pushUsageRecord = async ({
    url,
    record,
  }: {
    url: string;
    record: ConnectorUsageReport;
  }) => {
    return axios.post(url, [record], {
      headers: { 'Content-Type': 'application/json' },
      timeout: CONNECTOR_USAGE_REPORTING_TASK_TIMEOUT,
      httpsAgent: new https.Agent({
        allowPartialTrustChain: true,
        ca: this.caCertificate,
      }),
    });
  };

  private getDelayedRetryDate = ({ attempts, now }: { attempts: number; now: Date }) => {
    const baseDelay = 60 * 1000;
    const delayByAttempts = baseDelay * attempts;

    const delayedTime = now.getTime() + delayByAttempts;

    return new Date(delayedTime);
  };
}

const isEsqlUnknownIndexError = (error: unknown): boolean => {
  const { statusCode, body } = (error ?? {}) as {
    statusCode?: number;
    body?: { error?: { type?: string; reason?: string } };
  };
  return (
    statusCode === 400 &&
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
};
