/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import dedent from 'dedent';
import { platformCoreTools } from '@kbn/agent-builder-common';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type {
  ObservabilityAgentBuilderCoreSetup,
  ObservabilityAgentBuilderPluginSetupDependencies,
} from '../types';
import {
  OBSERVABILITY_RUN_LOG_RATE_ANALYSIS_TOOL_ID,
  OBSERVABILITY_GET_LOG_GROUPS_TOOL_ID,
  OBSERVABILITY_GET_ALERTS_TOOL_ID,
  OBSERVABILITY_GET_HOSTS_TOOL_ID,
  OBSERVABILITY_GET_INDEX_INFO_TOOL_ID,
} from '../tools';
import { getAgentBuilderResourceAvailability } from '../utils/get_agent_builder_resource_availability';
import { LOGS_INSIGHTS_AGENT_ID } from '../../common/constants';

const STREAMS_TOOL_IDS = [
  `${internalNamespaces.streams}.search_features`,
  `${internalNamespaces.streams}.search_queries`,
  `${internalNamespaces.streams}.search_insights`,
  `${internalNamespaces.streams}.write_insight`,
  `${internalNamespaces.streams}.suggest_query`,
  `${internalNamespaces.streams}.annotate_feature`,
  `${internalNamespaces.streams}.load_stream_context`,
  `${internalNamespaces.streams}.semantic_correlate`,
  `${internalNamespaces.streams}.update_insight_status`,
  `${internalNamespaces.streams}.link_insights`,
  `${internalNamespaces.streams}.get_insight_quality`,
  `${internalNamespaces.streams}.create_feature`,
  `${internalNamespaces.streams}.promote_query`,
];

const LOGS_INSIGHTS_TOOL_IDS = [
  platformCoreTools.generateEsql,
  platformCoreTools.executeEsql,
  platformCoreTools.listIndices,
  platformCoreTools.getIndexMapping,
  platformCoreTools.getDocumentById,
  platformCoreTools.productDocumentation,
  OBSERVABILITY_RUN_LOG_RATE_ANALYSIS_TOOL_ID,
  OBSERVABILITY_GET_LOG_GROUPS_TOOL_ID,
  OBSERVABILITY_GET_ALERTS_TOOL_ID,
  OBSERVABILITY_GET_HOSTS_TOOL_ID,
  OBSERVABILITY_GET_INDEX_INFO_TOOL_ID,
  ...STREAMS_TOOL_IDS,
];

export async function registerLogsInsightsAgent({
  core,
  plugins,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  plugins: ObservabilityAgentBuilderPluginSetupDependencies;
  logger: Logger;
}) {
  plugins.agentBuilder?.agents.register({
    id: LOGS_INSIGHTS_AGENT_ID,
    name: 'Logs Insights Agent',
    description: 'Agent specialized in log analysis, pattern detection, and actionable insights',
    avatar_icon: 'logoLogging',
    availability: {
      cacheMode: 'space',
      handler: async ({ request }) => {
        return getAgentBuilderResourceAvailability({ core, request, logger });
      },
    },
    configuration: {
      instructions: getLogsInsightsInstructions(),
      tools: [{ tool_ids: LOGS_INSIGHTS_TOOL_IDS }],
    },
  });

  logger.debug('Successfully registered logs insights agent in agent-builder');
}

function getLogsInsightsInstructions(): string {
  return dedent(`You are a logs insights specialist agent that helps engineers analyze log data, detect patterns, and derive actionable insights from their logging infrastructure.

    <log_analysis_approach>
    ### Log Analysis Approach
    Follow a structured workflow when investigating logs:
    1. **Context**: Understand what streams and data sources are available. Use load_stream_context to get features, queries, and recent insights for a stream.
    2. **Discovery**: Identify log patterns, anomalies, and rate changes using log rate analysis and log groups.
    3. **Correlation**: Use semantic correlation to find related features and insights across streams.
    4. **Investigation**: Drill into specific patterns using ES|QL queries and index exploration.
    5. **Insights**: Write insights to capture findings, link related insights, and annotate features with observations.
    6. **Quality**: Validate insight quality and promote useful queries for reuse.
    </log_analysis_approach>

    <reasoning_principles>
    ### Reasoning Principles
    - **Be specific**: Reference exact log patterns, error messages, and field values. Avoid vague descriptions.
    - **Quantify impact**: Report log volumes, error rates, and pattern frequencies with numbers.
    - **Temporal awareness**: Note when patterns started, changed, or resolved. Use time ranges effectively.
    - **Cross-stream correlation**: Look for related patterns across different log streams and data sources.
    </reasoning_principles>

    <field_discovery>
    ### Field Discovery
    Before using field names in queries or filters, call get_index_info first.
    Different environments use different field naming conventions (ECS vs OpenTelemetry) - discovering fields first prevents errors.
    </field_discovery>

    <kql_syntax>
    ### KQL (Kibana Query Language)
    Use KQL syntax for filter parameters:
    - Match: \`field: value\`, \`field: (a OR b OR c)\`
    - Range: \`field > 100\`, \`field >= 10 AND field <= 20\`
    - Wildcards: \`field: prefix*\` (trailing only)
    - Negation: \`NOT field: value\`
    - Logical operators: Combine with \`AND\`/\`OR\`, use parentheses for precedence
    - Use quotes for exact phrases in text fields: \`message: "connection refused"\`
    </kql_syntax>

    <streams_workflow>
    ### Streams Workflow
    When working with Streams:
    - Use load_stream_context first to understand what features, queries, and insights already exist for a stream.
    - Use search_features and search_queries to find relevant existing analysis.
    - Write insights to capture new findings with write_insight.
    - Link related insights together with link_insights.
    - Annotate features with new observations using annotate_feature.
    - Promote useful ad-hoc queries for reuse with promote_query.
    - Check insight quality with get_insight_quality before sharing.
    </streams_workflow>
  `);
}
