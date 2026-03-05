/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiButton,
  EuiCallOut,
  EuiCard,
  EuiComboBox,
  type EuiComboBoxOptionOption,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLoadingSpinner,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import {
  useSkillsApi,
  useSkillExecution,
  type SkillInfo,
  type SkillExecutionResult,
} from '../../../../hooks/use_skill_execution_api';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';
import { useKibana } from '../../../../hooks/use_kibana';

const SKILL_ICONS: Record<string, string> = {
  'streams.extract_stream_features': 'indexMapping',
  'streams.generate_sig_events_queries': 'search',
  'streams.generate_discoveries': 'inspect',
  'streams.generate_suggestions': 'bulb',
  'streams.investigate_stream': 'securityAnalyticsApp',
  'streams.push_entity_definition': 'database',
};

export function SkillsTab() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const { listSkills } = useSkillsApi();
  const { executeSkill, isExecuting } = useSkillExecution();
  const [lastResult, setLastResult] = useState<SkillExecutionResult | null>(null);
  const [selectedStreams, setSelectedStreams] = useState<EuiComboBoxOptionOption[]>([]);

  const skillsFetch = useStreamsAppFetch(({ signal }) => listSkills(), [listSkills]);

  const streamsListFetch = useStreamsAppFetch(
    ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams', {
        signal,
      }),
    [streamsRepositoryClient]
  );

  const streamOptions: EuiComboBoxOptionOption[] = useMemo(() => {
    const streams = streamsListFetch.value?.streams ?? [];
    return streams.map((s) => ({ label: s.stream.name }));
  }, [streamsListFetch.value]);

  const skills = skillsFetch.value?.skills ?? [];

  const handleExecute = useCallback(
    async (skill: SkillInfo) => {
      setLastResult(null);
      const streamNames = selectedStreams.map((s) => s.label);
      const result = await executeSkill(skill.id, { streamNames });
      setLastResult(result);
    },
    [executeSkill, selectedStreams]
  );

  const needsStreams = useCallback((skillId: string) => {
    return skillId !== 'streams.generate_suggestions';
  }, []);

  return (
    <>
      <EuiTitle size="s">
        <h2>
          {i18n.translate('xpack.streams.skills.title', {
            defaultMessage: 'Skills',
          })}
        </h2>
      </EuiTitle>
      <EuiSpacer size="s" />
      <EuiText size="s" color="subdued">
        {i18n.translate('xpack.streams.skills.description', {
          defaultMessage:
            'Skills are reusable workflows that can be triggered from here or used by the AI agent in chat. Select streams and click Run to execute a skill.',
        })}
      </EuiText>
      <EuiSpacer size="m" />

      <EuiFlexGroup>
        <EuiFlexItem grow={3}>
          <EuiComboBox
            placeholder={i18n.translate('xpack.streams.skills.selectStreams', {
              defaultMessage: 'Select streams...',
            })}
            options={streamOptions}
            selectedOptions={selectedStreams}
            onChange={setSelectedStreams}
            isClearable
            compressed
          />
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      {lastResult && (
        <>
          <EuiCallOut
            title={
              lastResult.status === 'failed'
                ? i18n.translate('xpack.streams.skills.executionFailed', {
                    defaultMessage: 'Skill execution failed',
                  })
                : i18n.translate('xpack.streams.skills.executionAccepted', {
                    defaultMessage: 'Skill execution started',
                  })
            }
            color={lastResult.status === 'failed' ? 'danger' : 'success'}
            iconType={lastResult.status === 'failed' ? 'error' : 'check'}
            size="s"
          >
            {lastResult.error && <p>{lastResult.error}</p>}
            {lastResult.result && (
              <EuiText size="xs">
                <pre>{JSON.stringify(lastResult.result, null, 2)}</pre>
              </EuiText>
            )}
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}

      {skillsFetch.loading ? (
        <EuiLoadingSpinner size="l" />
      ) : (
        <EuiFlexGroup gutterSize="m" wrap>
          {skills.map((skill) => {
            const isRunning = isExecuting === skill.id;
            const disabled =
              !skill.executable ||
              isRunning ||
              (needsStreams(skill.id) && selectedStreams.length === 0);

            return (
              <EuiFlexItem key={skill.id} grow={false} css={{ minWidth: 320, maxWidth: 400 }}>
                <EuiCard
                  layout="horizontal"
                  icon={<EuiIcon type={SKILL_ICONS[skill.id] ?? 'gear'} size="xl" />}
                  titleSize="xs"
                  title={
                    <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
                      <EuiFlexItem>{skill.name}</EuiFlexItem>
                      {!skill.executable && (
                        <EuiFlexItem grow={false}>
                          <EuiBadge color="hollow">
                            {i18n.translate('xpack.streams.skills.chatOnly', {
                              defaultMessage: 'Chat only',
                            })}
                          </EuiBadge>
                        </EuiFlexItem>
                      )}
                    </EuiFlexGroup>
                  }
                  description={skill.description}
                  paddingSize="m"
                  hasBorder
                >
                  <EuiSpacer size="s" />
                  <EuiButton
                    size="s"
                    fill
                    isLoading={isRunning}
                    disabled={disabled}
                    onClick={() => handleExecute(skill)}
                    iconType="play"
                  >
                    {isRunning
                      ? i18n.translate('xpack.streams.skills.running', {
                          defaultMessage: 'Running...',
                        })
                      : i18n.translate('xpack.streams.skills.run', {
                          defaultMessage: 'Run',
                        })}
                  </EuiButton>
                </EuiCard>
              </EuiFlexItem>
            );
          })}
        </EuiFlexGroup>
      )}
    </>
  );
}
