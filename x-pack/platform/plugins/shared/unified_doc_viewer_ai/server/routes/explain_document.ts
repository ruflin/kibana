/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import type { IRouter, Logger } from '@kbn/core/server';
import type { PluginStartContract as ActionsPluginStart } from '@kbn/actions-plugin/server';
import { EXPLAIN_DOCUMENT_API_ROUTE } from '../../common/constants';
import type {
  ExplainDocumentRequest,
  ExplainDocumentResponse,
} from '../../common/types';
import { LlmClient } from '../lib/llm_client';
import { getLlmConnectorId } from '../lib/get_llm_connector';
import { getSurroundingEvents } from '../lib/get_surrounding_events';

export function registerExplainDocumentRoute(
  router: IRouter,
  logger: Logger,
  getStartServices: () => Promise<{ actions: ActionsPluginStart; data: any }>
) {
  router.post(
    {
      path: EXPLAIN_DOCUMENT_API_ROUTE,
      validate: {
        body: schema.object({
          document: schema.recordOf(schema.string(), schema.any()),
          dataViewId: schema.maybe(schema.string()),
          includeContext: schema.maybe(schema.boolean()),
        }),
      },
      security: {
        authz: {
          enabled: false,
          reason: 'This route delegates authorization to the actions plugin',
        },
      },
    },
    async (context, request, response) => {
      try {
        logger.info('Received document explanation request');
        const { document, dataViewId, includeContext } = request.body as ExplainDocumentRequest;

        if (!document) {
          logger.error('No document provided in request');
          return response.badRequest({
            body: {
              message: 'Document is required',
            },
          });
        }

        logger.debug(`Document fields: ${Object.keys(document).join(', ')}`);

        // Get start services
        logger.debug('Getting start services...');
        const startServices = await getStartServices();
        const { actions } = startServices;

        // No license check - feature available to all

        // Get actions client
        logger.debug('Getting actions client...');
        const actionsClient = await actions.getActionsClientWithRequest(request);

        // Get LLM connector ID
        logger.debug('Finding LLM connector...');
        const connectorId = await getLlmConnectorId(actionsClient, logger);
        logger.info(`Using LLM connector: ${connectorId}`);

        // Get surrounding events if requested
        let surroundingEvents: any[] = [];
        if (includeContext) {
          logger.debug('Fetching surrounding events...');
          try {
            const esClient = (await context.core).elasticsearch.client.asCurrentUser;
            surroundingEvents = await getSurroundingEvents(
              esClient,
              document,
              dataViewId,
              logger
            );
            logger.info(`Found ${surroundingEvents.length} surrounding events`);
          } catch (error: any) {
            logger.warn(`Failed to fetch surrounding events: ${error.message}`);
            // Continue without context if query fails
          }
        }

        // Create LLM client and explain document
        logger.debug('Creating LLM client and explaining document...');
        const llmClient = new LlmClient(actionsClient, logger);
        const explanation = await llmClient.explainDocument(
          document,
          connectorId,
          surroundingEvents
        );

        logger.info('Document explanation completed successfully');
        const responseBody: ExplainDocumentResponse = explanation;

        return response.ok({
          body: responseBody,
        });
      } catch (error: any) {
        logger.error(`Error explaining document: ${error.message || error}`);
        logger.error(`Error stack: ${error.stack}`);

        if (error.message?.includes('No LLM connector found')) {
          return response.badRequest({
            body: {
              message: error.message,
            },
          });
        }

          return response.customError({
            statusCode: 500,
            body: {
              message: `Failed to explain document: ${error.message || 'Unknown error'}`,
            },
          });
      }
    }
  );
}

