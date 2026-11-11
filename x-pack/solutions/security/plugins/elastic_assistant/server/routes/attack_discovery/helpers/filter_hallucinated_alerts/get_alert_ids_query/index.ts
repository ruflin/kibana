/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';

import { toEsqlSources } from '../../../../../lib/esql_read';

/**
 * Returns the ES|QL query that gives the _id of each of the given alerts that exists
 */
export const getAlertIdsQuery = (alertsIndexPattern: string, alertIds: string[]) =>
  esql.from(toEsqlSources(alertsIndexPattern), ['_id']).pipe`WHERE _id IN (${{ alertIds }})`
    .pipe`KEEP _id`.limit(alertIds.length);
