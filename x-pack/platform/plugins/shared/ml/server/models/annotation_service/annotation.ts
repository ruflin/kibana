/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import Boom from '@hapi/boom';
import { omit } from 'lodash';
import type { IScopedClusterClient } from '@kbn/core/server';

import type { estypes } from '@elastic/elasticsearch';
import { esql } from '@elastic/esql';
import { ML_PARTITION_FIELDS } from '@kbn/ml-anomaly-utils';

import type { Annotation, Annotations } from '@kbn/ml-common-types/annotations';
import {
  isAnnotation,
  isAnnotations,
  getAnnotationFieldName,
  getAnnotationFieldValue,
} from '@kbn/ml-common-types/annotations';
import type { JobId } from '@kbn/ml-common-types/anomaly_detection_jobs/job';
import {
  ML_ANNOTATIONS_INDEX_ALIAS_READ,
  ML_ANNOTATIONS_INDEX_ALIAS_WRITE,
} from '../../../common/constants/index_patterns';
import { ANNOTATION_EVENT_USER, ANNOTATION_TYPE } from '../../../common/constants/annotations';
import { DEFAULT_ML_PROJECT_ROUTING } from '../../../common/constants/cps';
import { isJobIdValid } from '../../../common/util/job_utils';
import type { MlClient } from '../../lib/ml_client/types';
import type { ServerlessInfo } from '../../types';
import { esqlRows, runEsql } from '../../lib/esql/esql_read';

// TODO All of the following interface/type definitions should
// eventually be replaced by the proper upstream definitions
export interface IndexAnnotationArgs {
  jobIds: string[];
  earliestMs: number | null;
  latestMs: number | null;
  maxAnnotations: number;
  detectorIndex?: number;
  entities?: any[];
  event?: Annotation['event'];
}

export interface GetResponse {
  success: true;
  annotations: Record<JobId, Annotations>;
  totalCount: number;
}

export interface IndexParams {
  index: string;
  body: Annotation;
  refresh: boolean | 'wait_for' | undefined;
  require_alias?: boolean;
  id?: string;
}

export interface DeleteParams {
  index: string;
  refresh: boolean | 'wait_for' | undefined;
  id: string;
}

export interface AggByJob {
  key: string;
  doc_count: number;
  latest_delayed: Pick<estypes.SearchResponse<Annotation>, 'hits'>;
}

export function annotationProvider(
  { asInternalUser }: IScopedClusterClient,
  mlClient: MlClient,
  serverless: ServerlessInfo
) {
  /**
   * Checks the user has access to the given job(s).
   * Each ID is validated individually so a missing companion ID cannot bypass
   * access checks for other (real, inaccessible) jobs in a multi-ID request.
   * The job may not exist if it was deleted but its annotations were not deleted.
   */
  async function checkJobAccess(jobIds: string | string[]) {
    const ids = (Array.isArray(jobIds) ? jobIds : jobIds.split(',')).map((id) => id.trim());

    if (ids.length === 0 || ids.some((id) => isJobIdValid(id) === false)) {
      throw Boom.badRequest('No valid job IDs provided');
    }

    for (const jobId of ids) {
      try {
        await mlClient.getJobs({ job_id: jobId });
      } catch (error) {
        let jobExists = false;
        try {
          await asInternalUser.ml.getJobs({ job_id: jobId });
          jobExists = true;
        } catch (existsError) {
          // Only treat a genuine "not found" as a missing job; any other error
          // (transient ES failure, etc.) must not silently bypass the access check.
          if (existsError.statusCode !== 404) {
            throw existsError;
          }
          // Job is missing — proceed for this ID only
        }

        if (jobExists) {
          // Job exists but the user does not have access to it
          throw error;
        }
      }
    }
  }

  async function getAnnotationById(id: string): Promise<{ annotation: Annotation; index: string }> {
    const response = await runEsql({
      esClient: asInternalUser,
      query: esql.from([ML_ANNOTATIONS_INDEX_ALIAS_READ], ['_id', '_index', '_source'])
        .pipe`WHERE _id == ${{ id }}`
        .keep('_id', '_index', '_source')
        .limit(1),
    });
    const hit = esqlRows(response)[0];

    if (hit === undefined) {
      throw Boom.notFound(`Cannot find annotation with ID ${id}`);
    }

    const source = hit._source as Annotation | undefined;
    const annotation: Annotation = {
      ...source,
      event: source?.event ?? ANNOTATION_EVENT_USER,
      _id: hit._id as string,
    } as Annotation;

    if (isAnnotation(annotation) === false) {
      throw new Error('invalid annotation format');
    }

    await checkJobAccess(annotation.job_id);

    return { annotation, index: hit._index as string };
  }

  async function indexAnnotation(annotation: Annotation, username: string) {
    if (isAnnotation(annotation) === false) {
      // No need to translate, this will not be exposed in the UI.
      return Promise.reject(new Error('invalid annotation format'));
    }

    await checkJobAccess(annotation.job_id);

    if (annotation.create_time === undefined) {
      annotation.create_time = new Date().getTime();
      annotation.create_username = username;
    }

    annotation.modified_time = new Date().getTime();
    annotation.modified_username = username;

    const params: IndexParams = {
      index: ML_ANNOTATIONS_INDEX_ALIAS_WRITE,
      body: annotation,
      refresh: 'wait_for',
      require_alias: true,
      ...(serverless.isServerless && serverless.cpsEnabled
        ? { project_routing: DEFAULT_ML_PROJECT_ROUTING }
        : {}),
    };

    if (typeof annotation._id !== 'undefined') {
      params.id = annotation._id;
      params.index = (await getAnnotationById(annotation._id)).index;
      params.require_alias = false;
      delete params.body._id;
      delete params.body.key;
    }

    return await asInternalUser.index(params, { maxRetries: 0 });
  }

  async function getAnnotations({
    jobIds,
    earliestMs,
    latestMs,
    maxAnnotations,
    detectorIndex,
    entities,
    event,
  }: IndexAnnotationArgs): Promise<GetResponse> {
    await checkJobAccess(jobIds);

    const obj: GetResponse = {
      success: true,
      annotations: {},
      totalCount: 0,
    };

    let query = esql.from([ML_ANNOTATIONS_INDEX_ALIAS_READ], ['_id', '_source'])
      .pipe`WHERE type == ${{
      annotationType: ANNOTATION_TYPE.ANNOTATION,
    }} AND annotation IS NOT NULL`;

    // Adds criteria for the time range plus any specified job IDs.
    // The excluded time ranges make sure that we fetch:
    // - annotations with start and end within the time range
    // - annotations that either start or end within the time range
    // - annotations that start before and end after the given time range
    // - but skip annotation that are completely outside the time range
    //   (the ones that start and end before or after the time range).
    // Annotations without an end_timestamp are never excluded, as with the previous range queries.
    if (earliestMs !== null && latestMs !== null) {
      query = query.pipe`WHERE NOT (
        (timestamp <= TO_DATETIME(${{
          earliestMs,
        }}) AND end_timestamp IS NOT NULL AND end_timestamp <= TO_DATETIME(${{ earliestMs }}))
        OR (timestamp >= TO_DATETIME(${{
          latestMs,
        }}) AND end_timestamp IS NOT NULL AND end_timestamp >= TO_DATETIME(${{ latestMs }}))
      )`;
    }

    if (event) {
      query = query.pipe`WHERE event == ${{ event }}`;
    }

    if (jobIds && jobIds.length > 0 && !(jobIds.length === 1 && jobIds[0] === '*')) {
      query = query.pipe`WHERE job_id IN (${{ jobIds }})`;
    }

    // Build the OR clause to further query for annotations in SMV
    // we want to show either the exact match with detector index and by/over/partition fields
    // OR annotations without any partition fields defined
    if (detectorIndex !== undefined && Array.isArray(entities)) {
      // Column names come from the fixed ML_PARTITION_FIELDS list, values are named parameters.
      const params: Record<string, unknown> = { detectorIndex };
      // clause to get annotations that have no partition fields
      const noPartitionFields = ML_PARTITION_FIELDS.map(
        (field) =>
          `${getAnnotationFieldName(field)} IS NULL AND ${getAnnotationFieldValue(field)} IS NULL`
      ).join(' AND ');
      // clause to get exact match of detector index and by/over/partition fields.
      // A field type that is not a partition field matches nothing.
      const exactMatch = ['detector_index == ?detectorIndex'];
      entities.forEach(({ fieldName, fieldType, fieldValue }, i: number) => {
        if (!(ML_PARTITION_FIELDS as readonly string[]).includes(fieldType)) {
          exactMatch.push('false');
          return;
        }
        params[`fieldName${i}`] = String(fieldName);
        params[`fieldValue${i}`] = String(fieldValue);
        exactMatch.push(
          `${getAnnotationFieldName(fieldType)} == ?fieldName${i} AND ${getAnnotationFieldValue(
            fieldType
          )} == ?fieldValue${i}`
        );
      });
      query = query.pipe(`WHERE (${noPartitionFields}) OR (${exactMatch.join(' AND ')})`, params);
    }

    const projectRouting =
      serverless.isServerless && serverless.cpsEnabled ? DEFAULT_ML_PROJECT_ROUTING : undefined;

    try {
      // The total is exact, the previous `track_total_hits: true` search counted all matches too.
      const [response, countResponse] = await Promise.all([
        runEsql({
          esClient: asInternalUser,
          query: query.keep('_id', '_source').limit(maxAnnotations),
          projectRouting,
        }),
        runEsql({
          esClient: asInternalUser,
          query: query.pipe`STATS total = COUNT(*)`,
          projectRouting,
        }),
      ]);

      const total = esqlRows(countResponse)[0]?.total;
      obj.totalCount = typeof total === 'number' ? total : 0;

      const docs = esqlRows(response).map((d) => {
        // get the original source document and the document id, we need it
        // to identify the annotation when editing/deleting it.
        // if original `event` is undefined then substitute with 'user` by default
        // since annotation was probably generated by user on the UI
        const source = omit(d._source as Annotation, 'project_routing');
        return {
          ...source,
          event: source.event ?? ANNOTATION_EVENT_USER,
          _id: d._id,
        } as Annotation;
      });

      if (isAnnotations(docs) === false) {
        // No need to translate, this will not be exposed in the UI.
        throw new Error(`Annotations didn't pass integrity check.`);
      }

      docs.forEach((doc: Annotation) => {
        const jobId = doc.job_id;
        if (typeof obj.annotations[jobId] === 'undefined') {
          obj.annotations[jobId] = [];
        }
        obj.annotations[jobId].push(doc);
      });

      return obj;
    } catch (error) {
      throw Boom.badRequest(error);
    }
  }

  /**
   * Fetches the latest delayed data annotation per job.
   * @param jobIds
   * @param earliestMs - Timestamp for the end_timestamp range query.
   */
  async function getDelayedDataAnnotations({
    jobIds,
    earliestMs,
  }: {
    jobIds: string[];
    earliestMs?: number;
  }): Promise<Annotation[]> {
    if (jobIds.length === 0) {
      return [];
    }

    await checkJobAccess(jobIds);

    const params: estypes.SearchRequest = {
      index: ML_ANNOTATIONS_INDEX_ALIAS_READ,
      size: 0,
      query: {
        bool: {
          filter: [
            ...(earliestMs ? [{ range: { end_timestamp: { gte: earliestMs } } }] : []),
            {
              term: { event: { value: 'delayed_data' } },
            },
            { terms: { job_id: jobIds } },
          ],
        },
      },
      aggs: {
        by_job: {
          terms: { field: 'job_id', size: jobIds.length },
          aggs: {
            latest_delayed: {
              top_hits: {
                size: 1,
                sort: [
                  {
                    end_timestamp: {
                      order: 'desc',
                    },
                  },
                ],
              },
            },
          },
        },
      },
      ...(serverless.isServerless && serverless.cpsEnabled
        ? { project_routing: DEFAULT_ML_PROJECT_ROUTING }
        : {}),
    };

    const body = await asInternalUser.search<Annotation>(params, { maxRetries: 0 });

    const annotations = (
      (body.aggregations!.by_job as estypes.AggregationsTermsAggregateBase<AggByJob>)
        .buckets as AggByJob[]
    ).map((bucket) => {
      return bucket.latest_delayed.hits.hits[0]._source!;
    });

    return annotations;
  }

  async function deleteAnnotation(id: string) {
    const { index } = await getAnnotationById(id);

    const deleteParams: DeleteParams = {
      index,
      id,
      refresh: 'wait_for',
      ...(serverless.isServerless && serverless.cpsEnabled
        ? { project_routing: DEFAULT_ML_PROJECT_ROUTING }
        : {}),
    };

    return await asInternalUser.delete(deleteParams);
  }

  return {
    getAnnotations,
    getAnnotationById,
    indexAnnotation,
    deleteAnnotation,
    getDelayedDataAnnotations,
  };
}

export type AnnotationService = ReturnType<typeof annotationProvider>;
