import { expect, test, type Page, type Route } from '@playwright/test';

async function login(page: Page): Promise<void> {
  await page.goto('/people');
  const logout = page.getByTestId('logout');
  try {
    await logout.waitFor({ state: 'visible', timeout: 4000 });
    await logout.click();
  } catch {
    /* already signed out */
  }
  await page.getByTestId('login-email').fill('workspace-os@alpha.com');
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: 'operations', exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('role-display')).toContainText('operations');
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const mission = {
  missionId: 'MSN-9002',
  name: 'Workspace proof',
  code: null,
  organizer: null,
  city: null,
  teamId: null,
  gameTitle: null,
  startsOn: '2026-08-05',
  endsOn: null,
  notes: null,
  financeStage: 'Planning',
  isActive: true,
  version: 0,
  createdAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z',
};

test('Workspace OS: snap, restore, save, apply, and reload remain geometry-only device state', async ({ page }) => {
  await login(page);
  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => fulfillJson(route, { mission }));
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );

  await page.goto(`/missions/${mission.missionId}/comms`);
  const current = page.locator('[data-module="mission-current"]');
  await expect(current).toBeVisible();

  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Left half: Mission Current' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'left-half');
  await expect(current).toHaveAttribute('style', /--mc-x: 0%;.*--mc-w: 50%/);

  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Restore freeform' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'freeform');

  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Left half: Mission Current' }).click();

  await page.getByRole('button', { name: /^Views/ }).click();
  const library = page.getByRole('dialog', { name: 'Saved workspace views' });
  await expect(library).toBeVisible();
  await library.getByLabel('Name this view').fill('My command');
  await library.getByRole('button', { name: 'Save current' }).click();
  await expect(library.getByText('My command')).toBeVisible();
  await library.getByRole('button', { name: 'Close saved views' }).click();

  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Full canvas: Mission Current' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'full');

  await page.getByRole('button', { name: /^Views/ }).click();
  await library.getByRole('button', { name: 'Apply' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'left-half');

  const storageKey = `c3:mission-command:${mission.missionId}:workspace:v2`;
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey))
    .not.toBeNull();
  const stored = await page.evaluate((key) => localStorage.getItem(key) ?? '', storageKey);
  expect(stored).toContain('"version":2');
  expect(stored).toContain('"name":"My command"');
  expect(stored).not.toContain('workspace-os@alpha.com');
  expect(stored).not.toContain('Workspace proof');

  await page.reload();
  await expect(current).toBeVisible();
  await expect(current).toHaveAttribute('data-window-snap', 'left-half');
  await page.getByRole('button', { name: /^Views/ }).click();
  await expect(page.getByRole('dialog', { name: 'Saved workspace views' }).getByText('My command')).toBeVisible();
});

test('Workspace OS: ordinary routes park one principal workspace and a principal change destroys its live tree', async ({ page }) => {
  await login(page);
  let missionReads = 0;
  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => {
    missionReads += 1;
    return fulfillJson(route, { mission });
  });
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );

  await page.goto(`/missions/${mission.missionId}/comms`);
  const current = page.locator('[data-module="mission-current"]');
  const draft = page.getByPlaceholder(`Write in the ${mission.name} Mission Thread`);
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(1);
  await expect(current).toBeVisible();
  await draft.fill('Unsent handover survives parking');
  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Right half: Mission Current' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'right-half');

  const readsBeforeParking = missionReads;
  await page.getByTestId('nav-journeys').click();
  await expect(page).toHaveURL(/\/journeys$/);
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(0);
  await expect(page.locator('.tw-root')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(missionReads).toBe(readsBeforeParking);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/missions/${mission.missionId}/comms$`));
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(1);
  await expect(draft).toHaveValue('Unsent handover survives parking');
  await expect(current).toHaveAttribute('data-window-snap', 'right-half');
  await expect.poll(() => missionReads).toBeGreaterThan(readsBeforeParking);

  await page.getByTestId('logout').click();
  await page.getByTestId('login-email').fill('fresh-principal@alpha.com');
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: 'operations', exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('role-display')).toContainText('operations');
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(1);
  await expect(page.getByPlaceholder(`Write in the ${mission.name} Mission Thread`)).toHaveValue('');
  await expect(page.locator('[data-module="mission-current"]')).toHaveAttribute('data-window-snap', 'right-half');
});

test('People & Organization: the Living Field joins the workspace without persisting people or filters', async ({ page }) => {
  const people = [
    {
      personId: 'PER-9001',
      fullName: 'Mina Rahal',
      ign: 'Northstar',
      nationality: null,
      primaryRole: 'Commander',
      personnelCode: null,
      currentTeam: 'Atlas',
      currentGameTitle: null,
      primaryDepartment: null,
      entityId: null,
      notes: null,
      firstName: 'Mina',
      lastName: 'Rahal',
      otherNationalities: [],
      position: null,
      dateOfJoining: null,
      isActive: true,
      version: 0,
      createdAt: '2026-08-06T08:00:00.000Z',
      updatedAt: '2026-08-06T08:00:00.000Z',
    },
    {
      personId: 'PER-9002',
      fullName: 'Omar Vale',
      ign: null,
      nationality: null,
      primaryRole: null,
      personnelCode: null,
      currentTeam: null,
      currentGameTitle: null,
      primaryDepartment: null,
      entityId: null,
      notes: null,
      firstName: 'Omar',
      lastName: 'Vale',
      otherNationalities: [],
      position: 'Analyst',
      dateOfJoining: null,
      isActive: false,
      version: 0,
      createdAt: '2026-08-06T08:00:00.000Z',
      updatedAt: '2026-08-06T08:00:00.000Z',
    },
  ];

  await page.route('**/api/v1/people', (route) => fulfillJson(route, { people }));
  await login(page);
  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => fulfillJson(route, { mission }));
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );

  await page.goto(`/missions/${mission.missionId}/comms`);
  await page.getByTestId('nav-people').click();
  await expect(page).toHaveURL(new RegExp(`/people\\?workspace=${mission.missionId}$`));

  const field = page.locator('[data-module="people-field"]');
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute('data-module-truth', 'verified');
  await expect(page.locator('[data-module="mission-current"]')).toBeVisible();
  await expect(field.getByText('Mina Rahal')).toBeVisible();
  await expect(field.getByText('Omar Vale')).toHaveCount(0);

  await field.getByTestId('people-field-status').selectOption('all');
  await field.getByTestId('people-field-search').fill('Omar');
  await expect(field.getByText('Omar Vale')).toBeVisible();
  await expect(field.getByText('Mina Rahal')).toHaveCount(0);

  await page.getByRole('button', { name: 'Minimize Living Field' }).click();
  await expect(field).toBeHidden();
  await page.locator('[data-window-launcher="people-field"]').click();
  await expect(field).toBeVisible();
  await expect(field.getByTestId('people-field-search')).toHaveValue('Omar');

  const storageKey = `c3:mission-command:${mission.missionId}:workspace:v2`;
  const stored = await page.evaluate((key) => localStorage.getItem(key) ?? '', storageKey);
  expect(stored).toContain('people-field');
  expect(stored).not.toContain('PER-9001');
  expect(stored).not.toContain('PER-9002');
  expect(stored).not.toContain('Mina Rahal');
  expect(stored).not.toContain('Omar');

  await page.getByRole('button', { name: 'Close Living Field' }).click();
  await expect(page).toHaveURL(new RegExp(`/missions/${mission.missionId}/comms$`));
  await expect(field).toHaveCount(0);
});

test('Workspace OS: Approvals and Calendar open as truthful singleton windows instead of pages', async ({ page }) => {
  await login(page);
  let approvalsReads = 0;
  let calendarReads = 0;
  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => fulfillJson(route, { mission }));
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );
  await page.route('**/api/v1/approvals', (route) => {
    approvalsReads += 1;
    return fulfillJson(route, { approvals: [] });
  });
  await page.route('**/api/v1/calendar**', (route) => {
    calendarReads += 1;
    return fulfillJson(route, { items: [], horizonDays: 90, todayIso: '2026-08-05' });
  });

  await page.goto(`/missions/${mission.missionId}/comms`);
  const draft = page.getByPlaceholder(`Write in the ${mission.name} Mission Thread`);
  await draft.fill('Keep the relay open beside the registers');

  await page.getByTestId('nav-approvals').click();
  await expect(page).toHaveURL(new RegExp(`/approvals\\?workspace=${mission.missionId}$`));
  const approvals = page.locator('[data-module="approvals-register"]');
  await expect(approvals).toBeVisible();
  await expect(approvals).toHaveAttribute('data-module-truth', 'proven-empty');
  await expect(page.locator('[data-module="mission-current"]')).toBeVisible();
  await expect(draft).toHaveValue('Keep the relay open beside the registers');
  expect(approvalsReads).toBeGreaterThan(0);

  await page.getByTestId('nav-calendar').click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?workspace=${mission.missionId}$`));
  const calendar = page.locator('[data-module="calendar-horizon"]');
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute('data-module-truth', 'proven-empty');
  await expect(approvals).toBeVisible();
  await expect(draft).toHaveValue('Keep the relay open beside the registers');
  expect(calendarReads).toBeGreaterThan(0);

  const readsBeforeClose = calendarReads;
  await page.getByRole('button', { name: 'Close Calendar Horizon' }).click();
  await expect(page).toHaveURL(new RegExp(`/missions/${mission.missionId}/comms$`));
  await expect(calendar).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(calendarReads).toBe(readsBeforeClose);

  await page.getByTestId('nav-calendar').click();
  await expect(calendar).toBeVisible();
  await expect.poll(() => calendarReads).toBeGreaterThan(readsBeforeClose);
  await expect(page.locator('[data-module="calendar-horizon"]')).toHaveCount(1);

  await page.goto('/approvals');
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(0);
  await expect(page.locator('[data-module="approvals-register"]')).toHaveCount(0);
  await expect(page.getByTestId('approvals-empty')).toBeVisible();
});

test('Command & Coordination: Constellation, personal Attention, and Continuity form one navigable command loop', async ({ page }) => {
  await login(page);
  const thread = {
    threadId: 'THR-9002',
    kind: 'anchored',
    anchorType: 'Mission',
    anchorId: mission.missionId,
    title: mission.name,
    status: 'active',
    lastSeq: 1,
    lastMessageAt: '2026-08-05T10:04:00.000Z',
    createdAt: '2026-08-05T10:00:00.000Z',
  };
  const decision = {
    recalled: false,
    messageId: 'MSG-9001',
    threadId: thread.threadId,
    seq: 1,
    authorship: { kind: 'person', userId: 'user-commander', label: 'Commander' },
    authorUserId: 'user-commander',
    authorLabel: 'Commander',
    revisionNo: 1,
    createdAt: '2026-08-05T10:04:00.000Z',
    body: 'Hold the northern relay until the handover is witnessed.',
    links: [],
    attachments: [],
    messageKind: 'decision',
    supersedesMessageId: null,
    blocks: [],
  };

  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => fulfillJson(route, { mission }));
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread, messages: [decision], myLastReadSeq: 0 }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );
  await page.route('**/api/v1/comms/ledger', (route) =>
    fulfillJson(route, {
      awaitingMyAcceptance: [],
      awaitingMyDelivery: [],
      awaitingMySettle: [],
      watching: [],
      threads: [{ thread, myLastReadSeq: 0, unread: 1 }],
    }),
  );
  await page.route('**/api/v1/situation', (route) =>
    fulfillJson(route, {
      todayIso: '2026-08-05',
      counts: { activeMissions: 1, rosteredPlayers: 4, credentialsTracked: 4, liveAgreements: 1, openApprovals: 0 },
      checks: ['Mission readiness', 'Governance wedge', 'Credential expiry'],
      signals: [
        {
          key: `MissionReadiness:${mission.missionId}`,
          kind: 'MissionReadiness',
          headline: 'Mission handover still needs a witnessed owner',
          reasons: ['The mission is active.', 'The handover record has no named successor.'],
          impact: 3,
          urgency: 2,
          score: 6,
          band: 'immediate',
          inMotion: false,
          actions: [{ kind: 'ViewMission', missionId: mission.missionId }],
        },
      ],
    }),
  );

  await page.goto(`/missions/${mission.missionId}/comms`);
  const routeIntents = page.getByRole('navigation', { name: 'Global intent' });
  await routeIntents.getByRole('link', { name: 'Constellation', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/situation\\?workspace=${mission.missionId}$`));

  const constellation = page.locator('[data-module="command-constellation"]');
  const attention = page.locator('[data-module="command-attention"]');
  await expect(constellation).toBeVisible();
  await expect(constellation).toHaveAttribute('data-module-truth', 'verified');
  await expect(constellation.getByText('Mission handover still needs a witnessed owner')).toBeVisible();
  await expect(constellation.getByText('3 checks ran')).toBeVisible();
  await expect(attention).toBeVisible();
  await expect(attention).toHaveAttribute('data-module-truth', /^(verified|stale)$/);
  await expect(attention.getByTestId(`attention-thread-${thread.threadId}`)).toContainText('1 unread');

  await constellation.getByRole('link', { name: 'Open view mission' }).click();
  await expect(page.locator('[data-module="mission-current"]')).toBeVisible();
  await expect(constellation).toBeVisible();

  await routeIntents.getByRole('link', { name: 'Continuity', exact: true }).click();
  const continuity = page.locator('[data-module="mission-continuity"]');
  await expect(continuity).toBeVisible();
  await expect(continuity).toHaveAttribute('data-module-truth', /^(verified|stale)$/);
  const continuityTruth = await continuity.getAttribute('data-module-truth');
  await expect(continuity.locator('[data-continuity-complete]')).toHaveAttribute(
    'data-continuity-complete',
    continuityTruth === 'verified' ? 'true' : 'false',
  );
  await expect(continuity.getByText('Decision recorded')).toBeVisible();

  await continuity.getByRole('button', { name: `Focus ${decision.messageId}` }).click();
  await expect(page).toHaveURL(new RegExp(`/missions/${mission.missionId}/comms#msg-${decision.messageId}$`));
  await expect(page.locator(`#msg-${decision.messageId}`)).toBeFocused();
});

test('Command & Coordination: a transient Conversation Relay keeps geometry, not private identity', async ({ page }) => {
  await login(page);
  const firstThread = {
    threadId: 'THR-9003',
    kind: 'direct',
    anchorType: null,
    anchorId: null,
    title: 'Field pair',
    status: 'active',
    lastSeq: 1,
    lastMessageAt: '2026-08-05T20:14:00.000Z',
    createdAt: '2026-08-05T20:00:00.000Z',
  };
  const secondThread = {
    ...firstThread,
    threadId: 'THR-9004',
    kind: 'standing',
    title: 'Ops room',
    lastMessageAt: '2026-08-05T20:16:00.000Z',
  };
  const roomPayload = (thread: typeof firstThread | typeof secondThread, body: string) => ({
    thread,
    messages: [
      {
        recalled: false,
        messageId: thread.threadId === firstThread.threadId ? 'MSG-9003' : 'MSG-9004',
        threadId: thread.threadId,
        seq: 1,
        authorship: { kind: 'person', userId: 'user-relay', label: 'Relay operator' },
        authorUserId: 'user-relay',
        authorLabel: 'Relay operator',
        revisionNo: 1,
        createdAt: thread.lastMessageAt,
        body,
        links: [],
        attachments: [],
        messageKind: 'note',
        supersedesMessageId: null,
        blocks: [],
      },
    ],
    myLastReadSeq: 0,
    participants: [
      { userId: 'user-relay', role: 'member', displayName: 'Relay operator' },
      { userId: 'user-partner', role: 'member', displayName: 'Field partner' },
    ],
    events: [{ eventType: 'Created', actorLabel: 'Relay operator', at: thread.createdAt }],
    retentionDays: thread.kind === 'direct' ? 30 : null,
  });
  const roomReads = new Map<string, number>();
  let streamRequests = 0;
  let missionWrites = 0;
  let denyFirstThread = false;
  let lapseWrites = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/comms/stream') streamRequests += 1;
  });

  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => fulfillJson(route, { mission }));
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, {
      receiptsEnabled: true,
      presenceEnabled: false,
      soundDirectEnabled: false,
      soundThreadEnabled: false,
      version: null,
    }),
  );
  await page.route('**/api/v1/comms/ledger', (route) =>
    fulfillJson(route, {
      awaitingMyAcceptance: [],
      awaitingMyDelivery: [],
      awaitingMySettle: [],
      watching: [],
      threads: [
        { thread: firstThread, myLastReadSeq: 0, unread: 1 },
        { thread: secondThread, myLastReadSeq: 0, unread: 1 },
      ],
    }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/messages`, (route) => {
    missionWrites += 1;
    return fulfillJson(route, { message: null });
  });
  await page.route('**/api/v1/comms/threads/**', (route) => {
    if (route.request().method() !== 'GET') {
      lapseWrites += 1;
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'MODULE_READ_ONLY', message: 'Comms is read-only.' },
        }),
      });
    }
    const threadId = new URL(route.request().url()).pathname.split('/').at(-1)!;
    roomReads.set(threadId, (roomReads.get(threadId) ?? 0) + 1);
    if (threadId === firstThread.threadId && denyFirstThread) {
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'THREAD_NOT_SEATED', message: 'This room is not available.' },
        }),
      });
    }
    return fulfillJson(
      route,
      threadId === firstThread.threadId
        ? roomPayload(firstThread, 'Meet beside the northern relay.')
        : roomPayload(secondThread, 'Keep the direct handover private.'),
    );
  });
  await page.route('**/api/v1/calendar**', (route) =>
    fulfillJson(route, { items: [], horizonDays: 90, todayIso: '2026-08-05' }),
  );

  await page.goto(`/comms?workspace=${mission.missionId}`);
  const attention = page.locator('[data-module="command-attention"]');
  await expect(attention).toBeVisible();
  await expect.poll(() => streamRequests).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const streamBaseline = streamRequests;
  const missionCurrentDraft = page.getByPlaceholder(`Write in the ${mission.name} Mission Thread`);
  await missionCurrentDraft.fill('A background control must not click through');
  await attention.getByTestId(`attention-thread-${firstThread.threadId}`).click();
  await expect(page).toHaveURL(new RegExp(`/comms/threads/${firstThread.threadId}\\?workspace=${mission.missionId}$`));

  const relay = page.locator('[data-module="conversation-relay"]');
  await expect(relay).toBeVisible();
  await expect(page.locator('[data-module="mission-current"]')).toBeVisible();
  await expect(attention).toBeVisible();
  await expect(relay).toHaveAttribute('data-module-truth', 'verified', { timeout: 20_000 });
  await page.waitForTimeout(250);
  expect(streamRequests).toBe(streamBaseline);

  await page.locator('[data-module="mission-current"]').getByRole('button', { name: 'Send', exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  expect(missionWrites).toBe(0);
  await expect(relay.getByPlaceholder('Write in this conversation')).toBeDisabled();
  await page.locator('[data-window-launcher="conversation-relay"]').click();
  await expect(relay).toHaveAttribute('data-module-truth', 'verified');

  const draft = relay.getByPlaceholder('Write in this conversation');
  await expect(draft).toBeEnabled();
  await draft.fill('Private draft stays in the live window only');
  await page.getByRole('button', { name: 'Arrange Field pair' }).click();
  await page.getByRole('button', { name: 'Right half: Field pair' }).click();
  await expect(relay).toHaveAttribute('data-window-snap', 'right-half');

  await page.getByRole('button', { name: 'Minimize Field pair' }).click();
  await expect(relay).toBeHidden();
  await page.locator('[data-window-launcher="conversation-relay"]').click();
  await expect(relay).toBeVisible();
  await expect(draft).toHaveValue('Private draft stays in the live window only');

  const storageKey = `c3:mission-command:${mission.missionId}:workspace:v2`;
  const stored = await page.evaluate((key) => localStorage.getItem(key) ?? '', storageKey);
  expect(stored).toContain('conversation-relay');
  expect(stored).not.toContain(firstThread.threadId);
  expect(stored).not.toContain('Field pair');
  expect(stored).not.toContain('Private draft');

  await page.getByRole('navigation', { name: 'Global intent' }).getByRole('link', { name: 'My Attention', exact: true }).click();
  denyFirstThread = true;
  await attention.getByTestId(`attention-thread-${firstThread.threadId}`).click();
  await expect(relay).toHaveAttribute('data-module-truth', 'denied');
  await expect(relay.getByText('This thread is not available')).toBeVisible();
  await expect(relay.getByText('Field pair')).toHaveCount(0);
  await expect(relay.getByText('Meet beside the northern relay.')).toHaveCount(0);
  await expect(relay.getByTestId('room-seats')).toHaveCount(0);
  await expect(relay.getByTestId('room-log')).toHaveCount(0);
  await expect(relay.getByTestId('retention-notice')).toHaveCount(0);

  const readsBeforeClose = roomReads.get(firstThread.threadId) ?? 0;
  await page.getByRole('button', { name: 'Close Conversation Relay' }).click();
  await expect(page).toHaveURL(new RegExp(`/missions/${mission.missionId}/comms$`));
  await expect(relay).toHaveCount(0);
  await expect(page.locator('[data-window-launcher="conversation-relay"]')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(roomReads.get(firstThread.threadId) ?? 0).toBe(readsBeforeClose);

  await page.getByRole('navigation', { name: 'Global intent' }).getByRole('link', { name: 'My Attention', exact: true }).click();
  await attention.getByTestId(`attention-thread-${secondThread.threadId}`).click();
  await expect(page).toHaveURL(new RegExp(`/comms/threads/${secondThread.threadId}\\?workspace=${mission.missionId}$`));
  await expect(relay).toBeVisible();
  await expect(relay).toHaveAttribute('data-window-snap', 'right-half');
  await expect(relay.getByPlaceholder('Write in this conversation')).toHaveValue('');

  await relay.getByPlaceholder('Write in this conversation').fill('This write should prove the shared lapse posture');
  await relay.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => lapseWrites).toBe(1);
  await expect(page.getByText('Comms access lapsed · retained history is read-only.')).toBeVisible();
  await expect(relay.locator('[data-tablework="Composer"]')).toHaveCount(0);
  await expect(page.locator('[data-module="mission-current"] [data-tablework="Composer"]')).toHaveCount(0);

  await page.getByRole('group', { name: 'Workspace layouts' }).getByRole('button', { name: 'Planning', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/missions/${mission.missionId}/comms$`));
  await expect(page.getByRole('group', { name: 'Workspace layouts' }).getByRole('button', { name: 'Planning', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-module="mission-current"]')).toBeHidden();
  await expect(page.locator('[data-window-launcher="mission-current"]')).toHaveAttribute('data-window-state', 'minimized');
  await expect(relay).toHaveCount(0);

  denyFirstThread = false;
  await page.goto(`/comms/threads/${firstThread.threadId}`);
  await expect(page).toHaveURL(new RegExp(`/comms/threads/${firstThread.threadId}$`));
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(0);
  await expect(page.locator('#thread-message')).toBeVisible();
});

test('Workspace OS: the complete header control set clears the mission identity without label collisions', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await login(page);
  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => fulfillJson(route, { mission }));
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );

  await page.goto(`/missions/${mission.missionId}/comms`);

  const header = page.locator('.mission-command-bar');
  const identity = page.locator('.mission-command-identity');
  const layouts = page.getByRole('group', { name: 'Workspace layouts' });
  const routeHeader = page.locator('.context-header');
  const routeContext = page.locator('.working-context');
  const routeIntents = page.getByRole('navigation', { name: 'Global intent' });
  await expect(header).toBeVisible();
  await expect(layouts).toBeVisible();
  await expect(routeHeader).toBeVisible();
  await expect(routeIntents).toBeVisible();

  const [headerBox, identityBox, layoutsBox] = await Promise.all([
    header.boundingBox(),
    identity.boundingBox(),
    layouts.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(identityBox).not.toBeNull();
  expect(layoutsBox).not.toBeNull();
  expect(layoutsBox!.y).toBeGreaterThanOrEqual(identityBox!.y + identityBox!.height);
  expect(layoutsBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
  expect(layoutsBox!.x + layoutsBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width + 1);

  const [routeHeaderBox, routeContextBox, routeIntentsBox] = await Promise.all([
    routeHeader.boundingBox(),
    routeContext.boundingBox(),
    routeIntents.boundingBox(),
  ]);
  expect(routeHeaderBox).not.toBeNull();
  expect(routeContextBox).not.toBeNull();
  expect(routeIntentsBox).not.toBeNull();
  expect(routeIntentsBox!.y).toBeGreaterThanOrEqual(routeContextBox!.y + routeContextBox!.height);
  expect(routeIntentsBox!.x).toBeGreaterThanOrEqual(routeHeaderBox!.x);
  expect(routeIntentsBox!.x + routeIntentsBox!.width).toBeLessThanOrEqual(routeHeaderBox!.x + routeHeaderBox!.width + 1);

  for (const name of ['Commander', 'Review', 'Brief', 'Finance', 'Decisions', 'Planning', 'Coordinate', 'Continuity', 'Command', 'People', 'Reset']) {
    await expect(layouts.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(layouts.getByRole('button', { name: /^Views/ })).toBeVisible();
  for (const name of ['Open mission workspace', 'Mission Current', 'Constellation', 'My Attention', 'People', 'Continuity', 'Finance', 'Approvals', 'Calendar']) {
    await expect(routeIntents.getByRole('link', { name, exact: true })).toBeVisible();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  const routeLinkWidths = await routeIntents.getByRole('link').evaluateAll((links) =>
    links.map((link) => ({ clientWidth: link.clientWidth, scrollWidth: link.scrollWidth })),
  );
  expect(routeLinkWidths.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth)).toBe(true);

  const [wideIdentityBox, wideLayoutsBox] = await Promise.all([
    identity.boundingBox(),
    layouts.boundingBox(),
  ]);
  expect(wideIdentityBox).not.toBeNull();
  expect(wideLayoutsBox).not.toBeNull();
  expect(wideLayoutsBox!.y).toBeGreaterThanOrEqual(wideIdentityBox!.y + wideIdentityBox!.height);
});
