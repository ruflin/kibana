/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { EXTRACT_FEATURES_TOOL_ID } from '../tools/extract_features_tool';
import { UPSERT_FEATURES_TOOL_ID } from '../tools/upsert_features_tool';

export const extractStreamFeaturesSkill = defineSkillType({
  id: 'streams-extract-features',
  name: 'extract-stream-features',
  basePath: 'skills/streams',
  description:
    'Extract and persist stream features (systems, components, log patterns, error types, dataset statistics) from a named stream. Use when the user asks to extract features, identify features, analyze a stream for features, refresh features, or save features they have described.',
  content: `## Stream features

Use this skill when the user asks to extract, identify, refresh, or save features for a stream.

**Critical — do not use attachments:** Both tools persist features to the **streams feature store** (backend storage for the Streams app). You must NEVER call \`attachment_add\` or \`attachment_update\` to store the result of these tools. Persistence is already done by the tool. Calling the attachment tool will fail (e.g. type not supported) and confuses the user. When reporting to the user, say the features were "saved to the stream's feature store" or "persisted to the feature store for stream X" — never say "persisted as an attachment" or "stored as a text attachment".

### Choosing the right tool

**Use \`${EXTRACT_FEATURES_TOOL_ID}\`** when the user wants automatic pipeline-based extraction:
- "Extract features from stream A"
- "Identify features in logs-myapp-default"
- "Analyze stream X for features"
- "Refresh features for stream Y"

The tool samples documents from the stream, runs AI analysis, and persists everything automatically.

**Use \`${UPSERT_FEATURES_TOOL_ID}\`** when you have already composed features yourself (from your own analysis, other tool results, or user descriptions) and want to save them:
- "Save this feature I described"
- "Persist the features you found"
- After analyzing data with ES|QL or search tools and identifying features manually

---

### \`${EXTRACT_FEATURES_TOOL_ID}\`

**Required:** \`streamName\`

**Optional:** \`from\` / \`to\` (ISO 8601 time range, default last 24h), \`connectorId\`

**Returns:** \`{ featuresExtracted, features: [{ id, type, title, description }] }\`

Tell the user how many features were extracted and that they are saved in the stream's feature store (visible in the Streams app). Do not call the attachments tool.

---

### \`${UPSERT_FEATURES_TOOL_ID}\`

**Required:** \`streamName\`, \`features[]\`

Each feature requires:
- \`id\`: stable unique identifier (e.g. \`"nginx-access-logs"\`)
- \`type\`: category (e.g. \`"system"\`, \`"component"\`, \`"service"\`, \`"log_pattern"\`)
- \`description\`: what this feature represents
- \`properties\`: key-value pairs that identify it (e.g. \`{ "service.name": "nginx" }\`) — must have at least one entry
- \`confidence\`: 0–100

Optional per feature: \`subtype\`, \`title\`, \`evidence\`, \`tags\`, \`meta\`

**Returns:** \`{ featuresUpserted, features: [{ id, type, title, description }] }\`

Tell the user how many features were saved to the stream's feature store and list them briefly. Do not call the attachments tool — the tool already persisted to the feature store.

---

### Do not use attachments

- Do NOT call \`attachment_add\` or \`attachment_update\` after these tools. The result is already persisted to the feature store.
- Valid attachment types (e.g. \`text\`) are for other use cases. Streams feature results must not be stored as attachments.
- If you previously tried to "persist as text attachment" or "json type is not supported", that was incorrect — the tool already persisted to the feature store.

### Error handling

On error either tool returns an error message. Surface it clearly and suggest corrective action:
- Stream not found → check the stream name
- Feature not enabled / license → enable the Significant Events feature or check license
- No AI connector → configure a default AI connector in settings
`,
  getRegistryTools: () => [EXTRACT_FEATURES_TOOL_ID, UPSERT_FEATURES_TOOL_ID],
});
