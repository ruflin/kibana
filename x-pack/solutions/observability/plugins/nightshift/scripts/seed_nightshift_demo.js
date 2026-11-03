/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Launcher for seed_nightshift_demo_impl.ts, so it runs with plain node from the repo root:
 *
 *   node x-pack/solutions/observability/plugins/nightshift/scripts/seed_nightshift_demo.js
 */

require('@kbn/setup-node-env');
require('./seed_nightshift_demo_impl');
