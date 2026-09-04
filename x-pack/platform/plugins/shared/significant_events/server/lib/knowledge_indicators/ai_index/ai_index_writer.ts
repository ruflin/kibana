/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { StoredKnowledgeIndicator } from '../data_stream';
import { NIGHTSHIFT_AI_INDEX_DEST } from './constants';
import {
  toAiIndexDeleteOperations,
  toAiIndexKiOperations,
  type AiIndexKiOperation,
} from './to_ai_index_ki';

export interface AiIndexWriter {
  project(docs: StoredKnowledgeIndicator[]): Promise<void>;
  projectDeletes(docs: StoredKnowledgeIndicator[]): Promise<void>;
}

const toBulkOperations = (operations: AiIndexKiOperation[]): object[] => {
  const bulkOperations: object[] = [];
  for (const operation of operations) {
    if (operation.action === 'delete') {
      bulkOperations.push({ delete: { _index: NIGHTSHIFT_AI_INDEX_DEST, _id: operation.id } });
      continue;
    }
    bulkOperations.push({ index: { _index: NIGHTSHIFT_AI_INDEX_DEST, _id: operation.id } });
    bulkOperations.push(operation.document);
  }
  return bulkOperations;
};

/** Best-effort projector that upserts Nightshift KIs into the AI Index dest. */
export const createAiIndexWriter = ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): AiIndexWriter => {
  let destReady: Promise<void> | undefined;

  const ensureDest = (): Promise<void> => {
    destReady ??= esClient.indices
      .create({ index: NIGHTSHIFT_AI_INDEX_DEST }, { ignore: [400] })
      .then(() => undefined)
      .catch((error) => {
        destReady = undefined;
        throw error;
      });
    return destReady;
  };

  const write = async (operations: AiIndexKiOperation[]): Promise<void> => {
    if (operations.length === 0) {
      return;
    }

    await ensureDest();
    const response = await esClient.bulk({
      refresh: 'wait_for',
      operations: toBulkOperations(operations),
    });
    if (response.errors) {
      const failed = response.items.filter(
        (item) => item.index?.error !== undefined || item.delete?.error !== undefined
      ).length;
      logger.warn(
        `AI index projection wrote with errors: ${failed}/${operations.length} operations failed for ${NIGHTSHIFT_AI_INDEX_DEST}`
      );
    }
  };

  return {
    async project(docs: StoredKnowledgeIndicator[]): Promise<void> {
      await write(toAiIndexKiOperations(docs));
    },
    async projectDeletes(docs: StoredKnowledgeIndicator[]): Promise<void> {
      await write(toAiIndexDeleteOperations(docs));
    },
  };
};
