const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

/* Follow-up 111: custom field values, tags and project checklist items are described on the server from stored values. */

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const PROJECT = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000b01';
const HTML = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert&#40;1&#41;&gt;';
const ITEM_NAME = (name) => `<b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${name}">${name}</b>`;

const actor = { id: OWNER, Employee_Name: 'Olivia Owner' };
const taskItems = () => require('../Modules/Tasks/helpers/taskItemHistory');
const projectItems = () => require('../Modules/Project/helpers/projectItemHistory');

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const reply = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
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

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

describe('a task custom field value', () => {
    const describeValue = (definition, next, previous) => taskItems().describeCustomFieldValue({ actor, definition, next, previous });
    const text = { _id: 'cf1', fieldTitle: 'Budget code', fieldType: 'text' };

    test('keeps the web app wording and names the stored field title', () => {
        expect(describeValue(text, { fieldValue: 'AB-12' })).toEqual({
            key: 'Project_Category',
            message: '<b>Olivia Owner</b> has added value in <b> Budget code</b> Custom Field as <b>AB-12</b>.',
        });
    });

    test('escapes the value and the stored title', () => {
        const entry = describeValue({ ...text, fieldTitle: HTML }, { fieldValue: HTML });
        expect(entry.message).toBe(`<b>Olivia Owner</b> has added value in <b> ${ESCAPED}</b> Custom Field as <b>${ESCAPED}</b>.`);
    });

    test('names the chosen dropdown option from the stored options', () => {
        const dropdown = { _id: 'cf2', fieldTitle: 'Region', fieldType: 'dropdown', fieldOptions: [{ id: 'o1', label: 'Europe', value: 'eu' }, { id: 'o2', label: 'Asia', value: '' }] };
        expect(describeValue(dropdown, { fieldValue: ['o1'] }).message).toContain('Custom Field as <b>eu</b>.');
        expect(describeValue(dropdown, { fieldValue: ['o2'] }).message).toContain('Custom Field as <b>Asia</b>.');
    });

    test('writes a date as a date the activity log formats', () => {
        const date = { _id: 'cf3', fieldTitle: 'Launch', fieldType: 'date' };
        expect(describeValue(date, { fieldValue: '2026-10-01T00:00:00.000Z' }).message).toContain(`Custom Field as <b>DATE_${Date.parse('2026-10-01T00:00:00.000Z')}</b>.`);
    });

    test('writes checkbox and phone values as the web app showed them', () => {
        expect(describeValue({ _id: 'cf4', fieldTitle: 'Done', fieldType: 'checkbox' }, { fieldValue: false }).message).toContain('as <b>false</b>.');
        expect(describeValue({ _id: 'cf5', fieldTitle: 'Phone', fieldType: 'phone' }, { fieldValue: '9876543210', fieldCode: '+91' }).message).toContain('as <b>+91 9876543210</b>.');
    });

    test('an unchanged value or an unknown field is not described', () => {
        expect(describeValue(text, { fieldValue: 'AB-12' }, { fieldValue: 'AB-12' })).toBeNull();
        expect(describeValue(null, { fieldValue: 'AB-12' })).toBeNull();
    });
});

describe('a tag added to or removed from a task', () => {
    const tag = { uid: 't1', tagName: 'Urgent' };
    const describeTag = (operation, held, over = {}) => taskItems().describeTaskTag({ actor, tag, taskName: 'Fix login', operation, held, ...over });

    test('adding writes the task row and the project row with the web app wording', () => {
        expect(describeTag('add', false)).toEqual({
            task: { key: 'task', message: '<b>Olivia Owner</b> has added the <b> Urgent Tag </b>' },
            project: { key: 'Project_Name', message: '<b>Olivia Owner</b> has added the <b> Urgent Tag </b> in <b>Fix login</b> Task' },
        });
    });

    test('removing writes both rows with the web app wording', () => {
        expect(describeTag('remove', true)).toEqual({
            task: { key: 'task', message: '<b>Olivia Owner</b> has removed the Tag <b> Urgent </b> Tag' },
            project: { key: 'Project_Name', message: '<b>Olivia Owner</b> has removed the Tag <b> Urgent</b> in <b>Fix login</b> task.' },
        });
    });

    test('names are escaped and a change the task already held is not described', () => {
        const entry = describeTag('add', false, { tag: { uid: 't1', tagName: HTML }, taskName: HTML });
        expect(entry.project.message).toBe(`<b>Olivia Owner</b> has added the <b> ${ESCAPED} Tag </b> in <b>${ESCAPED}</b> Task`);
        expect(describeTag('add', true)).toBeNull();
        expect(describeTag('remove', false)).toBeNull();
        expect(describeTag('add', false, { tag: null })).toBeNull();
    });
});

describe('a project checklist change', () => {
    const items = [
        { id: 'c1', name: 'Checklist', isChecked: false, AssigneeUserId: [] },
        { id: 'i1', parentId: 'c1', name: 'Write spec', isChecked: false, AssigneeUserId: [MEMBER] },
        { id: 'i2', parentId: 'i1', name: 'Review', isChecked: false, AssigneeUserId: [] },
    ];
    const describeChange = (body, previous = items) => projectItems().describeChecklistChange({ actor, previous, body, nameOf: async (uid) => (uid === MEMBER ? 'Max Member' : HTML) });

    test('creating a checklist and an item keep the web app wording', async () => {
        expect(await describeChange({ operation: 'push', checklistItem: { id: 'c2', name: 'Checklist' } })).toEqual([
            { key: 'Task_Checklist', message: '<b>Olivia Owner</b> has created new checklist' },
        ]);
        expect(await describeChange({ operation: 'push', checklistItem: { id: 'i9', parentId: 'c1', name: HTML } })).toEqual([
            { key: 'Task_Checklist', message: `<b>Olivia Owner</b> has created new checklist item ${ITEM_NAME(ESCAPED)}` },
        ]);
    });

    test('items the comment box turns into a checklist keep its wording and name the stored project', async () => {
        const fromComment = (checklistItem) => projectItems().describeChecklistChange({
            actor, previous: items, body: { operation: 'push', origin: 'comment', checklistItem }, projectName: HTML,
        });
        expect(await fromComment({ id: 'c9', name: 'Checklist' })).toEqual([]);
        expect(await fromComment({ id: 'i9', parentId: 'c9', name: 'Call the client' })).toEqual([
            { key: 'Project_Comment', message: `<b>Olivia Owner</b> has added <b>Call the client</b> checklist from <b>(${ESCAPED} )</b> project.` },
        ]);
    });

    test('checking an item names the item that was clicked, not the children it carried', async () => {
        const next = items.map((item) => (item.id === 'c1' ? item : { ...item, isChecked: true }));
        expect(await describeChange({ operation: 'update', key: 'isChecked', checklistItem: next })).toEqual([
            { key: 'CheckList_Checked', message: '<b>Olivia Owner</b> has <b>checked</b> <b>Write spec</b> checklist.' },
        ]);
    });

    test('renaming names the stored name and the new one', async () => {
        expect(await describeChange({ operation: 'update', key: 'name', checklistItem: { id: 'i1', name: 'Write the spec' } })).toEqual([
            { key: 'Task_Checklist', message: '<b>Olivia Owner</b> has changed checklist item name from <b>Write spec</b> to <b>Write the spec</b>' },
        ]);
        expect(await describeChange({ operation: 'update', key: 'name', checklistItem: { id: 'i1', name: 'Write spec' } })).toEqual([]);
    });

    test('assigning and unassigning name the stored user and item', async () => {
        expect(await describeChange({ operation: 'update', key: 'assigneeAdd', checklistItem: { id: 'i2', uid: MEMBER } })).toEqual([
            { key: 'Task_Checklist_Assign', message: '<b>Olivia Owner</b> has added <b>Max Member</b> into checklist item <b>Review</b>' },
        ]);
        expect(await describeChange({ operation: 'update', key: 'assigneeRemove', checklistItem: { id: 'i1', uid: MEMBER } })).toEqual([
            { key: 'Task_Checklist_Remove', message: '<b>Olivia Owner</b> has removed <b>Max Member</b> from checklist item <b>Write spec</b>' },
        ]);
        expect(await describeChange({ operation: 'update', key: 'assigneeAdd', checklistItem: { id: 'i1', uid: MEMBER } })).toEqual([]);
    });

    test('removing names the item and its sub items', async () => {
        expect(await describeChange({ operation: 'delete', checklistItem: ['i1', 'i2'] })).toEqual([
            { key: 'Task_Checklist', message: `<b>Olivia Owner</b> has removed checklist item ${ITEM_NAME('Write spec')} and its subitems ${ITEM_NAME('Review')}` },
        ]);
        expect(await describeChange({ operation: 'delete', checklistItem: ['zz'] })).toEqual([]);
    });
});

describe('a project tag definition change', () => {
    const tags = [{ uid: 't1', tagName: 'Urgent', tagColor: '#ff0000' }];
    const describeChange = (body) => projectItems().describeTagDefinitionChange({ actor, previous: tags, body });

    test('renaming, recolouring and deleting keep the web app wording', () => {
        expect(describeChange({ operation: 'update', key: 'tagName', items: { id: 't1', tagName: 'Blocker' } })).toEqual([
            { key: 'Project_Name', message: '<b>Olivia Owner</b> has renamed the Tag from <b>  Urgent  </b> to <b>Blocker </b>' },
        ]);
        expect(describeChange({ operation: 'update', key: 'tagColor', items: { id: 't1', tagColor: '#00ff00' } })).toEqual([
            { key: 'Project_Name', message: '<b>Olivia Owner</b> has changed the Tag color of Urgent' },
        ]);
        expect(describeChange({ operation: 'delete', items: { id: 't1' } })).toEqual([
            { key: 'Project_Name', message: '<b>Olivia Owner</b> has deleted the <b> Urgent Tag </b>' },
        ]);
    });

    test('creating a tag, an unknown tag or an unchanged name is not described', () => {
        expect(describeChange({ operation: 'push', items: { uid: 't2', tagName: 'New' } })).toEqual([]);
        expect(describeChange({ operation: 'delete', items: { id: 'zz' } })).toEqual([]);
        expect(describeChange({ operation: 'update', key: 'tagName', items: { id: 't1', tagName: 'Urgent' } })).toEqual([]);
        expect(describeChange({ operation: 'update', key: 'tagName', items: { id: 't1', tagName: HTML } })[0].message).toContain(`<b>${ESCAPED} </b>`);
    });
});

describe('the generic history route leaves these changes to the server', () => {
    const historyBody = (type, key) => ({
        type,
        companyId: CID,
        projectId: PROJECT,
        taskId: type === 'task' ? TASK : null,
        object: { key, message: `<b>${HTML}</b>` },
        userData: { id: MEMBER, Employee_Name: 'Max Member', companyOwnerId: OWNER },
    });

    test.each([
        ['task', 'Project_Category'], ['task', 'task'],
        ['project', 'Task_Checklist'], ['project', 'Task_Checklist_Assign'], ['project', 'Task_Checklist_Remove'], ['project', 'CheckList_Checked'], ['project', 'Project_Comment'],
    ])('a %s %s row sent by the web app is not stored', async (type, key) => {
        const r = await post('/api/v1/handleHistory', historyBody(type, key));
        expect(r.body).toMatchObject({ status: true });
        expect(historyRows()).toEqual([]);
    });
});
