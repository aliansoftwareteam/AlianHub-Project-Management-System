const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({
    resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []),
    skillNamesOf: jest.fn(async (companyId, slugs) => slugs.map((slug) => ({ vue: 'Vue.js', node: 'Node.js' }[slug] || slug))),
}));
jest.mock('../Modules/Project/helpers/projectQuota', () => ({ TRASHED: 1, quotaStatus: () => null, syncProjectQuota: jest.fn(async () => false) }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ guideTouched: () => false, publishGuideSaved: jest.fn(), publishProjectTrashed: jest.fn(), publishProjectRestored: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateProject } = require('../Modules/Project/controller/updateProject');
const customFieldCtrl = require('../Modules/CustomField/controller');

/* Follow-up 111: source, proposal ID, skills, project custom field values and custom field definitions are described on the server. */

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const PROJECT = '6f0000000000000000000a01';
const FIELD = '6f0000000000000000000cf1';
const NEW_FIELD = '6f0000000000000000000cf2';
const HTML = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert&#40;1&#41;&gt;';

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const reply = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};

const update = async (body, uid = OWNER) => {
    const r = reply();
    await updateProject({ headers: { companyid: CID }, params: { id: PROJECT }, body, query: {}, uid }, r);
    await settle();
    return r;
};
const fieldRoute = async (handler, body, uid = OWNER) => {
    const r = reply();
    await customFieldCtrl[handler]({ headers: { companyid: CID }, body, query: {}, uid }, r);
    await settle();
    return r;
};


const historyRows = () => clone(mockDb.store[SCHEMA_TYPE.HISTORY] || []);
const messages = () => historyRows().map((row) => [row.Key, row.Message]);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: PROJECT, ProjectName: 'Parity', CompanyId: CID, source: 'other', proposalId: '', skills: ['vue'],
        customField: { [FIELD]: { _id: FIELD, fieldValue: 'old' } },
    });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: FIELD, fieldTitle: 'Client code', fieldType: 'text', type: 'project', global: false, projectId: [PROJECT] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: NEW_FIELD, fieldTitle: 'Region', fieldType: 'text', type: 'project', global: false, projectId: [PROJECT] });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1 });
});

describe('a project detail change is described on the server', () => {
    test('the source names its label', async () => {
        await update({ updateObject: { source: 'fiverr' } });
        expect(messages()).toEqual([['Project_Source', '<b>Olivia Owner</b> has changed <b> Source</b> as <b>Fiverr</b>.']]);
    });

    test('the proposal ID is the cleaned, escaped value, and clearing it reads N/A', async () => {
        await update({ updateObject: { proposalId: `abc ${HTML}` } }, MEMBER);
        const [row] = historyRows();
        expect(row).toMatchObject({ Type: 'project', Key: 'Project_ProposalId', UserId: MEMBER });
        expect(row.Message).toMatch(/^<b>Max Member<\/b> has changed <b> Proposal ID<\/b> as <b>/);
        expect(row.Message).not.toContain('<img');
    });

    test('skills are named from the company skill list', async () => {
        await update({ updateObject: { skills: ['vue', 'node'] } });
        expect(messages()).toEqual([['Project_Skills', '<b>Olivia Owner</b> has changed <b> Skills</b> as <b>Vue.js, Node.js</b>.']]);
    });

    /* fakeMongo answers the old document as a shallow copy that shares nested objects, so this project starts with no custom field values. */
    test('a project custom field value names the stored field and the new value', async () => {
        delete mockDb.store[SCHEMA_TYPE.PROJECTS][0].customField;
        await update({ updateObject: { [`customField.${NEW_FIELD}`]: { _id: NEW_FIELD, fieldValue: `new ${HTML}` } } });
        expect(messages()).toEqual([['Project_CustomField', `<b>Olivia Owner</b> has added value in <b> Region</b> Custom Field as <b>new ${ESCAPED}</b> for project.`]]);
    });

    test('unchanged values are not described', async () => {
        await update({ updateObject: { source: 'other', skills: ['vue'], [`customField.${FIELD}`]: { _id: FIELD, fieldValue: 'old' } } });
        expect(messages()).toEqual([]);
    });
});

describe('a project attachment is described on the server', () => {
    const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');
    const notices = () => HandleBothNotification.mock.calls.map(([args]) => args);

    test('attaching names the stored file and project, and notifies with the web app wording', async () => {
        await update({ updateObject: { attachments: { id: 'a1', filename: `spec ${HTML}.pdf`, url: 'Project/x/spec.pdf' } }, key: '$push' }, MEMBER);
        expect(messages()).toEqual([['Project_Attachment', `<b>Max Member</b> has attached <b>spec ${ESCAPED}.pdf</b> on <b>Parity</b>.`]]);
        expect(historyRows()[0].UserId).toBe(MEMBER);
        expect(notices()).toHaveLength(1);
        expect(notices()[0]).toMatchObject({ type: 'project', projectId: PROJECT, changeType: 'name', changeData: { url: `spec ${ESCAPED}.pdf`, ProjectName: 'Parity' } });
        expect(notices()[0].object).toEqual({ key: 'attachments', message: `<p><strong>spec ${ESCAPED}.pdf</strong> attached on <strong>Parity</strong> project.</p>` });
    });

    test('removing names the stored file, whatever the request calls it', async () => {
        mockDb.store[SCHEMA_TYPE.PROJECTS][0].attachments = [{ id: 'a1', filename: 'brief.docx' }];
        await update({ updateObject: { attachments: { id: 'a1', filename: HTML } }, key: '$pull' });
        expect(messages()).toEqual([['Project_Attachment', '<b>Olivia Owner</b> has deleted <b>brief.docx</b> on <b>Parity</b>.']]);
        expect(notices()[0].object).toEqual({ key: 'attachments', message: '<p><strong>brief.docx</strong> removed on <strong>Parity</strong>.</p>' });
        expect(notices()[0].changeData).toEqual({ removeFileName: 'brief.docx', ProjectName: 'Parity' });
    });

    test('removing a file the project does not hold is not described', async () => {
        await update({ updateObject: { attachments: { id: 'zz' } }, key: '$pull' });
        expect(messages()).toEqual([]);
        expect(notices()).toEqual([]);
    });
});

describe('a project view change is described on the server', () => {
    const describeProjectChanges = (...args) => require('../Modules/Project/helpers/projectHistory').describeProjectChanges(...args);
    const actor = { id: OWNER, Employee_Name: 'Olivia Owner' };
    const board = { _id: 'v1', keyName: 'ProjectKanban', name: 'Board', isPin: false, setAsDefault: false };
    const sheet = { _id: 'v2', id: 'v2', type: 'Sheets', url: 'https://docs.google.com/spreadsheets/d/x', name: 'Budget sheet', isPin: true };
    const previous = { _id: PROJECT, ProjectName: 'Parity', ProjectRequiredComponent: [board, sheet] };
    const history = async (args) => (await describeProjectChanges({ previous, actor, companyId: CID, ...args })).map((entry) => entry.history.message);
    const edit = (field, value, viewId) => ({ updateObject: { [`ProjectRequiredComponent.$[elementIndex].${field}`]: value }, arrayFilters: [{ 'elementIndex._id': viewId }] });

    test('adding a view or an embed keeps the web app wording', async () => {
        expect(await history({ key: '$addToSet', updateObject: { ProjectRequiredComponent: { _id: 'v3', keyName: 'Calendar', name: `Cal ${HTML}`, isPin: true } } }))
            .toEqual([`<b>Olivia Owner</b> has added the <b> pinned  View </b> as <b>Cal ${ESCAPED}</b>`]);
        expect(await history({ key: '$addToSet', updateObject: { ProjectRequiredComponent: { _id: 'v4', type: 'Anything_html', html: '<p>x</p>', name: 'Notes', isPin: false } } }))
            .toEqual(['<b>Olivia Owner</b> has added the <b>   Embed View </b> as <b>Notes</b>']);
        expect(await history({ key: '$addToSet', updateObject: { ProjectRequiredComponent: { ...board } } })).toEqual([]);
    });

    test('pinning, defaulting and renaming name the stored view', async () => {
        expect(await history(edit('isPin', true, 'v1'))).toEqual(['<b> Olivia Owner </b> has pinned the <b> Board View </b>']);
        expect(await history(edit('isPin', false, 'v2'))).toEqual(['<b> Olivia Owner </b> has Unpinned the <b> Budget sheet View </b>']);
        expect(await history(edit('setAsDefault', true, 'v1'))).toEqual(['<b> Olivia Owner </b> has added the <b> Board </b>as Default View']);
        expect(await history(edit('name', `Q3 ${HTML}`, 'v2'))).toEqual([`<b>Olivia Owner</b> has changed the  <b> Embed View name </b> as <b> Q3 ${ESCAPED} </b>  from <b>Budget sheet </b>`]);
        expect(await history(edit('isPin', false, 'v1'))).toEqual([]);
        expect(await history(edit('isPin', true, 'zz'))).toEqual([]);
    });

    test('removing names the stored view', async () => {
        expect(await history({ key: '$pull', updateObject: { ProjectRequiredComponent: { _id: 'v1' } } })).toEqual(['<b> Olivia Owner </b> has Deleted the <b> Board View </b>']);
        expect(await history({ key: '$pull', updateObject: { ProjectRequiredComponent: { _id: 'v2' } } })).toEqual(['<b> Olivia Owner </b> has deleted the  <b> Embed View Budget sheet </b>']);
        expect(await history({ key: '$pull', updateObject: { ProjectRequiredComponent: { _id: 'zz' } } })).toEqual([]);
    });
});

describe('a custom field definition is described on the server', () => {
    test('creating a project field names the new title for the signed-in user', async () => {
        const r = await fieldRoute('insertCustomField', {
            type: 'save',
            updateObject: { fieldTitle: `Region ${HTML}`, fieldType: 'text', type: 'task', global: false, projectId: [PROJECT] },
        }, MEMBER);
        expect(r.code).toBe(200);
        expect(historyRows()).toHaveLength(1);
        expect(historyRows()[0]).toMatchObject({ Type: 'project', Key: 'Project_CustomField', UserId: MEMBER, ProjectId: PROJECT });
        expect(historyRows()[0].Message).toBe(`<b>Max Member</b> has Created <b> Custom Field </b> as <b>Region ${ESCAPED}</b> for task.`);
    });

    test('renaming names the stored title and the new one; a global field or an unchanged title is not described', async () => {
        await fieldRoute('updateCustomField', { type: 'updateOne', key: '$set', id: FIELD, updateObject: { fieldTitle: 'Client ref' } });
        expect(messages()).toEqual([['Project_CustomField', '<b>Olivia Owner</b> has Edited <b> Custom Field </b> from <b>Client code</b> to <b>Client ref</b> for project.']]);

        await fieldRoute('updateCustomField', { type: 'updateOne', key: '$set', id: FIELD, updateObject: { fieldTitle: 'Client ref', fieldDescription: 'x' } });
        await fieldRoute('insertCustomField', { type: 'save', updateObject: { fieldTitle: 'Shared', fieldType: 'text', type: 'task', global: true } });
        expect(historyRows()).toHaveLength(1);
    });
});
