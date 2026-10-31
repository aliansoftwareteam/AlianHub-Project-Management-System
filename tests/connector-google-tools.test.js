const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Modules/Mcp/oauthAuth', () => ({ ...jest.requireActual('../Modules/Mcp/oauthAuth'), standingOfGrant: jest.fn(async () => ['connectors:write']) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn(), markBackoff: jest.fn(), recordHealth: jest.fn(async () => {}) }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { resolveConnection, markBackoff } = require('../Modules/Connectors/resolveConnection');
const { recordAudit } = require('../Modules/Audit/recorder');
const logger = require('../Config/loggerConfig');
const { standingOfGrant } = require('../Modules/Mcp/oauthAuth');
const connectorTools = require('../Modules/Connectors/tools');
const google = require('../Modules/Connectors/providers/google');
const readers = require('../Modules/Agents/skills/readers');
const egressContext = require('../Modules/Agents/engine/egressContext');
const proposals = require('../Modules/Agents/proposals');
const mcpTools = require('../Modules/Mcp/tools');
const fakeGoogle = require('./fixtures/fakeGoogleApi');

/* The real Google tools, reached from an agent run and from MCP, against the fake Google server. */

const C = '6f0000000000000000000c01';
const PRISHA = '6f0000000000000000000a01';
const AGENT_ID = '6f0000000000000000000b01';
const PROJECT = '6f0000000000000000000e01';
const RUN = '6f0000000000000000000d01';
const MINE = 'conn-prisha';
const ENV = { CONNECTORS: 'google', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const ALL_SCOPES = Object.values(google.products).flat();

let fake;
const connected = (scopes = ALL_SCOPES) => resolveConnection.mockResolvedValue({ connectionId: MINE, scopes, getAccessToken: async () => fakeGoogle.TOKEN });
const actor = { kind: 'agent', userId: PRISHA, agentId: AGENT_ID, agentName: 'Digest', runId: RUN };
const agentRead = (key, input = {}) => egressContext.run({ companyId: C }, () => readers.read(key, C, { runId: RUN, actor, allowedActions: [] }, input));
const mcpCaller = (scopes) => ({
    companyId: C, userId: PRISHA, actor: { kind: 'agent', userId: PRISHA, agentName: 'Claude', viaAccount: 'external' },
    token: { oauth: true, scopes }, oauth: { clientId: 'client-1', grantId: 'grant-1' }, canWrite: true, allowedActions: [],
});
const mcpRead = (key, input = {}) => mcpTools.call(mcpCaller(['connectors:read']), key, input);
const mcpWrite = (key, input = {}) => mcpTools.call(mcpCaller(['connectors:write']), key, input);
const proposalRow = (id) => (mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).find((p) => String(p._id) === String(id));
const fromAgentRun = (action, params) => proposals.create(C, {
    agent: { _id: AGENT_ID, name: 'Digest' }, projectId: PROJECT, what: 'Do it', why: 'Asked', changes: [{ action, params }], connectionOwner: PRISHA,
});
const approve = (id) => proposals.approve(C, id, { decider: { kind: 'human', userId: PRISHA }, isPrivileged: false, ip: '' });
const lastCall = () => fake.state.calls[fake.state.calls.length - 1];

const NEW_EVENT = { summary: 'Team lunch', start: '2026-11-05T13:00:00+05:30', end: '2026-11-05T14:00:00+05:30', location: 'Cafe', attendees: 'sam@example.com, jo@example.com' };

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    fake = fakeGoogle.create();
    connected();
    standingOfGrant.mockResolvedValue(['connectors:write']);
    safeFetch.mockImplementation(fake.fetch);
    markBackoff.mockImplementation(async ({ connectionId, until }) => mockDb.seed(SCHEMA_TYPE.CONNECTOR_CONNECTIONS, { _id: connectionId, backoffUntil: until }));
    mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN, status: 'running', connectorReads: [] });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Digest', allowedActions: [], autonomy: 3 });
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('the Google tool definitions', () => {
    const googleTools = () => connectorTools.all().filter((tool) => tool.provider === 'google');

    it('all load, on the product and scope the provider definition names', () => {
        expect(googleTools().map((tool) => tool.key).sort()).toEqual([
            'google.calendar.events.create', 'google.calendar.events.get', 'google.calendar.events.list', 'google.calendar.events.update',
            'google.drive.files.get', 'google.drive.files.list', 'google.drive.files.read',
            'google.meet.spaces.create', 'google.meet.spaces.get',
        ]);
        expect(connectorTools.problemsOf(google, googleTools())).toEqual([]);
    });

    it('have no Gmail tool and no Drive write', () => {
        expect(googleTools().filter((tool) => tool.product === 'gmail')).toEqual([]);
        expect(googleTools().filter((tool) => tool.product === 'drive' && tool.kind === 'write')).toEqual([]);
    });

    it('have a label in en.js, and so does every row of their cards', () => {
        const en = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        googleTools().forEach((tool) => expect(en).toContain(`${tool.label.replace('Connectors.tool.', '')}: "`));
        const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'Modules', 'Connectors', 'providers', 'google', 'tools.js'), 'utf8');
        const keys = [...new Set(source.match(/Connectors\.card\.[A-Za-z]+/g))];
        expect(keys.length).toBeGreaterThan(10);
        keys.forEach((key) => expect(en).toContain(`${key.replace('Connectors.card.', '')}: "`));
    });

    it('still refuse a key that is not provider, optional product, object and verb', () => {
        const good = googleTools()[0];
        expect(connectorTools.problemsOf(google, [{ ...good, key: 'google.list' }]).join()).toMatch(/is not <provider>/);
        expect(connectorTools.problemsOf(google, [{ ...good, key: 'google.a.b.c.d' }]).join()).toMatch(/is not <provider>/);
    });

    it('are offered only while CONNECTORS names google', () => {
        expect(mcpTools.names()).toContain('google.calendar.events.list');
        process.env.CONNECTORS = 'slack';
        expect(mcpTools.names()).not.toContain('google.calendar.events.list');
    });
});

const READS = [
    ['google.calendar.events.list', { timeMin: '2026-11-01T00:00:00Z' }, /Board meeting at Room 4 \[id: ev1\][\s\S]*Call the bank/],
    ['google.calendar.events.get', { eventId: 'ev1' }, /Attendees: sam@example.com \(accepted\)[\s\S]*Description: Budget/],
    ['google.meet.spaces.get', { space: 'spaces/sp1' }, /Link: https:\/\/meet.google.com\/abc-mnop-xyz[\s\S]*Access: TRUSTED[\s\S]*Call live now: no/],
    ['google.drive.files.list', {}, /Q4 plan[\s\S]*\[id: doc1\]/],
    ['google.drive.files.get', { fileId: 'txt1' }, /Name: notes.txt[\s\S]*Bytes: 12/],
    ['google.drive.files.read', { fileId: 'doc1' }, /The Q4 plan text/],
];

describe.each(READS)('the read %s', (key, input, shows) => {
    it('answers an agent run on the person\'s own connection and marks the run', async () => {
        const out = await agentRead(key, input);
        expect(out.text).toMatch(shows);
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: PRISHA, provider: 'google' });
        expect(out.taint[0]).toMatchObject({ kind: 'connector', ref: expect.stringMatching(/^google:/) });
    });

    it('answers MCP', async () => {
        const out = await mcpRead(key, input);
        expect(out.text).toMatch(shows);
    });

    it('names the product to tick when its scope is missing', async () => {
        connected([]);
        const product = connectorTools.get(key).product;
        expect(await mcpRead(key, input)).toEqual({ code: 'scope_missing', error: `Tick ${product} on your Google connection in My connections, then ask again.` });
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('Calendar reads', () => {
    it('reads from now on unless told otherwise, one line per occurrence, oldest first', async () => {
        await mcpRead('google.calendar.events.list');
        const { searchParams } = lastCall().url;
        expect(searchParams.get('singleEvents')).toBe('true');
        expect(searchParams.get('orderBy')).toBe('startTime');
        expect(new Date(searchParams.get('timeMin')).getTime()).toBeLessThanOrEqual(Date.now());
        expect(searchParams.has('timeMax')).toBe(false);
        expect(searchParams.has('q')).toBe(false);
    });

    it('sends the window, search and limit', async () => {
        const out = await mcpRead('google.calendar.events.list', { timeMin: '2026-11-01T00:00:00Z', timeMax: '2026-12-01T00:00:00Z', search: 'bank', limit: 1 });
        expect(out.text).toBe('- 2026-11-03T10:00:00+05:30 to 2026-11-03T10:30:00+05:30: Call the bank [id: ev2]');
        expect(lastCall().url.searchParams.get('maxResults')).toBe('1');
    });

    it('refuses a time without its offset before calling Google', async () => {
        await expect(mcpRead('google.calendar.events.list', { timeMin: '2026-11-01 10:00' })).rejects.toThrow(/timeMin is not in the form/);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('keeps a calendar id inside the path', async () => {
        await mcpRead('google.calendar.events.get', { calendarId: '../../evil', eventId: 'ev1' });
        expect(lastCall().url.pathname).toBe('/calendar/v3/calendars/..%2F..%2Fevil/events/ev1');
    });

    it('turns Google\'s not found into a refusal, not an answer', async () => {
        expect(await mcpRead('google.calendar.events.get', { eventId: 'gone' })).toEqual({ code: 'provider_refused', error: 'Google answered 404, so this did not go through.' });
    });
});

describe('Meet reads', () => {
    it('finds a space by its meeting code', async () => {
        const out = await mcpRead('google.meet.spaces.get', { space: 'abc-mnop-xyz' });
        expect(out.text).toContain('Space: spaces/sp1');
    });

    it('refuses a space that is not a name or a code', async () => {
        await expect(mcpRead('google.meet.spaces.get', { space: '../files/x' })).rejects.toThrow(/space is not in the form/);
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('Drive reads', () => {
    it('reads a Sheet as CSV and a text file as it is', async () => {
        expect((await mcpRead('google.drive.files.read', { fileId: 'sheet1' })).text).toBe('item,cost\nchairs,10');
        expect((await mcpRead('google.drive.files.read', { fileId: 'txt1' })).text).toBe('Plain notes');
    });

    it('says a binary file cannot be read and never downloads it', async () => {
        const out = await mcpRead('google.drive.files.read', { fileId: 'img1' });
        expect(out.text).toBe('photo.png is image/png, which cannot be read as text.');
        expect(fake.state.calls).toHaveLength(1);
    });

    it('cannot be talked out of its name filter', async () => {
        await mcpRead('google.drive.files.list', { name: "x' or trashed = true or name contains '" });
        expect(lastCall().url.searchParams.get('q')).toBe("trashed = false and name contains 'x\\' or trashed = true or name contains \\''");
    });

    it('refuses a file id that would step out of its URL path', async () => {
        await expect(mcpRead('google.drive.files.read', { fileId: '..' })).rejects.toThrow(/fileId is not in the form/);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('a file the person did not pick is refused by Google', async () => {
        expect(await mcpRead('google.drive.files.read', { fileId: 'not-picked' })).toMatchObject({ code: 'provider_refused' });
    });
});

const WRITES = [
    ['google.calendar.events.create', NEW_EVENT, () => fake.state.events.find((e) => e.summary === 'Team lunch'), /Created event ev3/],
    ['google.calendar.events.update', { eventId: 'ev1', summary: 'Board moved' }, () => fake.state.events.find((e) => e.summary === 'Board moved'), /Updated event ev1/],
    ['google.meet.spaces.create', { accessType: 'RESTRICTED' }, () => fake.state.spaces.find((s) => s.config.accessType === 'RESTRICTED'), /Created meeting new-meet-ing/],
];

describe.each(WRITES)('the write %s', (key, input, madeAtGoogle, answer) => {
    it('from an agent run waits for its owner, then goes out once', async () => {
        const p = await fromAgentRun(key, input);
        expect(p).toMatchObject({ status: 'pending', gate: 'connection_owner', connectionOwner: PRISHA });
        expect(safeFetch).not.toHaveBeenCalled();
        const out = await approve(p.proposalId || p._id);
        expect(out.applied).toEqual([expect.objectContaining({ action: key, ok: true })]);
        expect(madeAtGoogle()).toBeTruthy();
        expect(proposalRow(p.proposalId || p._id).delivery[0].answer).toMatch(answer);
    });

    it('from MCP waits in the Inbox, then goes out once its owner approves', async () => {
        const { proposalId } = await mcpWrite(key, input);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(proposalRow(proposalId)).toMatchObject({ status: 'pending', connectionOwner: PRISHA });
        await approve(proposalId);
        expect(madeAtGoogle()).toBeTruthy();
        expect(fake.state.calls.filter((call) => call.method !== 'get')).toHaveLength(1);
    });

    it('names the product to tick when its scope is missing', async () => {
        connected([]);
        const product = connectorTools.get(key).product;
        expect(await mcpWrite(key, input)).toEqual({ code: 'scope_missing', error: `Tick ${product} on your Google connection in My connections, then ask again.` });
    });
});

describe('Calendar writes', () => {
    it('sends what the card shows, and emails nobody unless asked', async () => {
        const { proposalId } = await mcpWrite('google.calendar.events.create', NEW_EVENT);
        const { card } = proposalRow(proposalId).changes[0];
        expect(card).toMatchObject({ target: '', targetLabel: 'Connectors.card.primaryCalendar', title: 'Team lunch' });
        expect(card.rows).toEqual([
            { label: 'Connectors.card.start', value: NEW_EVENT.start },
            { label: 'Connectors.card.end', value: NEW_EVENT.end },
            { label: 'Connectors.card.where', value: 'Cafe' },
            { label: 'Connectors.card.attendees', value: 'sam@example.com, jo@example.com' },
            { label: 'Connectors.card.notifyAttendees', valueLabel: 'Connectors.card.no' },
        ]);
        await approve(proposalId);
        expect(lastCall().url.searchParams.get('sendUpdates')).toBe('none');
        expect(lastCall().body).toEqual({
            summary: 'Team lunch', location: 'Cafe',
            start: { dateTime: NEW_EVENT.start }, end: { dateTime: NEW_EVENT.end },
            attendees: [{ email: 'sam@example.com' }, { email: 'jo@example.com' }],
        });
    });

    it('says so on the card when Google will email the attendees', async () => {
        const { proposalId } = await mcpWrite('google.calendar.events.create', { ...NEW_EVENT, notifyAttendees: true });
        expect(proposalRow(proposalId).changes[0].card.rows).toContainEqual({ label: 'Connectors.card.notifyAttendees', valueLabel: 'Connectors.card.yes' });
        await approve(proposalId);
        expect(lastCall().url.searchParams.get('sendUpdates')).toBe('all');
    });

    it('makes an all-day event from a plain date', async () => {
        const { proposalId } = await mcpWrite('google.calendar.events.create', { summary: 'Holiday', start: '2026-11-09', end: '2026-11-10' });
        await approve(proposalId);
        expect(lastCall().body).toMatchObject({ start: { date: '2026-11-09' }, end: { date: '2026-11-10' } });
    });

    it('an update sends only what it names and warns that attendees replace the list', async () => {
        const { proposalId } = await mcpWrite('google.calendar.events.update', { eventId: 'ev1', attendees: 'jo@example.com' });
        const { card } = proposalRow(proposalId).changes[0];
        expect(card.title).toBe('ev1');
        expect(card.rows).toContainEqual({ label: 'Connectors.card.eventId', value: 'ev1' });
        expect(card.rows).toContainEqual({ label: 'Connectors.card.attendeesReplaced', value: 'jo@example.com' });
        await approve(proposalId);
        expect(lastCall().method).toBe('patch');
        expect(lastCall().body).toEqual({ attendees: [{ email: 'jo@example.com' }] });
    });

    it('shows on the card that an update clears the attendees', async () => {
        const { proposalId } = await mcpWrite('google.calendar.events.update', { eventId: 'ev1', attendees: ' , ' });
        expect(proposalRow(proposalId).changes[0].card.rows).toContainEqual({ label: 'Connectors.card.attendeesReplaced', valueLabel: 'Connectors.card.nobody' });
    });

    it.each([
        ['summary', 'Connectors.card.title'],
        ['description', 'Connectors.card.description'],
        ['location', 'Connectors.card.where'],
    ])('shows on the card that a blank %s clears it at Google', async (field, label) => {
        for (const blank of ['', '   ']) {
            // eslint-disable-next-line no-await-in-loop
            const { proposalId } = await mcpWrite('google.calendar.events.update', { eventId: 'ev1', [field]: blank });
            const { card } = proposalRow(proposalId).changes[0];
            expect(card.title).toBe('ev1');
            expect(card.rows).toContainEqual({ label, valueLabel: 'Connectors.card.cleared' });
            // eslint-disable-next-line no-await-in-loop
            await approve(proposalId);
            expect(lastCall().body).toEqual({ [field]: blank });
        }
    });

    it.each([['calendarId', { eventId: 'ev1', calendarId: '..' }], ['eventId', { eventId: '..' }], ['eventId', { eventId: '.' }]])('refuses a %s that would step out of its URL path', async (field, input) => {
        await expect(mcpRead('google.calendar.events.get', input)).rejects.toThrow(new RegExp(`${field} is not in the form`));
        await expect(mcpWrite('google.calendar.events.update', { ...input, summary: 'x' })).rejects.toThrow(new RegExp(`${field} is not in the form`));
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('an update that changes nothing is not filed', async () => {
        const out = await mcpWrite('google.calendar.events.update', { eventId: 'ev1', notifyAttendees: true });
        expect(out).toMatchObject({ code: 'bad_input' });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toEqual([]);
    });

    it('reports Google\'s refusal of an approved write as not delivered', async () => {
        const { proposalId } = await mcpWrite('google.calendar.events.update', { eventId: 'gone', summary: 'x' });
        const out = await approve(proposalId);
        expect(out.applied).toEqual([expect.objectContaining({ ok: false })]);
        expect(proposalRow(proposalId).delivery[0]).toMatchObject({ ok: false, error: 'Google answered 404, so this did not go through.' });
    });
});

describe('Meet writes', () => {
    it('shows who can join on the card', async () => {
        const { proposalId } = await mcpWrite('google.meet.spaces.create', { accessType: 'OPEN' });
        expect(proposalRow(proposalId).changes[0].card).toMatchObject({ target: 'Google Meet', rows: [{ label: 'Connectors.card.access', valueLabel: 'Connectors.card.accessOpen' }] });
        await approve(proposalId);
        expect(lastCall().body).toEqual({ config: { accessType: 'OPEN' } });
    });

    it('leaves access to the organisation\'s default when not asked, and says so', async () => {
        const { proposalId } = await mcpWrite('google.meet.spaces.create');
        expect(proposalRow(proposalId).changes[0].card.rows).toEqual([{ label: 'Connectors.card.access', valueLabel: 'Connectors.card.accessDefault' }]);
        await approve(proposalId);
        expect(lastCall().body).toEqual({});
    });

    it('refuses an access type Google does not have', async () => {
        await expect(mcpWrite('google.meet.spaces.create', { accessType: 'ALL' })).rejects.toThrow(/accessType must be one of/);
    });
});

describe('what a card may hold', () => {
    const writes = require('../Modules/Connectors/writes');
    const tool = (shown) => ({ provider: 'google', key: 'k', label: 'l', card: () => shown });

    it('refuses a row whose label is not an i18n key', () => {
        expect(() => writes.cardOf(tool({ rows: [{ label: 'Starts', value: 'x' }] }), {})).toThrow(/Connectors\.card/);
        expect(() => writes.cardOf(tool({ rows: [{ label: 'Connectors.card.start', valueLabel: 'Yes' }] }), {})).toThrow(/Connectors\.card/);
    });

    it('refuses a value too long to show whole', () => {
        expect(() => writes.cardOf(tool({ rows: [{ label: 'Connectors.card.where', value: 'x'.repeat(20001) }] }), {})).toThrow(/details of this write is too long/);
    });
});

describe('what stays out of sight', () => {
    const everywhere = () => JSON.stringify([recordAudit.mock.calls, logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls, logger.debug.mock.calls]);

    it('no token or event content reaches an audit row or a log, and the token reaches only Google', async () => {
        await mcpRead('google.calendar.events.get', { eventId: 'ev1' });
        await mcpRead('google.drive.files.read', { fileId: 'doc1' });
        const { proposalId } = await mcpWrite('google.calendar.events.create', NEW_EVENT);
        await approve(proposalId);
        await mcpRead('google.calendar.events.get', { eventId: 'gone' });

        expect(recordAudit.mock.calls.filter(([, row]) => row.action === 'connector.call').length).toBeGreaterThanOrEqual(4);
        ['Board meeting', 'The Q4 plan text', 'Team lunch', 'sam@example.com', fakeGoogle.TOKEN].forEach((secret) => expect(everywhere()).not.toContain(secret));
        expect(JSON.stringify(proposalRow(proposalId))).not.toContain(fakeGoogle.TOKEN);
        safeFetch.mock.calls.forEach(([url]) => expect(google.egressHosts).toContain(new URL(url).hostname));
    });
});

describe('when Google says slow down', () => {
    it('a 429 holds the connection, and the next call never reaches Google', async () => {
        fake.state.next = fakeGoogle.answer(429, { error: { code: 429, message: 'Too Many Requests' } }, { 'retry-after': '30' });
        expect(await mcpRead('google.meet.spaces.get', { space: 'sp1' })).toMatchObject({ code: 'provider_busy' });
        expect(markBackoff).toHaveBeenCalledWith(expect.objectContaining({ connectionId: MINE }));
        const calls = fake.state.calls.length;
        expect(await mcpRead('google.drive.files.list')).toMatchObject({ code: 'provider_busy' });
        expect(fake.state.calls).toHaveLength(calls);
    });

    it('a 403 for its rate limit holds it too', async () => {
        fake.state.next = fakeGoogle.googleError(403, 'rateLimitExceeded', 'Rate Limit Exceeded');
        expect(await mcpRead('google.calendar.events.list')).toMatchObject({ code: 'provider_busy' });
        expect(markBackoff).toHaveBeenCalled();
    });

    it('a 403 for anything else is a plain refusal and holds nothing', async () => {
        fake.state.next = fakeGoogle.googleError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.');
        expect(await mcpRead('google.calendar.events.list')).toEqual({ code: 'provider_refused', error: 'Google answered 403, so this did not go through.' });
        expect(markBackoff).not.toHaveBeenCalled();
    });

    it('an approved write that Google holds back is not delivered', async () => {
        const { proposalId } = await mcpWrite('google.meet.spaces.create');
        fake.state.next = fakeGoogle.answer(429, {}, { 'retry-after': '30' });
        const out = await approve(proposalId);
        expect(out.applied).toEqual([expect.objectContaining({ ok: false })]);
        expect(fake.state.spaces).toHaveLength(1);
    });
});
