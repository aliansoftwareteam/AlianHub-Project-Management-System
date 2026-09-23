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

const handlers = {};
const app = { post: (path, ...fns) => { handlers[`POST ${path}`] = fns[fns.length - 1]; }, get: () => {}, put: () => {} };
require('../Modules/notification1/routes').init(app);
const post = async (path, body) => {
    const r = reply();
    await handlers[`POST ${path}`]({ headers: { companyid: CID }, body, uid: MEMBER }, r);
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

describe('the generic history route leaves these changes to the server', () => {
    test.each(['Project_Source', 'Project_ProposalId', 'Project_Skills', 'Project_CustomField'])('a %s row sent by the web app is not stored', async (key) => {
        const r = await post('/api/v1/handleHistory', {
            type: 'project', companyId: CID, projectId: PROJECT, taskId: null,
            object: { key, message: `<b>${HTML}</b>` },
            userData: { id: MEMBER, Employee_Name: 'Max Member', companyOwnerId: OWNER },
        });
        expect(r.body).toMatchObject({ status: true });
        expect(historyRows()).toEqual([]);
    });
});
