const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/actions', () => ({ authorizeRead: jest.fn(async () => true), perform: jest.fn(), RefusedError: class RefusedError extends Error {} }));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Mcp/brief', () => ({ buildBrief: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Mcp/tools');

const C = '6f0000000000000000000c01';
const ctx = { companyId: C, userId: 'u1', actor: { kind: 'agent', userId: 'u1' }, ip: '1.1.1.1', projectIds: [] };
const read = (pageId) => tools.call(ctx, 'docs.read', { pageId });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

describe('F3 — docs.read returns the stored page body', () => {
    it('strips content.html for a page saved by the editor', async () => {
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, {
            title: 'Release checklist',
            content: { html: '<h1>Release</h1><p>Tag&nbsp;the build.</p><ul><li>Run smoke tests</li></ul>' },
            rawText: 'Release Tag the build. Run smoke tests',
            updatedAt: new Date('2026-09-01T00:00:00Z'),
        });
        const out = await read(page._id);
        expect(out).toEqual({ pageId: page._id, title: 'Release checklist', updatedAt: new Date('2026-09-01T00:00:00Z'), text: 'Release Tag the build. Run smoke tests' });
        expect(actions.authorizeRead).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, action: 'docs.read', actor: ctx.actor }));
    });

    it('uses rawText when the page has no html', async () => {
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Imported', rawText: 'Plain imported body', content: {} });
        expect((await read(page._id)).text).toBe('Plain imported body');
    });

    it('renders blocks when neither html nor rawText is stored', async () => {
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, {
            title: 'Blocks only',
            content: { blocks: [{ type: 'paragraph', data: { text: 'From blocks' } }] },
        });
        expect((await read(page._id)).text).toContain('From blocks');
    });

    it('prefers the html over the 5000-char rawText excerpt and caps at 40000', async () => {
        const long = 'x'.repeat(50000);
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Long', content: { html: `<p>${long}</p>` }, rawText: long.slice(0, 5000) });
        const out = await read(page._id);
        expect(out.text).toHaveLength(40000);
        expect(out.text).toBe(long.slice(0, 40000));
    });

    it('reports a missing or deleted page and an invalid id', async () => {
        const gone = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Trashed', deletedStatusKey: 1, content: { html: '<p>x</p>' } });
        expect(await read(gone._id)).toEqual({ error: 'page not found' });
        expect(await read('6f00000000000000000000ff')).toEqual({ error: 'page not found' });
        expect(await read('not-an-id')).toEqual({ error: 'invalid pageId' });
    });
});
