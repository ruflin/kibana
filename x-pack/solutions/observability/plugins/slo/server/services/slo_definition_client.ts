/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { SUMMARY_DESTINATION_INDEX_PATTERN } from '../../common/constants';
import { IllegalArgumentError } from '../errors';
import type { SLODefinition } from '../domain/models';
import type { SLODefinitionRepository } from './slo_definition_repository';
import type { EsSummaryDocument } from './summary_transform_generator/helpers/create_temp_summary';
import { runEsqlRows } from './utils/esql_read';
import { fromRemoteSummaryDocumentToSloDefinition } from './unsafe_federated/remote_summary_doc_to_slo';

interface SLODefinitionResult {
  slo: SLODefinition;
  remote?: {
    kibanaUrl: string;
    remoteName: string;
  };
}

// `remoteName` comes from the request and is printed into the ES|QL `FROM` command as it is.
// A remote cluster alias is letters, digits, `-` and `_`, and does not start with `-` or `_`.
const REMOTE_CLUSTER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/;

export class SLODefinitionClient {
  constructor(
    private repository: SLODefinitionRepository,
    private esClient: ElasticsearchClient,
    private logger: Logger
  ) {}

  public async execute(
    sloId: string,
    spaceId: string,
    remoteName?: string
  ): Promise<SLODefinitionResult> {
    if (remoteName) {
      if (!REMOTE_CLUSTER_NAME.test(remoteName)) {
        throw new IllegalArgumentError(`Invalid remote cluster name: ${remoteName.slice(0, 80)}`);
      }
      const summaryRows = await runEsqlRows({
        esClient: this.esClient,
        ignoreUnknownIndex: true,
        query: esql.from([`${remoteName}:${SUMMARY_DESTINATION_INDEX_PATTERN}`], ['_source'])
          .pipe`WHERE spaceId == ${{ spaceId }} AND slo.id == ${{ sloId }}`.limit(1),
      });

      if (summaryRows.length === 0) {
        throw new Error(
          `Remote SLO [id=${sloId}, spaceId=${spaceId}, remoteName=${remoteName}] not found`
        );
      }

      const doc = summaryRows[0]._source as EsSummaryDocument;
      const remoteSloDefinition = fromRemoteSummaryDocumentToSloDefinition(doc, this.logger);
      if (!remoteSloDefinition) {
        throw new Error(
          `Remote SLO [id=${sloId}, spaceId=${spaceId}, remoteName=${remoteName}] is invalid`
        );
      }

      return { slo: remoteSloDefinition, remote: { kibanaUrl: doc.kibanaUrl ?? '', remoteName } };
    }

    const localSloDefinition = await this.repository.findById(sloId);
    return { slo: localSloDefinition };
  }
}
