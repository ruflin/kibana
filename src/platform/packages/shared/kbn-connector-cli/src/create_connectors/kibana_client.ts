/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { KibanaConnection } from '@kbn/local-stack-connection';
import { kibanaFetch, resolveKibana } from '@kbn/local-stack-connection';
import type { ToolingLog } from '@kbn/tooling-log';

export type { KibanaConnection };

interface ConnectorPayload {
  connector_type_id: string;
  name: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

/**
 * Finds the local stateful or serverless Kibana, or the one given by `KIBANA_URL` /
 * `KIBANA_USERNAME` / `KIBANA_PASSWORD`.
 */
export const detectKibana = (log: ToolingLog): Promise<KibanaConnection> => resolveKibana({ log });

export async function listConnectors(
  connection: KibanaConnection
): Promise<Array<{ id: string; name: string; connector_type_id: string }>> {
  const response = await kibanaFetch(connection, '/api/actions/connectors');
  const data = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to list connectors (HTTP ${response.status}): ${data}`);
  }

  return JSON.parse(data);
}

export async function createConnector(
  connection: KibanaConnection,
  payload: ConnectorPayload
): Promise<{ id: string; name: string }> {
  const response = await kibanaFetch(connection, '/api/actions/connector', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await response.text();

  if (!response.ok) {
    throw new Error(
      `Failed to create connector "${payload.name}" (HTTP ${response.status}): ${data}`
    );
  }

  return JSON.parse(data);
}
