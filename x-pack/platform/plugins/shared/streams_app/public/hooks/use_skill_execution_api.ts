/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useAbortController } from '@kbn/react-hooks';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useKibana } from './use_kibana';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  executable: boolean;
}

export interface SkillExecutionResult {
  skill_id: string;
  status: string;
  result?: Record<string, unknown>;
  error?: string;
}

export function useSkillsApi() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const { signal } = useAbortController();

  return useMemo(
    () => ({
      listSkills: async (): Promise<{ skills: SkillInfo[] }> => {
        return streamsRepositoryClient.fetch('GET /internal/streams/_skills', {
          signal,
        });
      },
    }),
    [signal, streamsRepositoryClient]
  );
}

export function useSkillExecution() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const [isExecuting, setIsExecuting] = useState<string | null>(null);
  const abortControllerRef = useRef(new AbortController());

  const executeSkill = useCallback(
    async (
      skillId: string,
      params?: Record<string, unknown>,
      connectorId?: string
    ): Promise<SkillExecutionResult> => {
      setIsExecuting(skillId);
      try {
        const result = await streamsRepositoryClient.fetch(
          'POST /internal/streams/_skills/{skillId}/_execute',
          {
            signal: abortControllerRef.current.signal,
            params: {
              path: { skillId },
              body: {
                params: params ?? {},
                connectorId,
              },
            },
          }
        );
        return result;
      } finally {
        setIsExecuting(null);
      }
    },
    [streamsRepositoryClient]
  );

  return { executeSkill, isExecuting };
}
