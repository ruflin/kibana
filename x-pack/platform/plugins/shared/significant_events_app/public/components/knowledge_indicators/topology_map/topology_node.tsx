/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiText, useEuiTheme } from '@elastic/eui';
import { css } from '@emotion/react';
import type { TopologyNode as TopologyNodeData } from '@kbn/significant-events-schema';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import React, { memo } from 'react';
import { TOPOLOGY_NODE_ARIA_LABEL } from './translations';

export type TopologyFlowNode = Node<TopologyNodeData, 'topology'>;

const NODE_KIND_COLORS = {
  entity: 'primary',
  technology: 'accent',
  infrastructure: 'warning',
} as const;

function TopologyNodeComponent({ data, selected }: NodeProps<TopologyFlowNode>) {
  const { euiTheme } = useEuiTheme();
  const tone = NODE_KIND_COLORS[data.type];
  const background =
    tone === 'primary'
      ? euiTheme.colors.backgroundLightPrimary
      : tone === 'accent'
      ? euiTheme.colors.backgroundLightAccent
      : euiTheme.colors.backgroundLightWarning;
  const border =
    tone === 'primary'
      ? euiTheme.colors.borderStrongPrimary
      : tone === 'accent'
      ? euiTheme.colors.borderStrongAccent
      : euiTheme.colors.borderStrongWarning;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={TOPOLOGY_NODE_ARIA_LABEL({ type: data.type, label: data.label })}
      aria-pressed={selected}
      data-test-subj={`significantEventsTopologyMapNode-${data.id}`}
      css={css`
        min-width: 140px;
        max-width: 180px;
        padding: ${euiTheme.size.s} ${euiTheme.size.m};
        border-radius: ${euiTheme.border.radius.medium};
        border: ${selected ? euiTheme.border.width.thick : euiTheme.border.width.thin} solid
          ${selected ? euiTheme.colors.primary : border};
        background: ${background};
        outline: ${selected ? `${euiTheme.border.width.thick} solid ${euiTheme.colors.primary}` : 'none'};
      `}
    >
      <Handle
        type="target"
        position={Position.Left}
        css={css`
          visibility: hidden;
        `}
      />
      <EuiText size="xs" color="subdued">
        <p>{data.subtype ?? data.type}</p>
      </EuiText>
      <EuiText size="s">
        <strong>{data.label}</strong>
      </EuiText>
      <Handle
        type="source"
        position={Position.Right}
        css={css`
          visibility: hidden;
        `}
      />
    </div>
  );
}

export const TopologyNode = memo(TopologyNodeComponent);
