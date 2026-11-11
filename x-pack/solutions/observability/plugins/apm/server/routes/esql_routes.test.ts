/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ApmDocumentType } from '../../common/document_type';
import { RollupInterval } from '../../common/rollup';
import { esqlResponse, toEsqlRequest } from '../utils/esql_test_helpers';
import { getAgentConfigEtagMetrics } from './settings/agent_configuration/get_agent_config_etag_metrics';
import { getAgentNameByService } from './settings/agent_configuration/get_agent_name_by_service';
import { getDownstreamServiceResource } from './assistant_functions/get_observability_alert_details_context/get_downstream_dependency_name';
import { getErrorRateChartsForDependency } from './dependencies/get_error_rate_charts_for_dependency';
import { getInfrastructureData } from './infrastructure/get_infrastructure_data';
import { getLatencyChartsForDependency } from './dependencies/get_latency_charts_for_dependency';
import { getMetadataForDependency } from './dependencies/get_metadata_for_dependency';
import { getServerlessFunctionsOverview } from './metrics/serverless/get_serverless_functions_overview';
import { getServerlessSummary } from './metrics/serverless/get_serverless_summary';
import { getServiceCorrelationFields } from './profiling/get_service_correlation_fields';
import { getServiceCount } from './observability_overview/get_service_count';
import { getThroughputChartsForDependency } from './dependencies/get_throughput_charts_for_dependency';
import { getActiveInstancesTimeseries } from './metrics/serverless/get_active_instances_timeseries';
import { hasOTelMetrics } from './metrics/has_otel_metrics';

const createClient = (...responses: Array<ReturnType<typeof esqlResponse>>) => {
  const esql = jest.fn().mockResolvedValue(esqlResponse([], []));
  responses.forEach((response) => esql.mockResolvedValueOnce(response));
  return { esql, apmEventClient: { esql } as any };
};

const queries = (esql: jest.Mock) =>
  esql.mock.calls.map(([operationName, params]) => {
    const { query, params: namedParams } = toEsqlRequest(params);
    return { operationName, query, params: namedParams };
  });

const range = { start: 0, end: 180_000, environment: 'prod', kuery: '' };

describe('ES|QL reads of the APM routes', () => {
  describe('dependency charts', () => {
    const dependency = {
      ...range,
      dependencyName: 'postgres',
      spanName: 'SELECT',
      searchServiceDestinationMetrics: true,
    };

    it('computes the latency of every bucket and leaves the empty ones as NaN', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['latency_sum', 'latency_count', 'bucket'], [[300, 3, 60_000]])
      );

      const { currentTimeseries: currentPeriod } = await getLatencyChartsForDependency({
        ...dependency,
        apmEventClient,
      });

      expect(currentPeriod.map(({ x }) => x)).toEqual([0, 60_000, 120_000, 180_000]);
      expect(currentPeriod[1].y).toBe(100);
      expect(currentPeriod[0].y).toBeNaN();
      expect(queries(esql)).toMatchSnapshot();
    });

    it('computes the failure rate of every bucket', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['total_count', 'failure_count', 'bucket'], [[4, 1, 0]])
      );

      const { currentTimeseries } = await getErrorRateChartsForDependency({
        ...dependency,
        apmEventClient,
      });

      expect(currentTimeseries[0].y).toBe(0.25);
      expect(queries(esql)).toMatchSnapshot();
    });

    it('counts the documents of spans when no service destination metrics are used', async () => {
      const { apmEventClient, esql } = createClient();

      await getErrorRateChartsForDependency({
        ...dependency,
        searchServiceDestinationMetrics: false,
        apmEventClient,
      });

      expect(queries(esql)[0].query).toContain('total_count = COUNT(*)');
    });

    it('turns the counts of a bucket into a rate per minute', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['total_count', 'bucket'], [[180, 0]])
      );

      const { currentTimeseries } = await getThroughputChartsForDependency({
        ...dependency,
        apmEventClient,
      });

      // 60 second buckets, so the count of a bucket is its rate per minute
      expect(currentTimeseries.slice(0, 2).map(({ y }) => y)).toEqual([180, 0]);
      expect(queries(esql)).toMatchSnapshot();
    });

    it('reads the type and subtype of the latest span of a dependency', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['span.type', 'span.subtype'], [['db', 'postgresql']])
      );

      const metadata = await getMetadataForDependency({
        apmEventClient,
        dependencyName: 'postgres',
        start: 0,
        end: 1,
      });

      expect(metadata).toEqual({ spanType: 'db', spanSubtype: 'postgresql' });
      expect(queries(esql)).toMatchSnapshot();
    });
  });

  describe('serverless metrics', () => {
    const serverless = { ...range, serviceName: 'svc' };

    it('counts the active instances of every bucket', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['active_instances', 'bucket'], [[2, 60_000]])
      );

      const timeseries = await getActiveInstancesTimeseries({
        ...serverless,
        serverlessId: 'fn',
        config: { metricsInterval: 60 } as never,
        apmEventClient,
      });

      expect(timeseries.map(({ y }) => y)).toEqual([0, 2, 0, 0]);
      expect(queries(esql)).toMatchSnapshot();
    });

    it('lists the functions with their averages', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(
          [
            'faas.id',
            'faas_duration_avg',
            'faas_billed_duration_avg',
            'cold_start_count',
            'max_total_memory',
            'avg_total_memory',
            'avg_free_memory',
          ],
          [['arn:aws:lambda:eu:123:function:fn', 10, 20, 3, 1000, 800, 300]]
        )
      );

      const functions = await getServerlessFunctionsOverview({ ...serverless, apmEventClient });

      expect(functions).toEqual([
        expect.objectContaining({
          serverlessFunctionName: 'fn',
          serverlessDurationAvg: 10,
          billedDurationAvg: 20,
          coldStartCount: 3,
          avgMemoryUsed: 500,
          memorySize: 1000,
        }),
      ]);
      expect(queries(esql)).toMatchSnapshot();
    });

    it('summarizes the functions in one row and counts the transactions apart', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(
          [
            'total_functions',
            'faas_duration_avg',
            'faas_billed_duration_avg',
            'avg_total_memory',
            'avg_free_memory',
            'count_invocations',
            'avg_compute_usage_bytes_ms',
            'architecture',
          ],
          [[2, 10, 20, 1000, 250, 4, 5, 'arm64']]
        ),
        esqlResponse(['transaction_count'], [[7]])
      );

      const summary = await getServerlessSummary({ ...serverless, apmEventClient });

      expect(summary).toEqual(
        expect.objectContaining({
          serverlessFunctionsTotal: 2,
          serverlessDurationAvg: 10,
          billedDurationAvg: 20,
          memoryUsageAvgRate: 0.75,
        })
      );
      expect(queries(esql)).toMatchSnapshot();
    });
  });

  describe('infrastructure and profiling fields', () => {
    it('lists the containers, hosts and pods of a service by number of documents', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['doc_count', 'container.id'], [[5, 'c1']]),
        esqlResponse(['doc_count', 'host.name'], [[5, 'h1']]),
        esqlResponse(['doc_count', 'kubernetes.pod.name'], [[5, 'p1']])
      );

      const data = await getInfrastructureData({
        ...range,
        serviceName: 'svc',
        agentName: 'java',
        apmEventClient,
      });

      expect(data).toEqual({ containerIds: ['c1'], hostNames: ['h1'], podNames: ['p1'] });
      expect(queries(esql)).toMatchSnapshot();
    });

    it('looks up the containers of the pods of an OpenTelemetry service', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['doc_count', 'container.id'], [[5, 'c1']]),
        esqlResponse(['doc_count', 'host.name'], [[5, 'h1']]),
        esqlResponse(['doc_count', 'k8s.pod.name'], [[5, 'p1']]),
        esqlResponse(['doc_count', 'container.id'], [[5, 'c2']])
      );

      const data = await getInfrastructureData({
        ...range,
        serviceName: 'svc',
        agentName: 'opentelemetry/java',
        apmEventClient,
      });

      expect(data.containerIds).toEqual(['c2']);
      expect(esql.mock.calls[3][1].skipProcessorEventFilter).toBe(true);
      expect(esql.mock.calls[3][1].filter.bool.filter).toContainEqual({
        terms: { 'k8s.pod.name': ['p1'] },
      });
    });

    it('merges the host names of the service', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['doc_count', 'host.hostname'], [[5, 'a']]),
        esqlResponse(['doc_count', 'host.name'], [[5, 'a']]),
        esqlResponse(['doc_count', 'container.id'], [[5, 'c1']]),
        esqlResponse([], [])
      );

      const fields = await getServiceCorrelationFields({
        ...range,
        serviceName: 'svc',
        documentType: ApmDocumentType.TransactionMetric,
        rollupInterval: RollupInterval.OneMinute,
        apmEventClient,
      });

      expect(fields).toEqual({ hostNames: ['a'], containerIds: ['c1'], workloadNames: ['svc'] });
      expect(queries(esql)).toMatchSnapshot();
    });
  });

  describe('probes and single values', () => {
    it('counts the distinct services', async () => {
      const { apmEventClient, esql } = createClient(esqlResponse(['service_count'], [[3]]));

      expect(
        await getServiceCount({
          apmEventClient,
          searchAggregatedTransactions: false,
          start: 0,
          end: 1,
        })
      ).toBe(3);
      expect(queries(esql)).toMatchSnapshot();
    });

    it('reads the agent name of a service', async () => {
      const { apmEventClient, esql } = createClient(esqlResponse(['agent.name'], [['java']]));

      expect(await getAgentNameByService({ serviceName: 'svc', apmEventClient })).toBe('java');
      expect(queries(esql)).toMatchSnapshot();
    });

    it('lists the etags the agents applied in the last 15 minutes', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['doc_count', 'labels.etag'], [[2, 'etag1']])
      );

      expect(await getAgentConfigEtagMetrics(apmEventClient, 'etag1')).toEqual(['etag1']);
      expect(queries(esql)).toMatchSnapshot();
    });

    it('reads the destination of the failed span of a trace', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['span.destination.service.resource'], [['postgres']])
      );

      expect(
        await getDownstreamServiceResource({ traceId: 't', start: 0, end: 1, apmEventClient })
      ).toBe('postgres');
      expect(queries(esql)).toMatchSnapshot();
    });

    it('finds out whether a service has OpenTelemetry process metrics', async () => {
      const { apmEventClient, esql } = createClient(
        esqlResponse(['@timestamp'], [['2024-01-01T00:00:00.000Z']])
      );

      expect(await hasOTelMetrics({ ...range, serviceName: 'svc', apmEventClient })).toBe(true);
      expect(queries(esql)).toMatchSnapshot();
    });
  });
});
