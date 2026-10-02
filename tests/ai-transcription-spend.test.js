/* Talk to Text goes through the real audio meter and reservation, with only the vendor mocked: each call is
 * booked to the workspace by the audio minute, and held to the budget every other AI feature is held to. */
const mockDb = require('./fixtures/fakeMongo').create();
const mockProvider = { name: 'openai' };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../utils/companyMembers', () => ({ memberProfiles: jest.fn(async () => []) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, chat: jest.fn(), baseUrl: () => 'https://vendor.test/v1' }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/embeddingChoice', () => ({ embeddingProviderName: () => mockProvider.name }));
jest.mock('../Modules/AICore/llmProvider/compatibleClient', () => ({ request: jest.fn(), describeFailure: () => 'refused' }));
jest.mock('../Modules/AICore/providerKeys', () => ({ apiKeyFor: jest.fn(async () => 'local-key') }));

process.env.AI_API_KEY = 'test-key';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { schema } = require('../utils/mongo-handler/schema.js');
const mongoose = require('mongoose');
const compatibleClient = require('../Modules/AICore/llmProvider/compatibleClient');
const { measure, ESTIMATED_BYTES_PER_MINUTE } = require('../Modules/AI/audioDuration');
const [, transcribe] = require('../Modules/AI/transcribe').transcribe;

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const ENV = { router: process.env.AI_MODEL_ROUTER, price: process.env.WHISPER_USD_PER_MINUTE, base: process.env.OPENAI_COMPATIBLE_BASE_URL, fetch: global.fetch };

const element = (id, content) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | content.length]), content]);
const openElement = (id) => Buffer.concat([Buffer.from(id), Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])]);
const uint = (value, bytes) => { const b = Buffer.alloc(bytes); b.writeUIntBE(value, 0, bytes); return b; };
const block = (ms) => element([0xa3], Buffer.concat([Buffer.from([0x81]), uint(ms, 2), Buffer.from([0x80, 0, 0])]));
const info = (children) => element([0x15, 0x49, 0xa9, 0x66], Buffer.concat([element([0x2a, 0xd7, 0xb1], uint(1000000, 3)), ...children]));
const webmHead = (children = []) => Buffer.concat([
    element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], Buffer.from('webm'))),
    openElement([0x18, 0x53, 0x80, 0x67]),
    info(children),
]);
/* What a browser recorder writes: no Duration, open-ended clusters, the length only in the last block's timestamp. */
const recording = (seconds) => Buffer.concat([
    webmHead(), openElement([0x1f, 0x43, 0xb6, 0x75]), element([0xe7], uint((seconds - 1) * 1000, 4)), block(0), block(1000),
]);
const box = (type, content) => Buffer.concat([uint(8 + content.length, 4), Buffer.from(type, 'latin1'), content]);
const mp4 = (seconds) => Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\0\0', 'latin1')),
    box('moov', box('mvhd', Buffer.concat([uint(0, 4), uint(0, 4), uint(0, 4), uint(1000, 4), uint(seconds * 1000, 4)]))),
]);
const wav = (seconds) => {
    const fmt = Buffer.alloc(24);
    fmt.write('fmt ', 0, 'latin1');
    fmt.writeUInt32LE(16, 4);
    fmt.writeUInt32LE(32000, 16);
    const data = Buffer.alloc(8 + seconds * 32000);
    data.write('data', 0, 'latin1');
    data.writeUInt32LE(seconds * 32000, 4);
    return Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), fmt, data]);
};
const unknownContainer = (minutes) => Buffer.alloc(minutes * ESTIMATED_BYTES_PER_MINUTE, 1);

const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const holds = () => mockDb.store[SCHEMA_TYPE.AI_RESERVATIONS] || [];
const spent = (usd) => mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', model: 'gpt-4.1', costUsd: usd, totalTokens: 1, billedToWorkspace: true, at: new Date() });
const vendorAnswers = (body) => global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => '' });

const talk = async (buffer = recording(30)) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    await transcribe({ uid: ME, headers: { companyid: C }, body: {}, file: { buffer, mimetype: 'audio/webm', originalname: 'audio.webm' } }, res);
    return res;
};

const restore = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

beforeAll(() => { process.env.AI_MODEL_ROUTER = 'on'; });
afterAll(() => {
    restore('AI_MODEL_ROUTER', ENV.router);
    restore('WHISPER_USD_PER_MINUTE', ENV.price);
    restore('OPENAI_COMPATIBLE_BASE_URL', ENV.base);
    global.fetch = ENV.fetch;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    delete process.env.WHISPER_USD_PER_MINUTE;
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    mockProvider.name = 'openai';
    global.fetch = jest.fn();
    vendorAnswers({ text: ' Ship it on Friday. ', usage: { type: 'duration', seconds: 90 } });
    mockDb.seed(dbCollections.COMPANIES, { _id: C, agentMonthlyBudgetUsd: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ME, roleType: 1, status: 2 });
});

describe('what Talk to Text costs is booked to the workspace', () => {
    it('one row per call, for the workspace and the person who spoke, in minutes at the list price', async () => {
        const first = await talk();
        await talk();

        expect(first).toMatchObject({ statusCode: 200, body: { status: true, data: { text: 'Ship it on Friday.' } } });
        expect(ledger()).toHaveLength(2);
        ledger().forEach((row) => expect(row).toMatchObject({
            feature: 'transcription', companyId: C, userId: ME, model: 'whisper-1', provider: 'openai',
            unit: 'audio_minute', quantity: 1.5, costUsd: 0.009, priced: true, billedToWorkspace: true, estimated: false, totalTokens: 0,
        }));
        expect(holds().map((hold) => [hold.state, hold.actualUsd])).toEqual([['settled', 0.009], ['settled', 0.009]]);
    });

    it('uses the recording\'s own length when the vendor states none', async () => {
        vendorAnswers({ text: 'Hello' });
        await talk(recording(30));
        expect(ledger()[0]).toMatchObject({ quantity: 0.5, costUsd: 0.003, estimated: false });
    });

    it('estimates from the size of a file whose container says nothing, and says so on the row', async () => {
        vendorAnswers({ text: 'Hello' });
        await talk(unknownContainer(2));
        expect(ledger()[0]).toMatchObject({ quantity: 2, costUsd: 0.012, estimated: true });
    });

    it('prices a minute at WHISPER_USD_PER_MINUTE when it is set, and at the list price when it is not a price', async () => {
        process.env.WHISPER_USD_PER_MINUTE = '0.003';
        await talk();
        process.env.WHISPER_USD_PER_MINUTE = 'free';
        await talk();
        expect(ledger().map((row) => row.costUsd)).toEqual([0.0045, 0.009]);
    });

    it('books a self-hosted server\'s minutes at no cost unless a price is set', async () => {
        mockProvider.name = 'openai_compatible';
        process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://local.test/v1';
        compatibleClient.request.mockResolvedValue({ data: { text: 'Hello' } });
        await talk(recording(60));
        process.env.WHISPER_USD_PER_MINUTE = '0.002';
        await talk(recording(60));

        expect(global.fetch).not.toHaveBeenCalled();
        expect(ledger().map((row) => [row.provider, row.quantity, row.costUsd, row.priced])).toEqual([
            ['openai_compatible', 1, 0, true],
            ['openai_compatible', 1, 0.002, true],
        ]);
    });

    it('keeps the minutes through the strict ledger schema', () => {
        const Usage = mongoose.models.TranscriptionUsage || mongoose.model('TranscriptionUsage', new mongoose.Schema(schema.aiUsage, { strict: true }));
        const row = new Usage({ feature: 'transcription', at: new Date(), unit: 'audio_minute', quantity: 1.5, estimated: true }).toObject();
        expect(row).toMatchObject({ unit: 'audio_minute', quantity: 1.5, estimated: true });
    });
});

describe('once the workspace budget is spent', () => {
    beforeEach(() => spent(1.5));

    it('a recording is refused before it is sent, in the words every AI feature uses', async () => {
        const res = await talk();

        expect(global.fetch).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(['status', 'statusText']);
        expect(res.body).toMatchObject({ status: false, statusText: expect.stringMatching(/^ai_budget_exhausted: this call is estimated at \$0\.0030 and the workspace budget of \$1 has /) });
        expect(ledger()).toHaveLength(1);
        expect(holds().map((hold) => hold.state)).toEqual(['released']);
    });
});

describe('a call the vendor did not answer books nothing', () => {
    it('when the vendor refuses it', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'slow down' });
        const res = await talk();

        expect(res).toMatchObject({ statusCode: 502, body: { status: false, statusText: 'Transcription failed (429).' } });
        expect(ledger()).toHaveLength(0);
        expect(holds().map((hold) => hold.state)).toEqual(['released']);
    });

    it('when the vendor cannot be reached', async () => {
        global.fetch.mockRejectedValue(new Error('socket hang up'));
        const res = await talk();

        expect(res).toMatchObject({ statusCode: 500, body: { status: false } });
        expect(ledger()).toHaveLength(0);
        expect(holds().map((hold) => hold.state)).toEqual(['released']);
    });

    it('when a self-hosted server fails', async () => {
        mockProvider.name = 'openai_compatible';
        process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://local.test/v1';
        compatibleClient.request.mockRejectedValue(Object.assign(new Error('bad gateway'), { response: { status: 500 } }));
        const res = await talk();

        expect(res).toMatchObject({ statusCode: 502, body: { status: false, statusText: 'Transcription failed (500).' } });
        expect(ledger()).toHaveLength(0);
    });
});

describe('how long a recording runs', () => {
    it.each([
        ['a browser recording, from its last block', recording(42), 42],
        ['a WebM file that states its duration', webmHead([element([0x44, 0x89], (() => { const b = Buffer.alloc(4); b.writeFloatBE(12500); return b; })())]), 12.5],
        ['an MP4 file, from its movie header', mp4(75), 75],
        ['a WAV file, from its byte rate', wav(3), 3],
    ])('%s', (_name, buffer, seconds) => {
        expect(measure(buffer)).toEqual({ seconds, estimated: false });
    });

    it.each([
        ['an unknown container', unknownContainer(1)],
        ['a WebM file cut off before its first block', webmHead()],
        ['a fragmented MP4 file that states no length', mp4(0)],
    ])('%s is estimated from its size', (_name, buffer) => {
        expect(measure(buffer)).toEqual({ seconds: (buffer.length / ESTIMATED_BYTES_PER_MINUTE) * 60, estimated: true });
    });
});
