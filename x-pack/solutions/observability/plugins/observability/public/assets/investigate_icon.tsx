/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SVGProps } from 'react';

export const InvestigateIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx={6.75} cy={6.75} r={4.75} strokeWidth={1.5} />
    <path d="M10.3 10.3L14 14" strokeWidth={1.75} />
    <path d="M3.9 7H5.4L6.3 5.4L7.5 8.4L8.4 7H9.6" strokeWidth={1.1} />
  </svg>
);
