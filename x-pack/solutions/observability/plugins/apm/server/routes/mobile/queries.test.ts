/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MobileErrorType } from '@kbn/apm-types';
import { getDeviceOSApp } from './get_device_os_app';
import { getNCT } from './get_nct';
import type { EsqlParamsMock } from '../../utils/esql_test_helpers';
import { inspectEsqlParams, toEsqlRequest } from '../../utils/esql_test_helpers';
import { ENVIRONMENT_ALL } from '../../../common/environment_filter_values';
import { ApmDocumentType } from '../../../common/document_type';

const baseParams = {
  serviceName: 'serviceName',
  environment: ENVIRONMENT_ALL.value,
  kuery: '',
  start: 0,
  end: 50000,
  size: 10,
  transactionType: 'mobile',
};

const crashTerm = { term: { 'error.type': 'crash' } };
const notCrash = { bool: { must_not: [crashTerm] } };

/** The document type of the first source an `esql` call read. */
const documentTypeOf = (mock: EsqlParamsMock) =>
  (toEsqlRequest(mock.params).apm as { sources: Array<{ documentType: string }> }).sources[0]
    .documentType;

describe('mobile filters queries', () => {
  let mock: EsqlParamsMock;

  afterEach(() => {
    mock.teardown();
  });

  describe('getDeviceOSApp', () => {
    it('queries transaction events when no error type is given', async () => {
      mock = await inspectEsqlParams(({ mockApmEventClient }) =>
        getDeviceOSApp({ ...baseParams, apmEventClient: mockApmEventClient })
      );

      expect(documentTypeOf(mock)).toBe(ApmDocumentType.TransactionEvent);
      expect(toEsqlRequest(mock.params).query).toContain(
        'WHERE `transaction.type` == ?transaction_type_value'
      );
      expect(toEsqlRequest(mock.params)).toMatchSnapshot();
    });

    it('queries crash documents when the error type is crash', async () => {
      mock = await inspectEsqlParams(({ mockApmEventClient }) =>
        getDeviceOSApp({
          ...baseParams,
          errorType: MobileErrorType.Crash,
          apmEventClient: mockApmEventClient,
        })
      );

      expect(documentTypeOf(mock)).toBe(ApmDocumentType.ErrorEvent);
      expect(toEsqlRequest(mock.params).filter?.bool?.filter).toContainEqual(crashTerm);
      expect(toEsqlRequest(mock.params).query).not.toContain('transaction.type');
      expect(toEsqlRequest(mock.params)).toMatchSnapshot();
    });

    it('excludes crash documents when the error type is error', async () => {
      mock = await inspectEsqlParams(({ mockApmEventClient }) =>
        getDeviceOSApp({
          ...baseParams,
          errorType: MobileErrorType.Error,
          apmEventClient: mockApmEventClient,
        })
      );

      // Same document type as the crash case, so the must_not is what distinguishes them.
      expect(documentTypeOf(mock)).toBe(ApmDocumentType.ErrorEvent);
      expect(toEsqlRequest(mock.params).filter?.bool?.filter).toContainEqual(notCrash);
      expect(toEsqlRequest(mock.params).filter?.bool?.filter).not.toContainEqual(crashTerm);
      expect(toEsqlRequest(mock.params).query).not.toContain('transaction.type');
      expect(toEsqlRequest(mock.params)).toMatchSnapshot();
    });
  });

  describe('getNCT', () => {
    it('queries span events when no error type is given', async () => {
      mock = await inspectEsqlParams(({ mockApmEventClient }) =>
        getNCT({ ...baseParams, apmEventClient: mockApmEventClient })
      );

      expect(documentTypeOf(mock)).toBe(ApmDocumentType.SpanEvent);
      expect(toEsqlRequest(mock.params)).toMatchSnapshot();
    });

    it('queries crash documents when the error type is crash', async () => {
      mock = await inspectEsqlParams(({ mockApmEventClient }) =>
        getNCT({
          ...baseParams,
          errorType: MobileErrorType.Crash,
          apmEventClient: mockApmEventClient,
        })
      );

      expect(documentTypeOf(mock)).toBe(ApmDocumentType.ErrorEvent);
      expect(toEsqlRequest(mock.params).filter?.bool?.filter).toContainEqual(crashTerm);
      expect(toEsqlRequest(mock.params)).toMatchSnapshot();
    });

    it('excludes crash documents when the error type is error', async () => {
      mock = await inspectEsqlParams(({ mockApmEventClient }) =>
        getNCT({
          ...baseParams,
          errorType: MobileErrorType.Error,
          apmEventClient: mockApmEventClient,
        })
      );

      expect(documentTypeOf(mock)).toBe(ApmDocumentType.ErrorEvent);
      expect(toEsqlRequest(mock.params).filter?.bool?.filter).toContainEqual(notCrash);
      expect(toEsqlRequest(mock.params).filter?.bool?.filter).not.toContainEqual(crashTerm);
      expect(toEsqlRequest(mock.params)).toMatchSnapshot();
    });
  });
});
