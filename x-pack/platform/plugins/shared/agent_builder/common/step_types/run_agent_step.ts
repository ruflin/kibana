/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import type { CommonStepDefinition } from '@kbn/workflows-extensions/common';
import { StepCategory } from '@kbn/workflows';
import { JsonModelSchema } from '@kbn/workflows/spec/schema/common/json_model_schema';
import { i18n } from '@kbn/i18n';
import {
  CONNECTOR_OR_INFERENCE_ID_CONFLICT_MESSAGE_WORKFLOW,
  normalizeOptionalConnectorOrInferenceParam,
} from '../resolve_connector_or_inference_id';

/**
 * Step type ID for the agentBuilder run agent step.
 */
export const RunAgentStepTypeId = 'ai.agent';

/**
 * Input schema for the run agent step.
 */
export const InputSchema = z.object({
  /**
   * output schema for the run agent step, if provided agent will return structured output
   */
  schema: JsonModelSchema.optional().describe('The schema for the output of the agent.'),
  /**
   * The user input message to send to the agent.
   */
  message: z.string().describe('The user input message to send to the agent.'),
  /**
   * Optional attachments to provide to the agent.
   */
  attachments: z
    .array(
      z
        .object({
          /**
           * Optional unique identifier for the attachment.
           */
          id: z.string().optional(),
          /**
           * Type of the attachment (e.g., "security.alert").
           */
          type: z.string(),
          /**
           * Data payload of the attachment, specific to the attachment type.
           * Required unless `origin` is provided.
           */
          data: z.record(z.string(), z.any()).optional(),
          /**
           * Origin string (e.g. saved object ID) for by-reference attachments; resolved at send time when `data` is omitted.
           */
          origin: z.string().optional(),
          /**
           * When true, the attachment will not be displayed in the UI.
           */
          hidden: z.boolean().optional(),
        })
        .refine((a) => a.data !== undefined || a.origin !== undefined, {
          message: 'Each attachment must include either data or origin',
        })
    )
    .optional()
    .describe('Optional attachments to provide to the agent.'),
  /**
   * Optional existing conversation id to continue a previous conversation.
   */
  conversation_id: z
    .string()
    .optional()
    .describe('Optional existing conversation ID to continue a previous conversation.'),
});

/**
 * Output schema for the run agent step.
 */
export const OutputSchema = z.object({
  message: z
    .string()
    .describe(
      'The text response from the agent. When schema is provided, contains a string version of the structured output'
    ),
  structured_output: z
    .any()
    .optional()
    .describe('The structured output from the agent. Only here when schema was provided'),
  conversation_id: z
    .string()
    .optional()
    .describe(
      'Conversation ID associated with this step execution. Present when create_conversation is enabled or conversation_id is provided.'
    ),
});

/**
 * Config schema for the run agent step.
 */
export const ConfigSchema = z
  .object({
    /**
     * The ID of the agent to chat with. Defaults to the default Elastic AI agent.
     */
    'agent-id': z
      .string()
      .optional()
      .describe('The ID of the agent to chat with. Defaults to the default Elastic AI agent.'),
    /**
     * The ID of the connector to use for model routing. Mutually exclusive with `inference-id`.
     */
    'connector-id': z
      .string()
      .optional()
      .describe(
        'The ID of the connector to use. Defaults to the default GenAI connector. Mutually exclusive with `inference-id`.'
      ),
    /**
     * Inference endpoint ID for model routing (alias for the same internal id as connector-id).
     */
    'inference-id': z
      .string()
      .optional()
      .describe(
        'The inference endpoint ID to use. Mutually exclusive with `connector-id`; defaults apply when both are omitted.'
      ),
    /**
     * When true, create/persist a conversation and associate it with the executing user.
     * If conversation_id is provided, this can auto-create the conversation with that id if it does not exist.
     */
    'create-conversation': z
      .boolean()
      .optional()
      .describe('When true, creates a conversation for the step.'),
    /**
     * Optional inline instructions that override the stored agent's instructions for this step only.
     * Forwarded as `configuration_overrides.instructions` and recorded on the resulting conversation
     * round, so the override is auditable from the conversation viewer.
     */
    instructions: z
      .string()
      .optional()
      .describe(
        "Inline instructions that override the agent's stored instructions for this step only. Recorded on the conversation round for audit."
      ),
    /**
     * Optional inline tool selection that overrides the stored agent's tool list for this step only.
     * Same shape as the `tools` field on an agent definition (`agent.yaml`). Forwarded as
     * `configuration_overrides.tools` and recorded on the resulting conversation round.
     */
    tools: z
      .array(
        z.object({
          tool_ids: z
            .array(z.string())
            .describe('List of tool IDs to expose. Use ["*"] to expose all tools.'),
        })
      )
      .optional()
      .describe(
        "Inline tool selection that overrides the agent's stored tool list for this step only. Recorded on the conversation round for audit."
      ),
    /**
     * When true, the conversation created by this step is hidden from the conversation list by
     * default. Hidden conversations remain accessible by ID and can be revealed via the
     * "Show hidden" toggle. Only meaningful with `create-conversation: true`.
     */
    hidden: z
      .boolean()
      .optional()
      .describe(
        'When true, the conversation created by this step is hidden from the conversation list by default. It remains accessible by ID and via the "Show hidden" toggle. Requires create-conversation: true.'
      ),
  })
  .superRefine((cfg, ctx) => {
    const connector = normalizeOptionalConnectorOrInferenceParam(cfg['connector-id']);
    const inference = normalizeOptionalConnectorOrInferenceParam(cfg['inference-id']);
    if (connector !== undefined && inference !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: CONNECTOR_OR_INFERENCE_ID_CONFLICT_MESSAGE_WORKFLOW,
        path: ['connector-id'],
      });
    }
    if (cfg.hidden === true && cfg['create-conversation'] !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`hidden: true` requires `create-conversation: true`.',
        path: ['hidden'],
      });
    }
  });

export type RunAgentStepInputSchema = typeof InputSchema;
export type RunAgentStepOutputSchema = typeof OutputSchema;
export type RunAgentStepConfigSchema = typeof ConfigSchema;

/**
 * Common step definition for RunAgent step.
 * This is shared between server and public implementations.
 * Input and output types are automatically inferred from the schemas.
 */
export const runAgentStepCommonDefinition: CommonStepDefinition<
  RunAgentStepInputSchema,
  RunAgentStepOutputSchema,
  RunAgentStepConfigSchema
> = {
  id: RunAgentStepTypeId,
  category: StepCategory.Ai,
  label: i18n.translate('xpack.agentBuilder.runAgentStep.label', {
    defaultMessage: 'Run Agent',
  }),
  description: i18n.translate('xpack.agentBuilder.runAgentStep.description', {
    defaultMessage:
      'Execute an AgentBuilder AI agent to process input and generate responses. Optionally provide a JSON schema to receive structured output.',
  }),
  documentation: {
    details: i18n.translate('xpack.agentBuilder.runAgentStep.documentation.details', {
      defaultMessage:
        'The agentBuilder.runAgent step allows you to invoke an AI agent within your workflow. The agent will process the input message and return a response, optionally using tools and maintaining conversation context. To receive structured output, provide a JSON schema that defines the expected response format.',
    }),
    examples: [
      `## Basic agent invocation
\`\`\`yaml
- name: run_agent
  type: ${RunAgentStepTypeId}
  with:
    message: "Analyze the following data and provide insights"
\`\`\``,

      `## Use a specific agent
\`\`\`yaml
- name: custom_agent
  type: ${RunAgentStepTypeId}
  agent-id: "my-custom-agent"
  with:
    message: "{{ workflow.input.message }}"
\`\`\``,

      `## Use an inference endpoint (mutually exclusive with connector-id)
\`\`\`yaml
- name: run_with_inference
  type: ${RunAgentStepTypeId}
  inference-id: "my-inference-endpoint-id"
  with:
    message: "Summarize the findings."
\`\`\``,

      `## Create a conversation and reuse it in a follow-up step
\`\`\`yaml
- name: initial_analysis
  type: ${RunAgentStepTypeId}
  agent-id: "my-custom-agent"
  create-conversation: true
  with:
    message: "Analyze the event and suggest next steps. {{ event | json }}"

- name: followup
  type: ${RunAgentStepTypeId}
  agent-id: "my-custom-agent"
  with:
    conversation_id: "{{ steps.initial_analysis.output.conversation_id }}"
    message: "Continue from the previous analysis and complete any missing steps."
\`\`\``,

      `## Get structured output using a JSON schema
\`\`\`yaml
- name: extract_person_data
  type: ${RunAgentStepTypeId}
  with:
    message: "Extract information about famous scientists from the text"
    schema:
      title: Person Array
      type: array
      items:
        title: Person
        type: object
        properties:
          name:
            type: string
            description: The person's first name
          surname:
            type: string
            description: The person's last name
          field:
            type: string
            description: Their field of study
        required:
          - name
          - surname
\`\`\`

When a schema is provided, the agent's response will be available in \`output.structured_output\` as a typed object, while \`output.message\` will contain a string representation of the structured output.`,

      `## Structured output with simple object schema
\`\`\`yaml
- name: analyze_sentiment
  type: ${RunAgentStepTypeId}
  with:
    message: "Analyze the sentiment of this customer feedback: {{ feedback }}"
    schema:
      type: object
      properties:
        sentiment:
          type: string
          enum: [positive, negative, neutral]
          description: Overall sentiment classification
        confidence:
          type: number
          description: Confidence score between 0 and 1
        key_phrases:
          type: array
          items:
            type: string
          description: Important phrases that influenced the sentiment
      required:
        - sentiment
        - confidence
\`\`\``,

      `## Override agent instructions and tools inline (per-step)
\`\`\`yaml
- name: investigate
  type: ${RunAgentStepTypeId}
  agent-id: "my-workflow-runner"
  create-conversation: true
  instructions: |
    You are a junior SRE. Triage the alerts and correlate them
    into incidents using shared infrastructure and temporal proximity.
  tools:
    - tool_ids: ["platform.core.execute_esql"]
    - tool_ids: ["observability.get_logs"]
  with:
    message: "{{ event | json }}"
\`\`\`

The \`instructions\` and \`tools\` fields override the stored agent's configuration for this step only. They are persisted as \`configuration_overrides\` on the resulting conversation round, so the override is auditable from the conversation viewer.`,

      `## Hide the resulting conversation from the chat history
\`\`\`yaml
- name: workflow_run
  type: ${RunAgentStepTypeId}
  create-conversation: true
  hidden: true
  instructions: "You are a concise log analyst."
  tools:
    - tool_ids: ["platform.core.execute_esql"]
  with:
    message: "Summarise the last 10 logs."
\`\`\`

When \`hidden: true\` is set, the conversation is excluded from the default conversation list so machine-driven (workflow) runs do not pollute the user's chat history. It remains accessible by ID — via deep links, the workflow step output, or the "Show hidden" toggle in the conversation sidebar — so the full trace is still available for debugging. Requires \`create-conversation: true\`.`,
    ],
  },
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
