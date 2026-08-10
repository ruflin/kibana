/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import {
  Axis,
  BarSeries,
  Chart,
  Position,
  ScaleType,
  Settings,
  niceTimeFormatter,
} from '@elastic/charts';
import { EuiPanel, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import { useKibana } from '../../../../hooks/use_kibana';

export interface StackedDailyPoint {
  x: number;
  y: number;
  g: string;
}

interface StackedDailyChartProps {
  title: string;
  description?: string;
  data: StackedDailyPoint[];
  yAxisTitle?: string;
  height?: number;
}

export const StackedDailyChart = ({
  title,
  description,
  data,
  yAxisTitle,
  height = 220,
}: StackedDailyChartProps) => {
  const {
    dependencies: {
      start: { charts },
    },
  } = useKibana();
  const baseTheme = charts.theme.useChartsBaseTheme();

  const xFormatter = useMemo(() => {
    if (data.length === 0) {
      return niceTimeFormatter([Date.now() - 7 * 24 * 60 * 60 * 1000, Date.now()]);
    }
    const xs = data.map((point) => point.x);
    return niceTimeFormatter([Math.min(...xs), Math.max(...xs)]);
  }, [data]);

  return (
    <EuiPanel hasBorder paddingSize="m">
      <EuiTitle size="xs">
        <h3>{title}</h3>
      </EuiTitle>
      {description && (
        <>
          <EuiSpacer size="xs" />
          <EuiText size="s" color="subdued">
            <p>{description}</p>
          </EuiText>
        </>
      )}
      <EuiSpacer size="m" />
      {data.length === 0 ? (
        <EuiText size="s" color="subdued">
          <p>—</p>
        </EuiText>
      ) : (
        <Chart size={{ height }}>
          <Settings baseTheme={baseTheme} showLegend legendPosition={Position.Right} />
          <Axis id="bottom" position={Position.Bottom} tickFormat={xFormatter} />
          <Axis
            id="left"
            title={yAxisTitle}
            position={Position.Left}
            tickFormat={(value) => `${Math.round(Number(value))}`}
          />
          <BarSeries
            id="stacked"
            xScaleType={ScaleType.Time}
            yScaleType={ScaleType.Linear}
            xAccessor="x"
            yAccessors={['y']}
            splitSeriesAccessors={['g']}
            stackAccessors={['x']}
            data={data}
          />
        </Chart>
      )}
    </EuiPanel>
  );
};
