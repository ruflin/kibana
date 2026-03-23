/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import dedent from 'dedent';
import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { platformStreamsSigEventsTools } from '@kbn/agent-builder-common';

const KNOWLEDGE_INDICATOR_TOOL_IDS = [
  platformStreamsSigEventsTools.searchKnowledgeIndicators,
  platformStreamsSigEventsTools.writeFeatureKnowledgeIndicator,
  platformStreamsSigEventsTools.writeQueryKnowledgeIndicator,
];

export const createKnowledgeIndicatorManagerSkill = () =>
  defineSkillType({
    id: 'observability.knowledge-indicator-manager',
    name: 'knowledge-indicator-manager',
    basePath: 'skills/observability',
    description:
      'Manages knowledge indicators (KIs) for streams: search existing feature and query KIs, and write new ones. Use when the user wants to explore, annotate, or enrich streams with domain knowledge about observed patterns, anomalies, or detection queries.',
    content: buildSkillContent(),
    getRegistryTools: () => KNOWLEDGE_INDICATOR_TOOL_IDS,
  });

function buildSkillContent(): string {
  return dedent(`
    ## Knowledge Indicator Manager Skill

    This skill manages Knowledge Indicators (KIs) for Elastic Streams. KIs are structured
    annotations that capture domain knowledge about a stream — either as observed feature
    patterns or as reusable ES|QL detection queries.

    ---

    ## Knowledge Indicator Types

    ### Feature KIs (\`kind: 'feature'\`)
    Feature KIs describe observed characteristics of a stream's data. They are stored in the
    stream's feature store (\`.kibana_streams_features\`).

    Examples:
    - A high error rate pattern detected in a service's logs
    - A recurring traffic anomaly on a specific stream
    - A dataset characteristic like "this stream contains structured JSON payloads"

    Key fields:
    - \`id\`: Stable identifier (e.g. \`high_error_rate_5xx\`)
    - \`type\`: Category (e.g. \`error_pattern\`, \`traffic_anomaly\`, \`dataset_characteristic\`)
    - \`description\`: What this feature represents and why it is significant
    - \`confidence\`: 0–100 score indicating how confident you are in this feature
    - \`properties\`: Arbitrary key-value data characterizing the feature

    ### Query KIs (\`kind: 'query'\`)
    Query KIs are ES|QL queries that detect significant events or conditions on a stream.
    They are stored in the stream's asset store (\`.kibana_streams_assets\`).

    Examples:
    - An ES|QL query that detects HTTP 5xx errors above a threshold
    - A query that finds slow database operations
    - A detection query for a known attack pattern

    Key fields:
    - \`query_id\`: Stable identifier (e.g. \`detect_high_5xx_rate\`)
    - \`title\`: Short human-readable title
    - \`esql.query\`: The ES|QL query (must include FROM and METADATA _id, _source)
    - \`severity_score\`: 0–100 severity aligned with anomaly detection scoring

    ---

    ## When to Use Each Tool

    ### \`search_knowledge_indicators\`
    Use to retrieve existing KIs for one or more streams. Always search first before writing
    to avoid creating duplicates. Use \`kind\` to filter by type and \`search_text\` for
    free-text matching.

    ### \`write_feature_knowledge_indicator\`
    Use when:
    - You have identified a meaningful pattern or characteristic in a stream's data
    - The user asks to annotate a stream with domain knowledge
    - You want to record an observed anomaly or feature for future reference

    Do NOT use for:
    - Creating detection queries (use \`write_query_knowledge_indicator\` instead)
    - Computed features managed by the feature identification pipeline

    ### \`write_query_knowledge_indicator\`
    Use when:
    - You have a specific ES|QL query that detects a condition on a stream
    - The user wants to save a detection query for reuse
    - You want to create a query-based KI that can be backed by an alerting rule

    Do NOT use for:
    - General feature annotations (use \`write_feature_knowledge_indicator\` instead)
    - Queries that do not target the stream's index pattern

    ---

    ## ES|QL Query Requirements for Query KIs

    Query KIs must follow these rules:
    1. The FROM clause must target the stream: \`FROM <stream_name>, <stream_name>.*\`
       - For wired streams: \`FROM logs.myapp, logs.myapp.*\`
       - For classic streams: \`FROM logs.myapp\` is also accepted
    2. METADATA must include both \`_id\` and \`_source\`:
       \`FROM logs.myapp, logs.myapp.* METADATA _id, _source\`
    3. The query must be valid ES|QL syntax

    Example valid query:
    \`\`\`esql
    FROM logs.myapp, logs.myapp.* METADATA _id, _source
    | WHERE http.response.status_code >= 500
    | STATS error_count = COUNT(*) BY service.name
    | WHERE error_count > 100
    \`\`\`

    ---

    ## Workflow Guidelines

    1. **Always search first**: Before writing a KI, use \`search_knowledge_indicators\` to
       check if a similar KI already exists. Avoid duplicates.

    2. **Choose the right type**: Use feature KIs for observed patterns; use query KIs for
       ES|QL-based detection logic.

    3. **Write operations require confirmation**: Both write tools require the user to confirm
       before the write is executed. This is by design — always explain what you are about to
       write before the confirmation prompt appears.

    4. **Use stable IDs**: The \`id\` (features) and \`query_id\` (queries) fields are used for
       upsert — re-using the same ID updates the existing KI. Choose descriptive, stable IDs.

    5. **Confidence and severity**: Set \`confidence\` (features) and \`severity_score\` (queries)
       based on the strength of evidence. Use 80–100 for well-evidenced patterns, 50–79 for
       moderate evidence, and below 50 for speculative observations.

    ---

    ## Example: Recording a Feature KI

    User: "I noticed that the logs.nginx stream has a lot of 404 errors from bots."

    Steps:
    1. Search existing KIs: \`search_knowledge_indicators({ stream_names: ['logs.nginx'], kind: ['feature'] })\`
    2. If no duplicate found, write the feature:
       \`\`\`
       write_feature_knowledge_indicator({
         stream_name: 'logs.nginx',
         id: 'bot_404_errors',
         type: 'error_pattern',
         title: 'High 404 rate from bots',
         description: 'The logs.nginx stream receives a high volume of 404 errors from automated bots, particularly targeting /wp-admin and /xmlrpc.php endpoints.',
         properties: { affected_paths: ['/wp-admin', '/xmlrpc.php'], source: 'bot_traffic' },
         confidence: 85,
         tags: ['bots', '404', 'nginx']
       })
       \`\`\`

    ## Example: Recording a Query KI

    User: "Save a query that detects when error rate exceeds 5% on logs.api."

    Steps:
    1. Search existing KIs: \`search_knowledge_indicators({ stream_names: ['logs.api'], kind: ['query'] })\`
    2. If no duplicate found, write the query:
       \`\`\`
       write_query_knowledge_indicator({
         stream_name: 'logs.api',
         query_id: 'high_error_rate_5pct',
         title: 'High error rate (>5%)',
         description: 'Detects when the HTTP error rate exceeds 5% of total requests on the logs.api stream.',
         esql: {
           query: 'FROM logs.api, logs.api.* METADATA _id, _source | STATS total = COUNT(*), errors = COUNT(*) WHERE http.response.status_code >= 500 | EVAL error_rate = errors / total * 100 | WHERE error_rate > 5'
         },
         severity_score: 75
       })
       \`\`\`
  `);
}
