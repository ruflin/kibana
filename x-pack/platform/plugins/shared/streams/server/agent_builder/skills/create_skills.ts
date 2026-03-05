/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SkillDefinition } from '@kbn/agent-builder-server/skills/type_definition';
import { extractStreamFeaturesSkill } from './extract_stream_features_skill';
import { generateSigEventsQueriesSkill } from './generate_sig_events_queries_skill';
import { generateDiscoveriesSkill } from './generate_discoveries_skill';
import { generateSuggestionsSkill } from './generate_suggestions_skill';
import { pushEntityDefinitionSkill } from './push_entity_definition_skill';
import { investigateStreamSkill } from './investigate_stream_skill';
import { createSkillExecutionHandlers, type SkillExecutionDeps } from './execution_handlers';
import { createExecuteTool } from './skill_execution';

export const createStreamSkills = (deps: SkillExecutionDeps): SkillDefinition[] => {
  const handlers = createSkillExecutionHandlers(deps);

  const withExecuteTool = (skill: SkillDefinition, description: string): SkillDefinition => {
    const handler = handlers[skill.id];
    if (!handler) {
      return skill;
    }
    return {
      ...skill,
      getInlineTools: async () => [createExecuteTool(skill.id, description, handler)],
    };
  };

  return [
    withExecuteTool(
      extractStreamFeaturesSkill,
      'Extract features from stream data. Params: { streamNames: string[] }'
    ),
    withExecuteTool(
      generateSigEventsQueriesSkill,
      'Generate sig events queries for streams. Params: { streamNames: string[] }'
    ),
    withExecuteTool(
      generateDiscoveriesSkill,
      'Run the discovery pipeline. Params: { streamNames?: string[] }'
    ),
    withExecuteTool(generateSuggestionsSkill, 'Generate suggestions from discoveries.'),
    withExecuteTool(pushEntityDefinitionSkill, 'Push entity definitions to the Entity Store.'),
    withExecuteTool(
      investigateStreamSkill,
      'Run full investigation on streams (features + queries + discoveries). Params: { streamNames: string[] }'
    ),
  ];
};
