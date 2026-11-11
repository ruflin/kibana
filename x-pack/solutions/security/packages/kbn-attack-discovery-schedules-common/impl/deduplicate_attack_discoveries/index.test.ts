/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';

import { deduplicateAttackDiscoveries } from '.';
import { mockAttackDiscoveries } from '../__mocks__/mock_attack_discoveries';
import { generateAttackDiscoveryAlertHash } from '../transforms/transform_to_alert_documents';

jest.mock('../transforms/transform_to_alert_documents', () => ({
  ...jest.requireActual('../transforms/transform_to_alert_documents'),
  generateAttackDiscoveryAlertHash: jest.fn(),
}));

const mockEsClient = elasticsearchServiceMock.createElasticsearchClient();
const mockLogger = loggerMock.create();
const mockEsqlQuery = mockEsClient.esql.query as unknown as jest.Mock;

const esqlInstanceIds = (...ids: Array<string | null>) => ({
  columns: [{ name: 'kibana.alert.instance.id', type: 'keyword' }],
  values: ids.map((id) => [id]),
});

/**
 * An arbitrary producer identity. Not a real producer: the AD Worker passes `watch_floor_ad_worker`.
 * This only exercises the opt-in mechanism.
 */
const TEST_GENERATION_SOURCE = 'test-producer';

describe('deduplicateAttackDiscoveries', () => {
  const uuid1 = 'test-uuid-1';
  const uuid2 = 'test-uuid-2';
  const [attack1, attack2] = mockAttackDiscoveries;
  const ownerInfo = {
    id: 'test-owner-1',
    isSchedule: false,
  };
  const defaultProps = {
    attackDiscoveries: mockAttackDiscoveries,
    computeSha256Hash: (input: string) => input,
    connectorId: 'test-connector-1',
    esClient: mockEsClient,
    indexPattern: '.test.alerts-*,.adhoc.alerts-*',
    logger: mockLogger,
    ownerInfo,
    replacements: undefined,
    spaceId: 'test-space',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockEsqlQuery.mockResolvedValue(esqlInstanceIds());
    (generateAttackDiscoveryAlertHash as jest.Mock).mockImplementation(({ attackDiscovery }) => {
      if (attackDiscovery === attack1) return uuid1;
      if (attackDiscovery === attack2) return uuid2;
      return 'unknown-uuid';
    });
  });

  it('should return empty array if no attack discoveries passed to the function', async () => {
    const result = await deduplicateAttackDiscoveries({ ...defaultProps, attackDiscoveries: [] });

    expect(result).toEqual([]);
  });

  it('should return all discoveries if none are duplicates', async () => {
    const result = await deduplicateAttackDiscoveries(defaultProps);
    expect(result).toEqual(mockAttackDiscoveries);
  });

  it('should filter out all discoveries if all are duplicates', async () => {
    mockEsqlQuery.mockResolvedValue(esqlInstanceIds(uuid1, uuid2));
    const result = await deduplicateAttackDiscoveries(defaultProps);
    expect(result).toEqual([]);
  });

  it('should filter out only duplicates and keep new discoveries', async () => {
    mockEsqlQuery.mockResolvedValue(esqlInstanceIds(uuid2));
    const result = await deduplicateAttackDiscoveries({
      ...defaultProps,
      attackDiscoveries: [attack1, attack2],
    });
    expect(result).toEqual([attack1]);
  });

  it('should handle ES hits with missing _source gracefully', async () => {
    mockEsqlQuery.mockResolvedValue(esqlInstanceIds(null));
    const result = await deduplicateAttackDiscoveries({
      ...defaultProps,
      attackDiscoveries: [attack1],
    });
    expect(result).toEqual([attack1]);
  });

  it('queries the alert instance ids of every index pattern with an explicit limit', async () => {
    await deduplicateAttackDiscoveries({ ...defaultProps, attackDiscoveries: [attack1, attack2] });

    expect(mockEsqlQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: `FROM .test.alerts-*, .adhoc.alerts-* | WHERE \`kibana.alert.instance.id\` IN ("${uuid1}", "${uuid2}") | KEEP \`kibana.alert.instance.id\` | LIMIT 2`,
      })
    );
  });

  it('treats a missing alerts index as having no duplicates', async () => {
    mockEsqlQuery.mockRejectedValue(
      Object.assign(new Error('verification_exception'), {
        statusCode: 400,
        body: {
          error: { type: 'verification_exception', reason: 'Unknown index [.test.alerts-*]' },
        },
      })
    );

    const result = await deduplicateAttackDiscoveries(defaultProps);

    expect(result).toEqual(mockAttackDiscoveries);
  });

  it('should pass the injected computeSha256Hash to generateAttackDiscoveryAlertHash', async () => {
    const computeSha256Hash = jest.fn((input: string) => input);
    await deduplicateAttackDiscoveries({
      ...defaultProps,
      attackDiscoveries: [attack1],
      computeSha256Hash,
    });
    expect(generateAttackDiscoveryAlertHash).toHaveBeenCalledWith(
      expect.objectContaining({ computeSha256Hash })
    );
  });

  it('should log when duplicates are found for ad-hoc run', async () => {
    mockEsqlQuery.mockResolvedValue(esqlInstanceIds(uuid1));
    await deduplicateAttackDiscoveries(defaultProps);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Ad-hoc Attack Discovery: Found 1 duplicate alert(s), skipping report for those.'
    );
    expect((mockLogger.debug as jest.Mock).mock.calls[0][0]()).toBe(
      `Ad-hoc Attack Discovery: Duplicated alerts:\n ${JSON.stringify([uuid1].sort(), null, 2)}`
    );
  });

  it('should log when duplicates are found for scheduled run', async () => {
    mockEsqlQuery.mockResolvedValue(esqlInstanceIds(uuid1));
    await deduplicateAttackDiscoveries({
      ...defaultProps,
      ownerInfo: { ...ownerInfo, isSchedule: true },
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Attack Discovery Schedule [test-owner-1]: Found 1 duplicate alert(s), skipping report for those.'
    );
    expect((mockLogger.debug as jest.Mock).mock.calls[0][0]()).toBe(
      `Attack Discovery Schedule [test-owner-1]: Duplicated alerts:\n ${JSON.stringify(
        [uuid1].sort(),
        null,
        2
      )}`
    );
  });

  describe('generationSource', () => {
    it('forwards undefined to the alert hash when no generation source is provided', async () => {
      await deduplicateAttackDiscoveries(defaultProps);

      expect(generateAttackDiscoveryAlertHash).toHaveBeenCalledWith(
        expect.objectContaining({ generationSource: undefined })
      );
    });

    it('forwards the generation source to the alert hash', async () => {
      await deduplicateAttackDiscoveries({
        ...defaultProps,
        generationSource: TEST_GENERATION_SOURCE,
      });

      expect(generateAttackDiscoveryAlertHash).toHaveBeenCalledWith(
        expect.objectContaining({
          generationSource: TEST_GENERATION_SOURCE,
        })
      );
    });

    describe('with hashes that vary by producer', () => {
      beforeEach(() => {
        (generateAttackDiscoveryAlertHash as jest.Mock).mockImplementation(
          ({ attackDiscovery, generationSource }) =>
            `${attackDiscovery === attack1 ? uuid1 : uuid2}-${generationSource ?? 'none'}`
        );

        // only producer-a's attack for `attack1` is already stored
        mockEsqlQuery.mockResolvedValue(esqlInstanceIds(`${uuid1}-producer-a`));
      });

      it('still de-duplicates a re-run of the SAME producer', async () => {
        const result = await deduplicateAttackDiscoveries({
          ...defaultProps,
          attackDiscoveries: [attack1],
          generationSource: 'producer-a',
        });

        expect(result).toEqual([]);
      });

      it('does NOT de-duplicate the same alerts generated by a DIFFERENT producer', async () => {
        const result = await deduplicateAttackDiscoveries({
          ...defaultProps,
          attackDiscoveries: [attack1],
          generationSource: 'producer-b',
        });

        expect(result).toEqual([attack1]);
      });

      it('does NOT de-duplicate against a producer when no generation source is provided', async () => {
        const result = await deduplicateAttackDiscoveries({
          ...defaultProps,
          attackDiscoveries: [attack1],
        });

        expect(result).toEqual([attack1]);
      });
    });
  });
});
