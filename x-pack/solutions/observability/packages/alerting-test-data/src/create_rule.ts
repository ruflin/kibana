/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kibanaPost } from './kibana_client';

export const createRule = async (ruleParams: any) => {
  return kibanaPost('/api/alerting/rule', ruleParams);
};
