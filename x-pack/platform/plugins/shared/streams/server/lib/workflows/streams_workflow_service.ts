/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, KibanaRequest, Logger } from '@kbn/core/server';
import type { WorkflowsExecutionEnginePluginStart } from '@kbn/workflows-execution-engine/server';
import type { WorkflowsServerPluginSetup as WorkflowsManagementPluginSetup } from '@kbn/workflows-management-plugin/server';
import type { WorkflowExecutionEngineModel } from '@kbn/workflows';
import { ExecutionStatus } from '@kbn/workflows';
import { TaskStatus } from '@kbn/streams-schema';
import type { TaskResult, IdentifyFeaturesResult } from '@kbn/streams-schema';
import { WORKFLOW_NAMES, WORKFLOW_YAMLS } from './definitions';
import type { WorkflowKey } from './definitions';
import type { StreamsPluginStartDependencies } from '../../types';

interface ExecutionMapping {
  executionId: string;
  createdAt: string;
}

type WorkflowManagementApi = WorkflowsManagementPluginSetup['management'];

export class StreamsWorkflowService {
  private executionMappings = new Map<string, ExecutionMapping>();
  private resolvedWorkflowIds = new Map<WorkflowKey, string>();
  private getStartServices: CoreSetup<StreamsPluginStartDependencies>['getStartServices'];
  private managementApi: WorkflowManagementApi;
  private logger: Logger;

  constructor(
    core: CoreSetup<StreamsPluginStartDependencies>,
    managementApi: WorkflowManagementApi,
    logger: Logger
  ) {
    this.getStartServices = core.getStartServices;
    this.managementApi = managementApi;
    this.logger = logger.get('workflow_service');
  }

  private async getExecutionEngine(): Promise<WorkflowsExecutionEnginePluginStart | undefined> {
    const [, pluginsStart] = await this.getStartServices();
    return pluginsStart.workflowsExecutionEngine;
  }

  public isAvailable(): boolean {
    return true;
  }

  private getMappingKey(streamName: string, workflowKey: WorkflowKey): string {
    return `${streamName}::${workflowKey}`;
  }

  private async findWorkflowByName(
    name: string,
    spaceId: string
  ): Promise<{ id: string; yaml: string } | null> {
    const result = await this.managementApi.getWorkflows(
      { query: name, size: 10, page: 1 },
      spaceId
    );
    const match = result.results.find((w) => w.name === name);
    if (!match) {
      return null;
    }
    const detail = await this.managementApi.getWorkflow(match.id, spaceId);
    if (!detail) {
      return null;
    }
    return { id: detail.id, yaml: detail.yaml };
  }

  /**
   * Ensures a workflow definition exists as a saved document. On first call for
   * each workflow key it creates (or updates) the saved workflow via the
   * management API so that it appears in the Workflows UI. The management API
   * owns ID generation (workflow-{uuid}); we look up by the YAML `name` field.
   */
  private async ensureWorkflow(
    workflowKey: WorkflowKey,
    request: KibanaRequest,
    spaceId: string
  ): Promise<WorkflowExecutionEngineModel> {
    const name = WORKFLOW_NAMES[workflowKey];
    const yaml = WORKFLOW_YAMLS[workflowKey];

    const cachedId = this.resolvedWorkflowIds.get(workflowKey);
    if (!cachedId) {
      try {
        const existing = await this.findWorkflowByName(name, spaceId);
        if (existing) {
          this.resolvedWorkflowIds.set(workflowKey, existing.id);
          if (existing.yaml !== yaml) {
            const result = await this.managementApi.updateWorkflow(
              existing.id,
              { yaml },
              spaceId,
              request
            );
            if (!result.valid) {
              this.logger.warn(
                `Workflow ${name} updated but has validation errors: ${result.validationErrors?.join(', ')}`
              );
            }
            this.logger.debug(`Updated workflow definition for ${name} (${existing.id})`);
          }
        } else {
          const created = await this.managementApi.createWorkflow({ yaml }, spaceId, request);
          this.resolvedWorkflowIds.set(workflowKey, created.id);
          this.logger.debug(`Created workflow definition for ${name} (${created.id})`);
        }
      } catch (error: unknown) {
        this.logger.error(
          `Failed to ensure workflow ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }

    const workflowId = this.resolvedWorkflowIds.get(workflowKey)!;
    const workflow = await this.managementApi.getWorkflow(workflowId, spaceId);
    if (!workflow) {
      this.resolvedWorkflowIds.delete(workflowKey);
      throw new Error(`Workflow ${name} (${workflowId}) not found after ensure`);
    }
    if (!workflow.definition) {
      this.resolvedWorkflowIds.delete(workflowKey);
      throw new Error(
        `Workflow ${name} (${workflowId}) has no valid definition. ` +
          `Check the workflow YAML for validation errors (valid=${workflow.valid}).`
      );
    }

    return {
      id: workflow.id,
      name: workflow.name,
      enabled: workflow.enabled,
      definition: workflow.definition,
      yaml: workflow.yaml,
    };
  }

  public async run(
    workflowKey: WorkflowKey,
    inputs: Record<string, unknown>,
    request: KibanaRequest,
    spaceId: string
  ): Promise<string> {
    const model = await this.ensureWorkflow(workflowKey, request, spaceId);

    const streamName = inputs.stream_name as string;
    const executionId = await this.managementApi.runWorkflow(
      model,
      spaceId,
      inputs,
      request,
      'streams-plugin',
      { streamName, workflowKey }
    );

    this.executionMappings.set(this.getMappingKey(streamName, workflowKey), {
      executionId,
      createdAt: new Date().toISOString(),
    });

    this.logger.debug(
      `Started workflow ${model.name} for stream ${streamName}, execution: ${executionId}`
    );

    return executionId;
  }

  public async cancel(
    streamName: string,
    workflowKey: WorkflowKey,
    spaceId: string
  ): Promise<void> {
    const engine = await this.getExecutionEngine();
    if (!engine) {
      throw new Error('Workflows execution engine is not available');
    }

    const mapping = this.executionMappings.get(this.getMappingKey(streamName, workflowKey));
    if (!mapping) {
      this.logger.debug(
        `No active execution found for stream ${streamName}, workflow ${workflowKey}`
      );
      return;
    }

    await engine.cancelWorkflowExecution(mapping.executionId, spaceId);
    this.logger.debug(
      `Canceled workflow execution ${mapping.executionId} for stream ${streamName}`
    );
  }

  public async getStatus(
    streamName: string,
    workflowKey: WorkflowKey,
    _spaceId: string
  ): Promise<TaskResult<IdentifyFeaturesResult>> {
    const mapping = this.executionMappings.get(this.getMappingKey(streamName, workflowKey));
    if (!mapping) {
      return { status: TaskStatus.NotStarted };
    }

    const [coreStart] = await this.getStartServices();
    const esClient = coreStart.elasticsearch.client.asInternalUser;

    try {
      const response = await esClient.get({
        index: '.workflows-executions',
        id: mapping.executionId,
      });

      const execution = response._source as {
        status: ExecutionStatus;
        error?: { message?: string } | null;
      };

      return this.mapExecutionStatusToTaskResult(execution);
    } catch (error: unknown) {
      const statusCode =
        (error as { statusCode?: number })?.statusCode ??
        (error as { meta?: { statusCode?: number } })?.meta?.statusCode;
      if (statusCode === 404) {
        return { status: TaskStatus.NotStarted };
      }
      throw error;
    }
  }

  private mapExecutionStatusToTaskResult(execution: {
    status: ExecutionStatus;
    error?: { message?: string } | null;
  }): TaskResult<IdentifyFeaturesResult> {
    switch (execution.status) {
      case ExecutionStatus.PENDING:
      case ExecutionStatus.RUNNING:
      case ExecutionStatus.WAITING:
        return { status: TaskStatus.InProgress };
      case ExecutionStatus.COMPLETED:
        return { status: TaskStatus.Completed, features: [] };
      case ExecutionStatus.FAILED:
        return {
          status: TaskStatus.Failed,
          error: execution.error?.message ?? 'Workflow execution failed',
        };
      case ExecutionStatus.CANCELLED:
        return { status: TaskStatus.Canceled };
      case ExecutionStatus.TIMED_OUT:
        return { status: TaskStatus.Failed, error: 'Workflow execution timed out' };
      case ExecutionStatus.SKIPPED:
        return { status: TaskStatus.Canceled };
      default:
        return { status: TaskStatus.NotStarted };
    }
  }
}
