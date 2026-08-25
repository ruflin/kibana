/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SavedObjectsErrorHelpers, type Logger } from '@kbn/core/server';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { SavedObjectsClientContract } from '@kbn/core-saved-objects-api-server';
import type { RulesClientApi } from '@kbn/alerting-v2-plugin/server';
import {
  MAX_SIGNIFICANT_EVENTS_DATA_VIEWS,
  type SignificantEventsDataView,
} from '@kbn/significant-events-schema';
import { toFromQuery } from '../../../common';
import { StatusError } from '../errors/status_error';
import {
  SIGNIFICANT_EVENTS_DATA_VIEWS_SO_ID,
  SIGNIFICANT_EVENTS_DATA_VIEWS_SO_TYPE,
  type SignificantEventsDataViewsAttributes,
} from './saved_object';
import { isSystemEsqlView, toOwnedViewName } from './view_names';
import {
  deleteEsqlView,
  getDataStreams as fetchDataStreamsByName,
  getEsqlView,
  listDataStreams as fetchDataStreamNames,
  listEsqlViews,
  upsertEsqlView,
} from '../esql_views/manage_esql_views';
import { toStreamTag } from '../knowledge_indicators/knowledge_indicator_client/rules/rules_management_client';

const normalizeDataStreamNames = (dataStreams: string[]): string[] => {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of dataStreams) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    unique.push(name);
  }
  return unique;
};

export interface DataViewsService {
  list(): Promise<SignificantEventsDataView[]>;
  getEnabled(): Promise<SignificantEventsDataView[]>;
  getByName(name: string): Promise<SignificantEventsDataView | undefined>;
  listCatalog(): Promise<Array<{ name: string; query: string }>>;
  listDataStreams(): Promise<string[]>;
  addExisting(name: string): Promise<SignificantEventsDataView>;
  createOwned(params: {
    name: string;
    query: string;
    spaceId: string;
  }): Promise<SignificantEventsDataView>;
  createFromDataStreams(params: {
    name: string;
    dataStreams: string[];
    spaceId: string;
  }): Promise<SignificantEventsDataView>;
  setEnabled(name: string, enabled: boolean): Promise<SignificantEventsDataView>;
  remove(name: string): Promise<void>;
}

const emptyAttributes = (): SignificantEventsDataViewsAttributes => ({ views: [] });

const findViewIndex = (views: SignificantEventsDataView[], name: string): number =>
  views.findIndex((view) => view.name === name);

export const createDataViewsService = ({
  soClient,
  esClient,
  logger,
  alertingV2RulesClient,
}: {
  soClient: SavedObjectsClientContract;
  esClient: ElasticsearchClient;
  logger: Logger;
  alertingV2RulesClient?: RulesClientApi;
}): DataViewsService => {
  const readAttributes = async (): Promise<SignificantEventsDataViewsAttributes> => {
    try {
      const savedObject = await soClient.get<SignificantEventsDataViewsAttributes>(
        SIGNIFICANT_EVENTS_DATA_VIEWS_SO_TYPE,
        SIGNIFICANT_EVENTS_DATA_VIEWS_SO_ID
      );
      return savedObject.attributes;
    } catch (error) {
      if (SavedObjectsErrorHelpers.isNotFoundError(error as Error)) {
        return emptyAttributes();
      }
      throw error;
    }
  };

  const writeAttributes = async (
    attributes: SignificantEventsDataViewsAttributes
  ): Promise<void> => {
    await soClient.create<SignificantEventsDataViewsAttributes>(
      SIGNIFICANT_EVENTS_DATA_VIEWS_SO_TYPE,
      attributes,
      { id: SIGNIFICANT_EVENTS_DATA_VIEWS_SO_ID, overwrite: true }
    );
  };

  const setRulesEnabledForView = async (name: string, enabled: boolean): Promise<void> => {
    if (!alertingV2RulesClient) {
      return;
    }
    const tag = toStreamTag(name);
    const ids: string[] = [];
    let page = 1;
    while (true) {
      const result = await alertingV2RulesClient.findRules({
        filter: `metadata.tags: "${tag}"`,
        perPage: 500,
        page,
      });
      ids.push(...result.items.map((rule) => rule.id));
      if (result.items.length === 0 || ids.length >= result.total) {
        break;
      }
      page += 1;
    }
    if (ids.length === 0) {
      return;
    }
    if (enabled) {
      await alertingV2RulesClient.bulkEnableRules({ ids });
    } else {
      await alertingV2RulesClient.bulkDisableRules({ ids });
    }
  };

  const createOwned = async ({
    name,
    query,
    spaceId,
  }: {
    name: string;
    query: string;
    spaceId: string;
  }): Promise<SignificantEventsDataView> => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new StatusError('ES|QL query is required', 400);
    }

    const viewName = toOwnedViewName({ id: name, spaceId });
    const { views } = await readAttributes();
    if (findViewIndex(views, viewName) !== -1) {
      throw new StatusError(`View "${viewName}" is already configured`, 409);
    }
    if (views.length >= MAX_SIGNIFICANT_EVENTS_DATA_VIEWS) {
      throw new StatusError('Maximum number of data views reached', 400);
    }

    const existingEsView = await getEsqlView({ esClient, logger, name: viewName }).catch(
      () => undefined
    );
    if (existingEsView) {
      throw new StatusError(`ES|QL view "${viewName}" already exists`, 409);
    }

    try {
      await upsertEsqlView({ esClient, logger, name: viewName, query: trimmedQuery });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StatusError(`Could not create ES|QL view "${viewName}": ${message}`, 503);
    }

    const view: SignificantEventsDataView = {
      name: viewName,
      enabled: true,
      owned: true,
      query: trimmedQuery,
    };
    await writeAttributes({ views: [...views, view] });
    return view;
  };

  return {
    async list() {
      const { views } = await readAttributes();
      return views;
    },

    async getEnabled() {
      const views = await readAttributes();
      return views.views.filter((view) => view.enabled);
    },

    async getByName(name) {
      const { views } = await readAttributes();
      return views.find((view) => view.name === name);
    },

    async listCatalog() {
      const views = await listEsqlViews({ esClient, logger });
      return views.filter((view) => !isSystemEsqlView(view.name));
    },

    async listDataStreams() {
      return fetchDataStreamNames({ esClient, logger });
    },

    async addExisting(name) {
      const trimmed = name.trim();
      if (!trimmed) {
        throw new StatusError('View name is required', 400);
      }
      if (isSystemEsqlView(trimmed)) {
        throw new StatusError(`View "${trimmed}" cannot be used as a data source`, 400);
      }

      const { views } = await readAttributes();
      if (findViewIndex(views, trimmed) !== -1) {
        throw new StatusError(`View "${trimmed}" is already configured`, 409);
      }
      if (views.length >= MAX_SIGNIFICANT_EVENTS_DATA_VIEWS) {
        throw new StatusError('Maximum number of data views reached', 400);
      }

      let query: string | undefined;
      try {
        const existing = await getEsqlView({ esClient, logger, name: trimmed });
        query = existing.query;
      } catch {
        throw new StatusError(`ES|QL view "${trimmed}" was not found`, 404);
      }

      const view: SignificantEventsDataView = {
        name: trimmed,
        enabled: true,
        owned: false,
        query,
      };
      await writeAttributes({ views: [...views, view] });
      return view;
    },

    createOwned,

    async createFromDataStreams({ name, dataStreams, spaceId }) {
      const unique = normalizeDataStreamNames(dataStreams);
      if (unique.length === 0) {
        throw new StatusError('At least one data stream is required', 400);
      }

      for (const dataStream of unique) {
        if (dataStream.startsWith('.')) {
          throw new StatusError(`Data stream "${dataStream}" cannot be used as a data source`, 400);
        }
        if (dataStream.includes('*')) {
          throw new StatusError('Data stream names cannot contain wildcards', 400);
        }
      }

      let found: string[];
      try {
        found = await fetchDataStreamsByName({ esClient, names: unique });
      } catch {
        throw new StatusError(`One or more data streams were not found: ${unique.join(', ')}`, 404);
      }
      const foundSet = new Set(found);
      const missing = unique.filter((dataStream) => !foundSet.has(dataStream));
      if (missing.length > 0) {
        throw new StatusError(`Data streams not found: ${missing.join(', ')}`, 404);
      }

      return createOwned({
        name,
        query: toFromQuery(unique),
        spaceId,
      });
    },

    async setEnabled(name, enabled) {
      const { views } = await readAttributes();
      const index = findViewIndex(views, name);
      if (index === -1) {
        throw new StatusError(`View "${name}" is not configured`, 404);
      }
      const updated: SignificantEventsDataView = { ...views[index], enabled };
      const next = [...views];
      next[index] = updated;
      await writeAttributes({ views: next });
      await setRulesEnabledForView(name, enabled).catch((error) => {
        logger.warn(
          `Failed to ${enabled ? 'enable' : 'disable'} rules for view "${name}": ${error}`
        );
      });
      return updated;
    },

    async remove(name) {
      const { views } = await readAttributes();
      const index = findViewIndex(views, name);
      if (index === -1) {
        throw new StatusError(`View "${name}" is not configured`, 404);
      }
      const [removed] = views.splice(index, 1);
      if (removed.owned) {
        await deleteEsqlView({ esClient, logger, name: removed.name });
      }
      await writeAttributes({ views });
    },
  };
};
