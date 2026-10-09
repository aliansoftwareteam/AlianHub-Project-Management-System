/* The workspace's daily AI budget beside the monthly one: every metered call
 * is held against today's (UTC) spend and the month's, refused before the
 * vendor is reached when either would pass, and announced at 80% and 100% of
 * the day. The vendor is a stub with the registry's shape. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, capabilities: { structuredOutput: 'json_object', defaultMaxTokens: 128000 }, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const { FEATURES } = require('../Modules/AICore/features');
const spend = require('../Modules/AICore/spend');
const reservation = require('../Modules/AICore/reservation');
const budget = require('../Modules/Agents/budget');

const C = '6f0000000000000000000c07';
const MESSAGES = [{ role: 'user', content: 'hello' }];
const MAX_TOKENS = 100000;
const ESTIMATE_USD = 0.8;
const NOON = new Date('2026-10-09T12:00:00.000Z');
const FAKE = { doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] };

const answer = () => ({ content: '{"ok":true}', inputTokens: 1000, outputTokens: 500, model: 'gpt-4.1' });
const call = (over = {}) => getProvider().chat({ messages: MESSAGES, maxTokens: MAX_TOKENS, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' }, ...over });
const holds = () => mockDb.store[SCHEMA_TYPE.AI_RESERVATIONS] || [];
const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const company = () => mockDb.store[dbCollections.COMPANIES][0];
const seedCompany = (over = {}) => mockDb.seed(dbCollections.COMPANIES, { _id: C, ...over });
const seedSpend = (usd, at = new Date(), over = {}) => mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', costUsd: usd, totalTokens: 10, billedToWorkspace: true, at, ...over });

beforeEach(() => {
    jest.useFakeTimers({ now: NOON, ...FAKE });
    jest.clearAllMocks();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'owner1', roleType: 1 });
    process.env.AI_MODEL_ROUTER = 'on';
    delete process.env.AI_RESERVATION_TTL_MS;
    delete process.env.LLM_PROVIDER;
    adapter.chat.mockImplementation(async () => answer());
});

afterEach(() => { jest.useRealTimers(); });

afterAll(() => { delete process.env.AI_MODEL_ROUTER; });

describe('settings', () => {
    it('reads agentDailyBudgetUsd, with 0, a missing or a bad value meaning no daily limit', async () => {
        expect((await budget.settings(C)).dailyBudgetUsd).toBe(0);
        seedCompany({ agentDailyBudgetUsd: 5 });
        expect((await budget.settings(C)).dailyBudgetUsd).toBe(5);
        company().agentDailyBudgetUsd = -2;
        expect((await budget.settings(C)).dailyBudgetUsd).toBe(0);
    });

    it('validates dailyBudgetUsd like the monthly field', () => {
        expect(budget.validate({ dailyBudgetUsd: '2.5' })).toEqual({ set: { agentDailyBudgetUsd: 2.5 } });
        expect(budget.validate({ dailyBudgetUsd: 0 })).toEqual({ set: { agentDailyBudgetUsd: 0 } });
        for (const bad of [-1, 'abc', '', null, NaN]) expect(budget.validate({ dailyBudgetUsd: bad })).toEqual({ error: 'dailyBudgetUsd must be a number of 0 or more (0 means no daily limit).' });
    });
});

describe('the pre-call reservation', () => {
    it('refuses a call that would pass today\'s budget before the vendor is reached, saying so', async () => {
        seedCompany({ agentDailyBudgetUsd: 1 });
        seedSpend(0.5);

        const refused = await call().catch((e) => e);
        expect(refused).toMatchObject({ code: reservation.BUDGET_EXHAUSTED });
        expect(refused.message).toContain('daily budget of $1');
        expect(refused.message).toContain('left today (UTC)');
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(holds()[0]).toMatchObject({ state: 'released' });
        expect(await reservation.heldUsdOn(C)).toBe(0);
    });

    it('lets the call through when it fits both the day and the month, and holds it against each', async () => {
        seedCompany({ agentDailyBudgetUsd: 2, agentMonthlyBudgetUsd: 10 });
        seedSpend(0.5);
        let heldDuring = null;
        adapter.chat.mockImplementation(async () => {
            heldDuring = { day: await reservation.heldUsdOn(C), month: await reservation.heldUsd(C) };
            return answer();
        });

        await expect(call()).resolves.toMatchObject({ content: '{"ok":true}' });
        expect(heldDuring).toEqual({ day: ESTIMATE_USD, month: ESTIMATE_USD });
        expect(holds()[0]).toMatchObject({ state: 'settled' });
    });

    it('refuses on the monthly budget when the day has room, and says it is the month', async () => {
        seedCompany({ agentDailyBudgetUsd: 50, agentMonthlyBudgetUsd: 1 });
        seedSpend(0.5, new Date('2026-10-02T12:00:00.000Z'));

        const refused = await call().catch((e) => e);
        expect(refused).toMatchObject({ code: reservation.BUDGET_EXHAUSTED, period: 'monthly' });
        expect(refused.message).toContain('left this month');
        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('refuses on the day when the month has room', async () => {
        seedCompany({ agentDailyBudgetUsd: 1, agentMonthlyBudgetUsd: 500 });
        seedSpend(0.5);
        await expect(call()).rejects.toMatchObject({ code: reservation.BUDGET_EXHAUSTED, period: 'daily' });
    });

    it('does not limit the day while the daily budget is 0 or unset', async () => {
        seedCompany({ agentDailyBudgetUsd: 0 });
        seedSpend(900);
        await expect(call()).resolves.toBeDefined();
        expect(holds()).toHaveLength(0);
    });

    it('holds for a daily budget alone, with no monthly budget set', async () => {
        seedCompany({ agentDailyBudgetUsd: 5 });
        await expect(call()).resolves.toBeDefined();
        expect(holds()).toHaveLength(1);
    });

    it('refuses embeddings and audio on the day as it does chat', async () => {
        seedCompany({ agentDailyBudgetUsd: 0.1 });
        seedSpend(0.1);
        const minute = { spend: { feature: 'transcription', companyId: C }, model: 'whisper-1', provider: 'openai', usdPerMinute: 0.006, seconds: 600 };
        const vendor = jest.fn(async () => ({ seconds: 600 }));
        await expect(spend.audio(minute, vendor)).rejects.toMatchObject({ code: reservation.BUDGET_EXHAUSTED, period: 'daily' });
        expect(vendor).not.toHaveBeenCalled();

        adapter.embed = jest.fn(async () => ({ vectors: [[0]], inputTokens: 5, model: 'text-embedding-3-small' }));
        await expect(getProvider().embed({ texts: ['x'.repeat(400000)], model: 'text-embedding-3-small', spend: { feature: FEATURES.KNOWLEDGE_EMBED, companyId: C } })).rejects.toMatchObject({ code: reservation.BUDGET_EXHAUSTED, period: 'daily' });
        expect(adapter.embed).not.toHaveBeenCalled();
    });
});

describe('the day rolling over at UTC midnight', () => {
    it('counts the day\'s spend from 00:00 UTC, so yesterday\'s late spend stops counting at midnight', async () => {
        seedCompany({ agentDailyBudgetUsd: 1 });
        jest.setSystemTime(new Date('2026-10-09T23:59:00.000Z'));
        seedSpend(0.5, new Date('2026-10-09T23:58:00.000Z'));
        await expect(call()).rejects.toMatchObject({ code: reservation.BUDGET_EXHAUSTED, period: 'daily' });

        jest.setSystemTime(new Date('2026-10-10T00:00:00.000Z'));
        expect((await spend.daily(C)).usedUsd).toBe(0);
        await expect(call()).resolves.toBeDefined();
    });

    it('does not carry a hold across midnight into the new day', async () => {
        seedCompany({ agentDailyBudgetUsd: 1 });
        jest.setSystemTime(new Date('2026-10-09T23:59:50.000Z'));
        mockDb.seed(SCHEMA_TYPE.AI_RESERVATIONS, { companyId: C, feature: 'ask', state: 'held', amountUsd: 0.9, at: new Date(), expiresAt: new Date(Date.now() + 900000) });
        await expect(call()).rejects.toMatchObject({ period: 'daily' });

        jest.setSystemTime(new Date('2026-10-10T00:00:05.000Z'));
        expect(await reservation.heldUsdOn(C)).toBe(0);
        await expect(call()).resolves.toBeDefined();
    });

    it('is a different day for a monthly budget, which keeps counting', async () => {
        seedCompany({ agentDailyBudgetUsd: 1, agentMonthlyBudgetUsd: 1 });
        seedSpend(0.5, new Date('2026-10-09T23:00:00.000Z'));
        jest.setSystemTime(new Date('2026-10-10T00:30:00.000Z'));
        await expect(call()).rejects.toMatchObject({ period: 'monthly' });
    });
});

describe('concurrent reservations', () => {
    it('let through no more than the day can take when they race for it', async () => {
        seedCompany({ agentDailyBudgetUsd: 2 });
        const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => call({ spend: { feature: FEATURES.AGENT_RUN, companyId: C, runId: `run-${i}` } }).catch((e) => e)));

        const answered = outcomes.filter((o) => !(o instanceof Error));
        const refused = outcomes.filter((o) => o instanceof Error);
        expect(answered.length).toBeGreaterThanOrEqual(1);
        expect(answered.length * ESTIMATE_USD).toBeLessThanOrEqual(2 + ESTIMATE_USD);
        expect(answered).toHaveLength(2);
        expect(refused.every((e) => e.code === reservation.BUDGET_EXHAUSTED && e.period === 'daily')).toBe(true);
        expect(adapter.chat).toHaveBeenCalledTimes(answered.length);
        expect(await reservation.heldUsdOn(C)).toBe(0);
    });

    it('respect the tighter of the day and the month together', async () => {
        seedCompany({ agentDailyBudgetUsd: 100, agentMonthlyBudgetUsd: 1 });
        const outcomes = await Promise.all(Array.from({ length: 5 }, () => call().catch((e) => e)));
        expect(outcomes.filter((o) => !(o instanceof Error))).toHaveLength(1);
    });
});

describe('status, headroom and the cheap check', () => {
    it('reports today\'s spend against the daily limit beside the month\'s', async () => {
        seedCompany({ agentDailyBudgetUsd: 4, agentMonthlyBudgetUsd: 40 });
        seedSpend(3);
        seedSpend(5, new Date('2026-10-02T12:00:00.000Z'));
        seedSpend(7, new Date('2026-10-09T12:00:00.000Z'), { billedToWorkspace: false });

        const s = await budget.status(C);
        expect(s).toMatchObject({ month: '2026-10', usedUsd: 8, budgetUsd: 40, percent: 20 });
        expect(s.daily).toEqual({ day: '2026-10-09', usedUsd: 3, budgetUsd: 4, percent: 75, alerts: { 80: null, 100: null } });
    });

    it('answers headroom for both and refuses check() once the day is spent', async () => {
        seedCompany({ agentDailyBudgetUsd: 4, agentMonthlyBudgetUsd: 40 });
        seedSpend(3);
        expect(await budget.headroom(C)).toMatchObject({ remainingUsd: 37, daily: { budgetUsd: 4, usedUsd: 3, reservedUsd: 0, remainingUsd: 1 } });
        expect(await budget.check(C)).toEqual({ ok: true, reason: '' });

        seedSpend(1);
        const out = await budget.check(C);
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/daily AI budget reached \(\$4\.00 of \$4 today, UTC\)/);

        jest.setSystemTime(new Date('2026-10-10T00:00:01.000Z'));
        expect(await budget.check(C)).toEqual({ ok: true, reason: '' });
    });
});

describe('80% and 100% alerts of the day', () => {
    it('notify owners and admins once per level, stamp the day, and start again the next day', async () => {
        seedCompany({ agentDailyBudgetUsd: 10 });
        seedSpend(8.5);
        await budget.alertIfCrossed(C, { feature: 'ask', userId: 'u1' });
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);
        expect(handleNotificationtFun.mock.calls[0][0].body).toMatchObject({
            changeType: 'agent_budget', assigneeUsers: ['owner1'],
            message: 'AI daily budget at 85%: $8.50 of $10 used today (UTC).',
            changeData: { period: 'daily', day: '2026-10-09', level: '80', usedUsd: 8.5, budgetUsd: 10, percent: 85 },
        });
        expect(company().agentDailyBudgetAlerts).toEqual({ day: '2026-10-09', 80: expect.any(Date), 100: null });

        await budget.alertIfCrossed(C, { feature: 'ask' });
        expect(handleNotificationtFun).toHaveBeenCalledTimes(1);

        seedSpend(2);
        await budget.alertIfCrossed(C, { feature: 'ask' });
        expect(handleNotificationtFun).toHaveBeenCalledTimes(2);
        expect(handleNotificationtFun.mock.calls[1][0].body.message).toMatch(/^AI daily budget reached: \$10\.50 of \$10 used today \(UTC\)/);
        expect(company().agentDailyBudgetAlerts[100]).toEqual(expect.any(Date));

        jest.setSystemTime(new Date('2026-10-10T09:00:00.000Z'));
        seedSpend(9, new Date());
        await budget.alertIfCrossed(C, { feature: 'ask' });
        expect(handleNotificationtFun).toHaveBeenCalledTimes(3);
        expect(company().agentDailyBudgetAlerts).toEqual({ day: '2026-10-10', 80: expect.any(Date), 100: null });
    });

    it('stay silent without a daily limit, and do not touch the monthly alert stamps', async () => {
        seedCompany({ agentMonthlyBudgetUsd: 1000 });
        seedSpend(50);
        await budget.alertIfCrossed(C, { feature: 'ask' });
        expect(handleNotificationtFun).not.toHaveBeenCalled();
        expect(company().agentDailyBudgetAlerts).toBeUndefined();
    });

    it('a metered call that crosses the day announces it from the core', async () => {
        seedCompany({ agentDailyBudgetUsd: 0.01 });
        seedSpend(0.008);
        adapter.chat.mockImplementation(async () => answer());
        await call({ maxTokens: 10 });
        expect(handleNotificationtFun).toHaveBeenCalled();
        expect(handleNotificationtFun.mock.calls[0][0].body.changeData).toMatchObject({ period: 'daily', level: '100' });
    });
});
