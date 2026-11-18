const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const clips = require('../Modules/Clips/controller');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};

const call = async (handler, { params = {}, body = {}, query = {}, headers = {} } = {}) => {
    const res = reply();
    await handler({ headers: { companyid: C, ...headers }, uid: ME, params, body, query }, res);
    return res;
};

const rows = () => mockDb.store[SCHEMA_TYPE.CLIPS] || [];
const seedClip = (over) => mockDb.seed(SCHEMA_TYPE.CLIPS, { userId: ME, companyId: C, title: 'Demo', url: 'clips/a.webm', deletedStatusKey: 0, ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

describe('TSK-09 a clip belongs to req.uid', () => {
    it('records the signed-in user as the author whatever the body, header or query names', async () => {
        const res = await call(clips.createClip, {
            body: { title: 'Walkthrough', url: 'clips/b.webm', userId: OTHER, userData: { id: OTHER } },
            headers: { userid: OTHER },
            query: { userId: OTHER },
        });
        expect(res.body.status).toBe(true);
        expect(res.body.data.userId).toBe(ME);
    });

    it('lists the caller\'s clips even when the query names someone else', async () => {
        seedClip({ title: 'Mine' });
        seedClip({ title: 'Theirs', userId: OTHER });
        const res = await call(clips.listMine, { query: { userId: OTHER } });
        expect(res.body.data.map((clip) => clip.title)).toEqual(['Mine']);
    });

    it('never lets an update change the author', async () => {
        const mine = seedClip();
        const res = await call(clips.updateClip, { params: { id: mine._id }, body: { title: 'Renamed', userId: OTHER, companyId: 'x' } });
        expect(res.body.status).toBe(true);
        expect(rows()[0]).toMatchObject({ title: 'Renamed', userId: ME, companyId: C });
    });

    it('refuses to rename or delete another user\'s clip', async () => {
        const theirs = seedClip({ title: 'Theirs', userId: OTHER });
        const rename = await call(clips.updateClip, { params: { id: theirs._id }, body: { title: 'Hijacked' } });
        const remove = await call(clips.deleteClip, { params: { id: theirs._id } });
        expect(rename.statusCode).toBe(404);
        expect(remove.statusCode).toBe(404);
        expect(rows()[0]).toMatchObject({ title: 'Theirs', deletedStatusKey: 0 });
    });

    it('lets the owner delete their clip', async () => {
        const mine = seedClip();
        const res = await call(clips.deleteClip, { params: { id: mine._id } });
        expect(res.body.status).toBe(true);
        expect(rows()[0].deletedStatusKey).toBe(1);
    });
});
