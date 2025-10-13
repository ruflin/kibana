/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ActionsClient } from '@kbn/actions-plugin/server';
import type { DocumentExplanation } from '../../common/types';

const SYSTEM_PROMPT = `You are an expert log and document analyst. Your task is to analyze documents and provide clear, structured explanations.`;

const USER_PROMPT_TEMPLATE = (documentJson: string, surroundingEventsJson?: string) => {
  const basePrompt = `Analyze the following log/document and provide a structured explanation.

Document:
${documentJson}`;

  const contextPrompt = surroundingEventsJson
    ? `

Surrounding Events (for context):
The following events occurred before and after this document. Use them to better understand the sequence of events and context:
${surroundingEventsJson}

Note: These surrounding events come from the same resource/system and are ordered chronologically. Consider them when assessing urgency and proposing fixes.`
    : '';

  return `${basePrompt}${contextPrompt}

Provide your response as a JSON object with exactly these fields:
{
  "title": "A concise title (5-10 words) describing what this document represents",
  "summary": "A 1-2 sentence summary of the key information",
  "description": "A detailed explanation (3-5 sentences) of what this document means, including important field values and their significance",
  "urgency": "Rate the urgency level as 'low', 'medium', 'high', or 'critical' based on error severity, system impact, and potential risks",
  "proposedFix": "If urgency is 'high' or 'critical', provide a specific actionable fix or remediation steps (2-3 sentences). Consider the surrounding events if provided. If urgency is 'low' or 'medium', you can omit this field or set it to null.",
  "resources": {
    "service": "Extract the service name from fields like service.name, service, or similar",
    "host": "Extract the host name from fields like host.name, hostname, host, or similar",
    "container": "Extract the container ID/name from fields like container.id, container.name, or similar",
    "namespace": "Extract the namespace from fields like kubernetes.namespace, namespace, or similar",
    "cluster": "Extract the cluster name from fields like kubernetes.cluster.name, cluster, or similar"
  }
  Note: For resources, only include fields that are present in the document. Set values to null if not found. You may add other relevant resource identifiers if found in the document.
}

Respond ONLY with the JSON object, no other text.`;
};

export class LlmClient {
  constructor(
    private readonly actionsClient: ActionsClient,
    private readonly logger: Logger
  ) {}

  async explainDocument(
    document: Record<string, any>,
    connectorId: string,
    surroundingEvents: any[] = []
  ): Promise<DocumentExplanation> {
    try {
      this.logger.debug('Preparing document for LLM...');
      const documentJson = JSON.stringify(document, null, 2);
      
      // Add surrounding events if available
      const surroundingEventsJson = surroundingEvents.length > 0
        ? JSON.stringify(surroundingEvents, null, 2)
        : undefined;
      
      const userPrompt = USER_PROMPT_TEMPLATE(documentJson, surroundingEventsJson);
      
      if (surroundingEvents.length > 0) {
        this.logger.info(`Including ${surroundingEvents.length} surrounding events in analysis`);
      }

      this.logger.debug(`Calling LLM connector ${connectorId} for document explanation`);

      // Try invokeAI for .gen-ai connectors (like Azure OpenAI, Bedrock, etc.)
      let result = await this.actionsClient.execute({
        actionId: connectorId,
        params: {
          subAction: 'invokeAI',
          subActionParams: {
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
          },
        },
      });

      this.logger.debug(`Connector result status: ${result.status}`);
      this.logger.debug(`Connector result data: ${JSON.stringify(result.data)}`);

      if (result.status === 'error') {
        const errorMessage = result.message || result.serviceMessage || 'Unknown error';
        this.logger.error(`LLM connector error: ${errorMessage}`);
        this.logger.error(`Full error result: ${JSON.stringify(result)}`);
        throw new Error(
          `LLM connector execution failed: ${errorMessage}`
        );
      }

      // Extract the response from the connector result
      const responseContent = this.extractResponseContent(result);
      
      // Parse the JSON response
      const explanation = this.parseExplanation(responseContent);

      return explanation;
    } catch (error) {
      this.logger.error(`Failed to explain document: ${error}`);
      throw error;
    }
  }

  private truncateDocument(document: Record<string, any>): string {
    const jsonString = JSON.stringify(document, null, 2);
    const MAX_LENGTH = 100000; // ~100KB

    if (jsonString.length <= MAX_LENGTH) {
      return jsonString;
    }

    // Truncate and add indicator
    const truncated = jsonString.substring(0, MAX_LENGTH);
    return truncated + '\n... (document truncated due to size)';
  }

  private extractResponseContent(result: any): string {
    // Handle different response formats from various connector types
    if (result.data) {
      if (typeof result.data === 'string') {
        return result.data;
      }
      if (result.data.choices && Array.isArray(result.data.choices)) {
        // OpenAI-style response
        return result.data.choices[0]?.message?.content || '';
      }
      if (result.data.message) {
        return result.data.message;
      }
      if (result.data.completion) {
        return result.data.completion;
      }
    }

    throw new Error('Unable to extract response content from LLM result');
  }

  private parseExplanation(responseContent: string): DocumentExplanation {
    try {
      // Try to extract JSON from the response
      // Sometimes LLMs add extra text before/after the JSON
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : responseContent;

      const parsed = JSON.parse(jsonString);

      if (!parsed.title || !parsed.summary || !parsed.description || !parsed.urgency) {
        throw new Error('Response missing required fields');
      }

      // Clean up resources object - remove null/undefined values
      const resources = parsed.resources || {};
      const cleanedResources: Record<string, string> = {};
      for (const [key, value] of Object.entries(resources)) {
        if (value && value !== 'null' && value !== 'undefined') {
          cleanedResources[key] = String(value);
        }
      }

      return {
        title: String(parsed.title),
        summary: String(parsed.summary),
        description: String(parsed.description),
        urgency: parsed.urgency as 'low' | 'medium' | 'high' | 'critical',
        proposedFix: parsed.proposedFix ? String(parsed.proposedFix) : undefined,
        resources: cleanedResources,
      };
    } catch (error) {
      this.logger.error(`Failed to parse LLM response: ${error}`);
      
      // Return a fallback explanation if parsing fails
      return {
        title: 'Document Analysis',
        summary: 'Unable to parse the AI response into structured format.',
        description: responseContent.substring(0, 500),
        urgency: 'low',
        proposedFix: undefined,
        resources: {},
      };
    }
  }
}

