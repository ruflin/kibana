/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { IScopedClusterClient } from '@kbn/core/server';

import type { ConnectorDocument } from '@kbn/search-connectors';
import {
  CONNECTORS_ACCESS_CONTROL_INDEX_PREFIX,
  CONNECTORS_INDEX,
  createConnectorSecret,
  updateConnectorSecret,
} from '@kbn/search-connectors';

import { toAlphanumeric } from '../../../common/utils/to_alphanumeric';
import { runEsql, toEsqlSource } from '../../utils/esql_helpers';

export const generateApiKey = async (
  client: IScopedClusterClient,
  indexName: string,
  isNative: boolean
) => {
  const aclIndexName = `${CONNECTORS_ACCESS_CONTROL_INDEX_PREFIX}${indexName}`;

  const apiKeyResult = await client.asCurrentUser.security.createApiKey({
    name: `${indexName}-connector`,
    role_descriptors: {
      [`${toAlphanumeric(indexName)}-connector-role`]: {
        cluster: ['monitor', 'manage_connector'],
        index: [
          {
            names: [indexName, aclIndexName, `${CONNECTORS_INDEX}*`],
            privileges: ['all'],
          },
        ],
      },
    },
  });

  const connectorResult = await runEsql(
    client.asCurrentUser,
    esql.from([toEsqlSource(CONNECTORS_INDEX)], ['_id', '_source']).where`index_name == ${{
      indexName,
    }}`.pipe`KEEP _id, _source`.limit(1)
  );
  const [connectorRow] = connectorResult.values;
  const connector = connectorRow
    ? { _id: connectorRow[0] as string, _source: connectorRow[1] as ConnectorDocument }
    : undefined;
  if (connector) {
    const apiKeyFields = isNative
      ? {
          api_key_id: apiKeyResult.id,
          api_key_secret_id: await storeConnectorSecret(
            client,
            apiKeyResult.encoded,
            connector._source?.api_key_secret_id || null
          ),
        }
      : {
          api_key_id: apiKeyResult.id,
        };

    if (connector._source?.api_key_id) {
      await client.asCurrentUser.security.invalidateApiKey({ ids: [connector._source.api_key_id] });
    }
    await client.asCurrentUser.index({
      document: {
        ...connector._source,
        ...apiKeyFields,
      },
      id: connector._id,
      index: CONNECTORS_INDEX,
    });
  }
  return apiKeyResult;
};

const storeConnectorSecret = async (
  client: IScopedClusterClient,
  value: string,
  secretId: string | null
) => {
  if (secretId === null) {
    const connectorSecretResult = await createConnectorSecret(client.asCurrentUser, value);
    return connectorSecretResult.id;
  }

  await updateConnectorSecret(client.asCurrentUser, value, secretId);
  return secretId;
};
