const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/AI/meetingNotes', () => ({ generateMeetingNotes: jest.fn(async () => ({ status: true, data: { summary: 'Agreed to repaint.', actionItems: [{ id: 'ai_1', title: 'Order paint' }] } })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const socketEmitter = require('../event/socketEventEmitter');
const notes = require('../Modules/Calls/notes');

const C = '6f0000000000000000000c01';
const HOST = '6f0000000000000000000001';
const GUEST = '6f0000000000000000000002';
const OUTSIDER = '6f0000000000000000000003';
const ADMIN = '6f0000000000000000000004';
const SAID = 'We looked at the lamp.';

const call = async (handler, { uid = HOST, params = {}, body = {} } = {}) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (b) => { res.body = b; return res; };
    res.json = res.send;
    await handler({ uid, params, body, query: {}, headers: { companyid: C } }, res);
    return res;
};
const stored = () => mockDb.store[SCHEMA_TYPE.CALLS][0];
const edit = (body, uid = GUEST) => call(notes.updateNotes, { uid, params: { id: String(stored()._id) }, body });

beforeEach(async () => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    [HOST, GUEST, OUTSIDER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false }));
    await call(notes.createNotes, { body: { callId: 'call-1', title: 'Lighthouse sync', participants: [GUEST], transcript: SAID, durationSec: 60 } });
    socketEmitter.emit.mockClear();
});

describe('what a participant changes in the notes of a call', () => {
    it('keeps the summary, the title and the action items editable, and records who edited and when', async () => {
        const before = Date.now();
        const res = await edit({ title: 'Lamp sync', summary: 'Repaint in May.', actionItems: [{ id: 'ai_1', title: 'Order paint', taskId: 't1' }] });
        expect(res.body.status).toBe(true);
        expect(stored()).toMatchObject({ title: 'Lamp sync', summary: 'Repaint in May.', actionItems: [{ id: 'ai_1', title: 'Order paint', taskId: 't1' }], editedBy: GUEST, transcript: SAID });
        expect(new Date(stored().editedAt).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('stores the edit stamp under fields the schema declares', () => {
        expect(schema.calls.editedBy).toBeDefined();
        expect(schema.calls.editedAt).toBeDefined();
    });

    it('answers 400 to a request that carries a transcript, and changes nothing', async () => {
        const res = await edit({ transcript: 'Nothing was agreed.', summary: 'Nothing was agreed.' });
        expect(res.statusCode).toBe(400);
        expect(res.body.status).toBe(false);
        expect(stored()).toMatchObject({ transcript: SAID, summary: 'Agreed to repaint.' });
        expect(stored().editedBy).toBeUndefined();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it.each([
        ['a summary that is not text', { summary: { $gt: '' } }],
        ['action items that are not a list', { actionItems: 'none' }],
        ['an action item that is not an object', { actionItems: ['none'] }],
        ['a title that is not text', { title: ['x'] }],
        ['a status the notes do not have', { status: 'archived' }],
    ])('answers 400 to %s', async (_label, body) => {
        const res = await edit(body);
        expect(res.statusCode).toBe(400);
        expect(stored()).toMatchObject({ title: 'Lighthouse sync', summary: 'Agreed to repaint.', status: 'ready' });
    });

    it('ignores fields that are not part of the notes', async () => {
        const res = await edit({ participants: [OUTSIDER], createdBy: GUEST, recapPostedAt: '2026-01-01', summary: 'Repaint in May.' });
        expect(res.body.status).toBe(true);
        expect(stored()).toMatchObject({ participants: [HOST, GUEST], createdBy: HOST, summary: 'Repaint in May.' });
        expect(stored().recapPostedAt).toBeUndefined();
    });

    it('lets the person who started the notes discard them', async () => {
        const res = await edit({ status: 'discarded' }, HOST);
        expect(res.body.status).toBe(true);
        expect(stored()).toMatchObject({ status: 'discarded', deletedStatusKey: 1, editedBy: HOST });
    });

    it('lets an owner or admin who was on the call discard them', async () => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
        stored().participants.push(ADMIN);
        const res = await edit({ status: 'discarded' }, ADMIN);
        expect(res.body.status).toBe(true);
        expect(stored()).toMatchObject({ status: 'discarded', deletedStatusKey: 1, editedBy: ADMIN });
    });

    it('keeps the notes when another participant asks to discard them, and still takes their edit', async () => {
        const res = await edit({ status: 'discarded', summary: 'Gone.' });
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(stored()).toMatchObject({ status: 'ready', deletedStatusKey: 0, summary: 'Agreed to repaint.' });
        expect(socketEmitter.emit).not.toHaveBeenCalled();

        expect((await edit({ summary: 'Repaint in May.' })).body.status).toBe(true);
    });

    it('answers "not found" to someone who was not on the call', async () => {
        const res = await edit({ summary: 'Mine now.' }, OUTSIDER);
        expect(res.body).toMatchObject({ status: false, statusText: 'Notes not found.' });
        expect(stored().summary).toBe('Agreed to repaint.');
    });
});
