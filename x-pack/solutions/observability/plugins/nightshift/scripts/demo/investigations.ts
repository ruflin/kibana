/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'crypto';
import { fetch } from 'undici';
import { v5 as uuidv5 } from 'uuid';
import { types } from '@kbn/storage-adapter';
import type { StorageSchema } from '@kbn/storage-adapter';
import {
  AGENTIC_INVESTIGATIONS_API_VERSION,
  HYPOTHESES_ATTACHMENT_TYPE,
  HYPOTHESES_INDEX_NAME,
  IMPACT_ATTACHMENT_TYPE,
  IMPACT_INDEX_NAME,
  INVESTIGATION_STATUS_URL,
  INVESTIGATION_TEMPLATE_ID,
  SUBJECT_ATTACHMENT_TYPE,
  SUBJECT_INDEX_NAME,
} from '@kbn/agentic-investigations-plugin/common';
import type {
  EvidenceChart,
  EvidenceChartAnnotation,
  EvidenceChartSeries,
  Hypothesis,
  Impact,
  ImpactEntity,
  InvestigationEvidence,
  InvestigationHypotheses,
  InvestigationMetadataStatus,
  InvestigationSeverity,
  InvestigationSubject,
  User,
} from '@kbn/agentic-investigations-plugin/common';
import { NIGHTSHIFT_INVESTIGATION_AGENT_ID } from '@kbn/nightshift-investigations-plugin/common';
import {
  PROPOSALS_API_VERSION,
  PROPOSALS_INDEX_NAME,
  PROPOSALS_INTERNAL_URL,
  PROPOSAL_ATTACHMENT_TYPE,
} from '@kbn/proposals-common';
import type { ListProposalsResponse, ProposalConfidence } from '@kbn/proposals-common';
import { DEMO_EVENTS, DEMO_ID_NAMESPACE } from './dataset';
import type { DemoEvent } from './dataset';
import { dispatcherFor, esRequest } from './http';
import type { DemoConnection } from './http';
import type { DemoContext, DemoFeatures, DemoRule, DemoSource } from './steps';
import { demoEventId } from './steps';

/** The proposals gate workflow that `proposals.create` runs. */
const CREATE_PROPOSAL_WORKFLOW_ID = 'system-create-proposal';
/** Agent Builder's conversation index. */
const CONVERSATIONS_INDEX = '.chat-conversations';
/** Agent Builder public API version. */
const PUBLIC_API_VERSION = '2023-10-31';
/** Workflow execution statuses that end a run. */
const TERMINAL_EXECUTION_STATUSES = ['completed', 'failed', 'cancelled', 'skipped', 'timed_out'];
/** Side indexes the investigation documents go to, cleaned by --clean. */
const SIDE_INDEXES = [
  SUBJECT_INDEX_NAME,
  IMPACT_INDEX_NAME,
  HYPOTHESES_INDEX_NAME,
  PROPOSALS_INDEX_NAME,
];

type ChartUnit = NonNullable<EvidenceChart['y_axis']['unit']>;

interface SeedProposal {
  title: string;
  comment: string;
  confidence: ProposalConfidence;
}

interface SeedScenario {
  event: DemoEvent;
  eventIndex: number;
  title: string;
  severity?: InvestigationSeverity;
  status: InvestigationMetadataStatus;
  summary?: string;
  verdict?: string;
  hypotheses?: Hypothesis[];
  impact?: Pick<Impact, 'summary' | 'evidence' | 'entities'>;
  proposals: SeedProposal[];
  createdMinutesAgo: number;
  updatedMinutesAgo: number;
}

/** Stable Agent Builder conversation id of the investigation of one demo event. */
export const investigationConversationId = (source: DemoSource, event: DemoEvent): string =>
  uuidv5(`nightshift-demo:${demoEventId(source, event)}`, DEMO_ID_NAMESPACE);

const hashDocumentId = (...parts: string[]): string =>
  createHash('sha256')
    .update(parts.map((part) => `${part.length}:${part}`).join('\0'))
    .digest('hex');

const subjectDocumentId = (space: string, conversationId: string, eventId: string): string =>
  hashDocumentId(SUBJECT_ATTACHMENT_TYPE, space, conversationId, 'significant_event', eventId);
const hypothesesDocumentId = (space: string, conversationId: string): string =>
  hashDocumentId(HYPOTHESES_ATTACHMENT_TYPE, space, conversationId);
const impactDocumentId = (space: string, conversationId: string): string =>
  hashDocumentId(space, conversationId);

const userMapping = types.object({
  properties: {
    username: types.keyword({}),
    fullName: types.keyword({}),
    email: types.keyword({}),
    profileUid: types.keyword({}),
  },
});

/** Side-index mappings, as the storage adapter creates them; installed only when missing. */
const SIDE_INDEX_MAPPINGS: Record<string, StorageSchema['properties']> = {
  [SUBJECT_INDEX_NAME]: {
    spaceId: types.keyword({}),
    conversationId: types.keyword({}),
    subjectType: types.keyword({}),
    subjectId: types.keyword({}),
    summary: types.text({}),
    triggerType: types.keyword({}),
    snapshot: types.object({ enabled: false }),
    slack: types.object({ enabled: false }),
    createdAt: types.date({}),
    updatedAt: types.date({}),
    createdBy: userMapping,
  },
  [IMPACT_INDEX_NAME]: {
    spaceId: types.keyword({}),
    conversationId: types.keyword({}),
    summary: types.text({}),
    evidence: types.object({ enabled: false }),
    entities: types.nested({
      properties: {
        id: types.keyword({}),
        name: types.keyword({}),
        type: types.keyword({}),
        featureId: types.keyword({}),
        streamName: types.keyword({}),
        evidence: types.object({ enabled: false }),
      },
    }),
    createdAt: types.date({}),
    updatedAt: types.date({}),
    createdBy: userMapping,
  },
  [HYPOTHESES_INDEX_NAME]: {
    spaceId: types.keyword({}),
    conversationId: types.keyword({}),
    hypotheses: types.object({ enabled: false }),
    createdAt: types.date({}),
    updatedAt: types.date({}),
    createdBy: userMapping,
  },
};

/** A Kibana session for the demo user: the basic login cookie, or basic auth when there is no login form. */
interface KibanaSession {
  connection: DemoConnection;
  headers: Record<string, string>;
}

const basicHeader = ({ username, password }: DemoConnection['auth']): string =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

/**
 * Logs in through the basic login form, like a browser does, so Agent Builder records the user's
 * profile as the owner and the browser session sees the investigations.
 */
const openSession = async (connection: DemoConnection): Promise<KibanaSession> => {
  const internal = {
    'x-elastic-internal-origin': 'nightshift-demo',
    'kbn-xsrf': 'nightshift-demo',
  };
  const dispatcher = dispatcherFor(connection.kibanaUrl);
  const stateResponse = await fetch(`${connection.kibanaUrl}/internal/security/login_state`, {
    headers: internal,
    dispatcher,
  });
  const loginState = (await stateResponse.json()) as {
    selector?: { providers?: Array<{ type: string; name: string }> };
  };
  const provider = loginState.selector?.providers?.find(({ type }) => type === 'basic');
  if (!provider) {
    return { connection, headers: { authorization: basicHeader(connection.auth) } };
  }

  const login = await fetch(`${connection.kibanaUrl}/internal/security/login`, {
    method: 'POST',
    headers: { ...internal, 'content-type': 'application/json' },
    body: JSON.stringify({
      providerType: provider.type,
      providerName: provider.name,
      currentURL: `${connection.kibanaUrl}/login`,
      params: { username: connection.auth.username, password: connection.auth.password },
    }),
    dispatcher,
  });
  if (!login.ok) {
    throw new Error(`Login as ${connection.auth.username} failed with ${login.status}`);
  }
  const cookie = login.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ');
  return { connection, headers: { cookie } };
};

interface KibanaResponse<T> {
  status: number;
  body: T;
}

/** Calls a Kibana API as the session user. Statuses in `okStatuses` do not throw. */
const kibana = async <T>(
  session: KibanaSession,
  method: string,
  path: string,
  options: {
    body?: object;
    internal?: string;
    publicVersion?: string;
    okStatuses?: number[];
  } = {}
): Promise<KibanaResponse<T>> => {
  const url = `${session.connection.kibanaUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      ...session.headers,
      'kbn-xsrf': 'nightshift-demo',
      ...(options.internal !== undefined && {
        'x-elastic-internal-origin': 'nightshift-demo',
        'elastic-api-version': options.internal,
      }),
      ...(options.publicVersion !== undefined && { 'elastic-api-version': options.publicVersion }),
      ...(options.body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    dispatcher: dispatcherFor(url),
  });
  const text = await response.text();
  if (!response.ok && !(options.okStatuses ?? []).includes(response.status)) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
  }
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
};

const waitFor = async <T>(
  label: string,
  check: () => Promise<T | undefined>,
  timeoutMs = 60_000
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const listProposals = async (
  session: KibanaSession,
  conversationId: string
): Promise<ListProposalsResponse['proposals']> => {
  const { body } = await kibana<ListProposalsResponse>(
    session,
    'GET',
    `${PROPOSALS_INTERNAL_URL}?conversationId=${conversationId}&size=100`,
    { internal: PROPOSALS_API_VERSION }
  );
  return body.proposals;
};

const executionStatus = async (session: KibanaSession, executionId: string): Promise<string> => {
  const { status, body } = await kibana<{ status?: string }>(
    session,
    'GET',
    `/api/workflows/executions/${executionId}`,
    { publicVersion: PUBLIC_API_VERSION, okStatuses: [404] }
  );
  return status === 404 ? 'not_found' : body.status ?? 'unknown';
};

/** Starts the proposals gate workflow for each action, one at a time, as `proposals.create` does. */
const createProposals = async (
  session: KibanaSession,
  conversationId: string,
  proposals: SeedProposal[]
): Promise<void> => {
  for (const { title, comment, confidence } of proposals) {
    const before = (await listProposals(session, conversationId)).length;
    await kibana(session, 'POST', `/api/workflows/workflow/${CREATE_PROPOSAL_WORKFLOW_ID}/run`, {
      body: { inputs: { conversationId, title, comment, origin: 'nightshift', confidence } },
      publicVersion: PUBLIC_API_VERSION,
    });
    await waitFor(`proposal "${title}"`, async () =>
      (await listProposals(session, conversationId)).length > before ? true : undefined
    );
  }
  // The gate's create step attaches the card best-effort, and in practice the card does not land,
  // so attach the card for each proposal that does not have one yet, as the service does.
  const { body } = await kibana<{ attachments?: Array<{ type: string; origin?: string }> }>(
    session,
    'GET',
    `/api/agent_builder/conversations/${conversationId}`,
    { publicVersion: PUBLIC_API_VERSION }
  );
  const attachedProposalIds = new Set(
    (body.attachments ?? [])
      .filter(({ type }) => type === PROPOSAL_ATTACHMENT_TYPE)
      .map(({ origin }) => origin)
  );
  for (const proposal of await listProposals(session, conversationId)) {
    if (attachedProposalIds.has(proposal.id)) {
      continue;
    }
    await kibana(
      session,
      'POST',
      `/api/agent_builder/conversations/${conversationId}/attachments`,
      {
        body: {
          type: PROPOSAL_ATTACHMENT_TYPE,
          origin: proposal.id,
          data: { proposalId: proposal.id, title: proposal.title },
          render_inline: true,
        },
        publicVersion: PUBLIC_API_VERSION,
      }
    );
  }
};

/** Creates the side indexes with the storage adapter's alias and mappings, when they do not exist yet. */
const ensureSideIndexes = async (connection: DemoConnection): Promise<void> => {
  for (const [name, properties] of Object.entries(SIDE_INDEX_MAPPINGS)) {
    const alias = await esRequest(connection, 'HEAD', `/_alias/${name}`);
    if (alias.status === 200) {
      continue;
    }
    const template = await esRequest(connection, 'HEAD', `/_index_template/${name}`);
    if (template.status === 404) {
      await esRequest(connection, 'PUT', `/_index_template/${name}?create=true`, {
        index_patterns: [`${name}-*`],
        allow_auto_create: false,
        template: {
          settings: { number_of_shards: 1, auto_expand_replicas: '0-1' },
          mappings: { dynamic: 'strict', properties },
          aliases: { [name]: { is_write_index: true } },
        },
      });
    }
    const index = await esRequest<{ error?: { type?: string } }>(
      connection,
      'PUT',
      `/${name}-000001`
    );
    if (index.status >= 300 && index.data.error?.type !== 'resource_already_exists_exception') {
      throw new Error(`Creating ${name}-000001 failed (HTTP ${index.status})`);
    }
  }
};

/** Writes one side-index document. */
const indexDocument = async <TStored extends object>(
  connection: DemoConnection,
  index: string,
  id: string,
  stored: TStored
): Promise<TStored & { id: string }> => {
  const response = await esRequest(
    connection,
    'PUT',
    `/${index}/_doc/${id}?refresh=wait_for`,
    stored
  );
  if (response.status >= 300) {
    throw new Error(`Writing ${index}/${id} failed (HTTP ${response.status})`);
  }
  return { ...stored, id };
};

/** Attaches a side-index document to the conversation by reference, hidden from the chat. */
const attachDocument = async (
  session: KibanaSession,
  conversationId: string,
  type: string,
  document: { id: string },
  description?: string
): Promise<void> => {
  await kibana(session, 'POST', `/api/agent_builder/conversations/${conversationId}/attachments`, {
    body: {
      id: document.id,
      type,
      origin: document.id,
      data: document,
      hidden: true,
      ...(description !== undefined && { description }),
    },
    publicVersion: PUBLIC_API_VERSION,
  });
};

/** Removes the demo investigations: cancels their running gate workflows, deletes the conversations, then the documents. */
export const cleanInvestigations = async (ctx: DemoContext, source: DemoSource): Promise<void> => {
  const session = await openSession(ctx.connection);
  const conversationIds = DEMO_EVENTS.map((event) => investigationConversationId(source, event));

  for (const conversationId of conversationIds) {
    const executionIds = (await listProposals(session, conversationId)).flatMap(
      ({ workflowExecutionId }) => (workflowExecutionId ? [workflowExecutionId] : [])
    );
    for (const executionId of executionIds) {
      if (TERMINAL_EXECUTION_STATUSES.includes(await executionStatus(session, executionId))) {
        continue;
      }
      await kibana(session, 'POST', `/api/workflows/executions/${executionId}/cancel`, {
        publicVersion: PUBLIC_API_VERSION,
        okStatuses: [404],
      });
    }
    await kibana(session, 'DELETE', `/api/agent_builder/conversations/${conversationId}`, {
      publicVersion: PUBLIC_API_VERSION,
      okStatuses: [404],
    });
  }

  for (const index of SIDE_INDEXES) {
    await esRequest(
      ctx.connection,
      'POST',
      `/${index}/_delete_by_query?refresh=true&conflicts=proceed&ignore_unavailable=true`,
      {
        query: {
          bool: {
            filter: [
              { term: { spaceId: ctx.connection.space } },
              { terms: { conversationId: conversationIds } },
            ],
          },
        },
      }
    );
  }
  ctx.log.info(`Removed ${conversationIds.length} demo investigations`);
};

const series = (
  name: string,
  endMinutesAgo: number,
  values: number[],
  now: number,
  stepMinutes = 5
): EvidenceChartSeries => ({
  name,
  points: values.map((y, index) => ({
    x: new Date(now - (endMinutesAgo + (values.length - 1 - index) * stepMinutes) * 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
    y,
  })),
});

const annotation = (minutesAgo: number, label: string, now: number): EvidenceChartAnnotation => ({
  x: new Date(now - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  label,
});

const timeChart = ({
  title,
  yLabel,
  unit,
  seriesList,
  annotations,
}: {
  title: string;
  yLabel: string;
  unit?: ChartUnit;
  seriesList: EvidenceChartSeries[];
  annotations?: EvidenceChartAnnotation[];
}): EvidenceChart => ({
  type: 'line',
  title,
  x_axis: { type: 'time' },
  y_axis: { label: yLabel, ...(unit && { unit }) },
  series: seriesList,
  ...(annotations && { annotations }),
});

const hypothesis = (
  candidate: string,
  confidence: number,
  status: Hypothesis['status'],
  reason: string,
  ...evidences: InvestigationEvidence[]
): Hypothesis => ({
  candidate,
  confidence,
  status,
  reason,
  ...(evidences.length > 0 && { evidence: evidences }),
});

const toConfidenceLevel = (score: number): ProposalConfidence =>
  score >= 0.85 ? 'high' : score >= 0.7 ? 'medium' : 'low';

const recommendation = (
  title: string,
  confidence: number,
  description: string,
  code?: string
): SeedProposal => ({
  title,
  confidence: toConfidenceLevel(confidence),
  comment: code ? `${description}\n\n\`\`\`\n${code}\n\`\`\`` : description,
});

/** The story: the critical fraud-check investigation, and the dismissed Redis and Kafka one. */
const buildScenarios = (
  source: DemoSource,
  features: DemoFeatures,
  events: DemoEvent[],
  now: number
): SeedScenario[] => {
  const fraudEvent = events[0];
  const redHerringEvent = events[1];

  return [
    {
      event: fraudEvent,
      eventIndex: 0,
      title: fraudEvent.title,
      severity: 'critical',
      status: 'open',
      summary: fraudEvent.summary,
      verdict:
        'fraud-check is the cause. Its gateway times out on about 70% of requests, and claim-intake and payment-processor fail or retry behind it. Redis and Kafka are not involved.',
      hypotheses: [
        hypothesis(
          'fraud-check gateway overloaded and missing its deadline',
          0.93,
          'confirmed',
          'Timeouts start at the same time as the error spike on fraud-check, and claim-intake errors follow it.',
          {
            description:
              'fraud-check timeout rate rises to about **70%** and stays there for the incident.',
            chart: timeChart({
              title: 'fraud-check timeout rate',
              yLabel: 'Timeouts (% of requests)',
              unit: 'number',
              seriesList: [series('Timeouts', 14, [35, 70, 72, 68, 71, 70, 69], now)],
              annotations: [annotation(20, 'Incident starts', now)],
            }),
          }
        ),
        hypothesis(
          'Postgres timeouts in the claims database',
          0.12,
          'dismissed',
          'Postgres latency stayed flat. The timeouts are on fraud-check, before any database call.'
        ),
        hypothesis(
          'Redis and Kafka problems',
          0.04,
          'dismissed',
          'The Redis and Kafka lines are background noise. fraud-check fails before it calls either.'
        ),
      ],
      impact: {
        summary:
          'About 70% of fraud checks time out, so claims cannot finish intake and payments are delayed.',
        entities: ['claim-intake', 'fraud-check', 'payment-processor'].map(
          (name): ImpactEntity => ({
            id: name,
            name,
            type: 'service',
            streamName: source.streamName,
            featureId: features.featureIdFor(name),
          })
        ),
      },
      proposals: [
        recommendation(
          'Scale out the fraud-check gateway',
          0.88,
          'Adds capacity so the gateway can finish its checks before the deadline.',
          'kubectl scale deployment/fraud-check --replicas=6 -n claims'
        ),
        recommendation(
          'Raise the fraud-check timeout while the gateway recovers',
          0.7,
          'Gives slow checks more time. It helps only while the gateway catches up, so revert it afterwards.'
        ),
      ],
      createdMinutesAgo: 27,
      updatedMinutesAgo: 13,
    },
    {
      event: redHerringEvent,
      eventIndex: 1,
      title: redHerringEvent.title,
      severity: 'low',
      status: 'closed',
      summary: redHerringEvent.summary,
      verdict:
        'Not related to the claim delays. The Redis timeouts and Kafka lag appear in the logs, but no claim fails because of them.',
      hypotheses: [
        hypothesis(
          'Redis connection pool exhaustion causes the claim delays',
          0.05,
          'dismissed',
          'Redis timeouts do not line up with the claim failures, and the claim path does not call Redis before fraud-check.'
        ),
        hypothesis(
          'Kafka consumer lag delays claim events',
          0.08,
          'dismissed',
          'The lag is on a notification topic that claim processing does not wait for.'
        ),
      ],
      proposals: [],
      createdMinutesAgo: 35,
      updatedMinutesAgo: 22,
    },
  ];
};

/** Writes the investigations of the demo events. Re-running replaces the earlier ones. */
export const seedInvestigations = async (
  ctx: DemoContext,
  source: DemoSource,
  _rules: DemoRule[],
  features: DemoFeatures,
  events: DemoEvent[]
): Promise<void> => {
  const now = Date.now();
  await cleanInvestigations(ctx, source);
  await ensureSideIndexes(ctx.connection);
  const session = await openSession(ctx.connection);

  const meResponse = await kibana<{
    uid?: string;
    user?: { username: string; full_name?: string | null; email?: string | null };
  }>(session, 'GET', '/internal/security/user_profile', {
    internal: AGENTIC_INVESTIGATIONS_API_VERSION,
    okStatuses: [404],
  });
  const user: User = meResponse.body.user
    ? {
        username: meResponse.body.user.username,
        fullName: meResponse.body.user.full_name ?? null,
        email: meResponse.body.user.email ?? null,
        profileUid: meResponse.body.uid ?? '',
      }
    : { username: ctx.connection.auth.username, fullName: null, email: null, profileUid: '' };

  for (const scenario of buildScenarios(source, features, events, now)) {
    const conversationId = investigationConversationId(source, scenario.event);
    const createdAt = new Date(now - scenario.createdMinutesAgo * 60_000).toISOString();
    const updatedAt = new Date(now - scenario.updatedMinutesAgo * 60_000).toISOString();
    const base = {
      spaceId: ctx.connection.space,
      conversationId,
      createdAt,
      createdBy: user,
      updatedAt,
    };

    await kibana(session, 'POST', '/api/agent_builder/conversations', {
      body: {
        conversation_id: conversationId,
        agent_id: NIGHTSHIFT_INVESTIGATION_AGENT_ID,
        title: scenario.title,
        template_id: INVESTIGATION_TEMPLATE_ID,
        access_control: { access_mode: 'public' },
        metadata: {
          status: 'open',
          ...(scenario.severity && { severity: scenario.severity }),
          ...(scenario.summary && { summary: scenario.summary }),
          ...(scenario.verdict && { verdict: scenario.verdict }),
        },
      },
      publicVersion: PUBLIC_API_VERSION,
    });

    const subjectDocument = await indexDocument<Omit<InvestigationSubject, 'id'>>(
      ctx.connection,
      SUBJECT_INDEX_NAME,
      subjectDocumentId(ctx.connection.space, conversationId, demoEventId(source, scenario.event)),
      {
        ...base,
        subjectType: 'significant_event',
        subjectId: demoEventId(source, scenario.event),
        summary: scenario.event.summary,
        triggerType: 'automatic',
      }
    );
    await attachDocument(session, conversationId, SUBJECT_ATTACHMENT_TYPE, subjectDocument);

    if (scenario.impact) {
      const impactDocument = await indexDocument<Omit<Impact, 'id'>>(
        ctx.connection,
        IMPACT_INDEX_NAME,
        impactDocumentId(ctx.connection.space, conversationId),
        { ...base, ...scenario.impact }
      );
      await attachDocument(session, conversationId, IMPACT_ATTACHMENT_TYPE, impactDocument);
    }

    if (scenario.hypotheses) {
      const hypothesesDocument = await indexDocument<Omit<InvestigationHypotheses, 'id'>>(
        ctx.connection,
        HYPOTHESES_INDEX_NAME,
        hypothesesDocumentId(ctx.connection.space, conversationId),
        { ...base, hypotheses: scenario.hypotheses }
      );
      await attachDocument(
        session,
        conversationId,
        HYPOTHESES_ATTACHMENT_TYPE,
        hypothesesDocument,
        'Hypotheses'
      );
    }

    await createProposals(session, conversationId, scenario.proposals);

    if (scenario.status === 'closed') {
      await kibana(session, 'PUT', INVESTIGATION_STATUS_URL.replace('{id}', conversationId), {
        body: { status: 'closed' },
        internal: AGENTIC_INVESTIGATIONS_API_VERSION,
      });
    }

    // Agent Builder stamps creation and updates with the current time, so the timeline is written
    // to the conversation document afterwards.
    await esRequest(
      ctx.connection,
      'POST',
      `/${CONVERSATIONS_INDEX}/_update/${conversationId}?refresh=wait_for`,
      { doc: { created_at: createdAt, updated_at: updatedAt } }
    );
    ctx.log.info(`Seeded investigation "${scenario.title}" (${conversationId})`);
  }
};
