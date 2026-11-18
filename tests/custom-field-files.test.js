/* Task 046 slice A1.2: a files custom field. A stored file is named by a key in the folder of its company, task and field,
   so a value can only list files uploaded for that field on that task, and a file is read only by someone who can open the task. */
const mockDb = require('./fixtures/fakeMongo').create();
const mockCopyStoredFile = jest.fn(async () => true);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ canSeeSprintById: jest.fn(async () => true), hiddenSprintIds: jest.fn(async () => []) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: (...args) => mockCopyStoredFile(...args) }));
process.env.STORAGE_TYPE = 'server';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { fieldInsertFrom, fieldUpdateFrom, FieldWriteError } = require('../Modules/CustomField/helpers/fieldWrite');
const { typeModuleOf, MODULE_FIELD_TYPES } = require('../Modules/CustomField/fieldTypes');
const { fieldFileKey, fieldFilePath, kindOf } = require('../Modules/CustomField/fieldTypes/files');
const { storableFieldValues } = require('../Modules/CustomField/helpers/fieldValueWrite');
const { copyFieldFiles } = require('../Modules/CustomField/helpers/fieldFiles');
const { fieldValueText } = require('../Modules/CustomField/helpers/customFieldText');
const { judge, layoutOf } = require('../Modules/storage/downloadScope');
const { cleanViewSettings } = require('../Modules/Project/helpers/viewSettings');
const guardFixture = require('./fixtures/taskWriteGuard');

const { CID, OTHER_COMPANY, OWNER, MEMBER, OPEN_PROJECT, OPEN_TASK, OPEN_TASK_2, MISSING_TASK } = guardFixture;
const guard = guardFixture.create(mockDb);

const PRIVATE_PROJECT = '6f0000000000000000000a09';
const PRIVATE_TASK = '6f0000000000000000000b09';
const FILES = '6f0000000000000000000e21';
const IMAGES = '6f0000000000000000000e22';
const DOCS = '6f0000000000000000000e23';
const TWO = '6f0000000000000000000e24';
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const files = typeModuleOf('files');
const keyOf = (name, { projectId = OPEN_PROJECT, taskId = OPEN_TASK, fieldId = FILES } = {}) => fieldFilePath({ projectId, taskId, fieldId, name });
const sent = (name, where) => ({ key: keyOf(name, where), name, size: 1200, type: name.endsWith('.png') ? 'image/png' : 'application/pdf' });

describe('the files type module', () => {
    it('is registered beside the other types, and is not sortable', () => {
        expect(MODULE_FIELD_TYPES).toContain('files');
        expect(files.type).toBe('files');
        expect(files.sortable).toBe(false);
        expect(files.sortValue([sent('a.pdf')], {})).toBeNull();
        expect(files.parse(files.empty, {})).toEqual({ value: [] });
    });

    it('names a stored file by its project, task and field, and reads that back', () => {
        const key = keyOf('17_spec.pdf');
        expect(key).toBe(`Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Field/${FILES}/17_spec.pdf`);
        expect(fieldFileKey(key)).toEqual({ projectId: OPEN_PROJECT, taskId: OPEN_TASK, fieldId: FILES, name: '17_spec.pdf' });
        [`Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/a.pdf`, `${key}/more`, `../${key}`, `https://example.com/${key}`, `Project/x/Sprint/y/Field/z/a.pdf`,
            `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Field/${FILES}/..`, 7, null].forEach((bad) => expect(fieldFileKey(bad)).toBeNull());
    });

    it('holds up to ten files of any kind unless the field says otherwise', () => {
        expect(files.settings({})).toEqual({ settings: { fieldFilesMax: 10, fieldFilesKind: 'any' } });
        expect(files.settings({ fieldFilesMax: '20', fieldFilesKind: 'images' })).toEqual({ settings: { fieldFilesMax: 20, fieldFilesKind: 'images' } });
        [{ fieldFilesMax: 0 }, { fieldFilesMax: 21 }, { fieldFilesMax: 2.5 }, { fieldFilesMax: 'many' }, { fieldFilesKind: 'videos' }, { fieldFilesKind: 7 }]
            .forEach((bad) => expect(files.settings(bad).error).toEqual(expect.any(String)));
    });

    it('keeps the stored shape of each file and nothing else', () => {
        const value = [{ ...sent('a.pdf'), uploadedBy: OWNER, uploadedAt: '2026-10-01T10:00:00.000Z', href: 'javascript:alert(1)' }];
        expect(files.parse(value, {})).toEqual({ value: [{ key: keyOf('a.pdf'), name: 'a.pdf', size: 1200, type: 'application/pdf', uploadedBy: OWNER, uploadedAt: '2026-10-01T10:00:00.000Z' }] });
    });

    it.each([
        ['not a list', { key: 'x' }],
        ['a bare key', ['Project/a/b']],
        ['a key outside a field folder', [{ ...sent('a.pdf'), key: `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/a.pdf` }]],
        ['a url', [{ ...sent('a.pdf'), key: 'https://example.com/a.pdf' }]],
        ['a condition for a key', [{ ...sent('a.pdf'), key: { $ne: null } }]],
        ['no name', [{ ...sent('a.pdf'), name: '' }]],
        ['a size that is not a number', [{ ...sent('a.pdf'), size: 'big' }]],
        ['the same file twice', [sent('a.pdf'), sent('a.pdf')]],
    ])('refuses %s', (_what, value) => {
        expect(files.parse(value, {}).error).toEqual(expect.any(String));
    });

    it('enforces the field\'s cap and its allowed kinds', () => {
        expect(files.parse([sent('a.pdf'), sent('b.pdf'), sent('c.pdf')], { fieldFilesMax: 2 }).error).toMatch(/at most 2 files/i);
        expect(files.parse(Array.from({ length: 11 }, (_, at) => sent(`f${at}.pdf`)), {}).error).toMatch(/at most 10 files/i);
        expect(files.parse([sent('a.pdf')], { fieldFilesKind: 'images' }).error).toMatch(/images/i);
        expect(files.parse([sent('a.png')], { fieldFilesKind: 'documents' }).error).toMatch(/documents/i);
        expect(files.parse([sent('a.PNG')], { fieldFilesKind: 'images' }).value).toHaveLength(1);
        expect(kindOf('photo.jpeg')).toBe('images');
        expect(kindOf('notes.docx')).toBe('documents');
        expect(kindOf('logo.svg')).toBe('other');
        expect(kindOf('archive.zip')).toBe('other');
    });

    it('reads as the file names', () => {
        expect(files.text([sent('a.pdf'), sent('b.png')], {})).toBe('a.pdf, b.png');
        expect(files.text([], {})).toBe('');
        expect(fieldValueText({ fieldType: 'files' }, { fieldValue: [sent('a.pdf')] })).toBe('a.pdf');
    });
});

describe('saving a files field definition', () => {
    it('declares its settings on the custom field schema, and keeps a task\'s values in a free-form object', () => {
        expect(schema.customFields.fieldFilesMax).toMatchObject({ type: Number });
        expect(schema.customFields.fieldFilesKind).toMatchObject({ type: String });
        expect(schema.tasks.customField).toMatchObject({ type: Object });
    });

    it('fills the defaults and refuses settings that do not fit', () => {
        expect(fieldInsertFrom({ fieldTitle: 'Contracts', fieldType: 'files' })).toMatchObject({ fieldFilesMax: 10, fieldFilesKind: 'any' });
        expect(() => fieldInsertFrom({ fieldTitle: 'Contracts', fieldType: 'files', fieldFilesMax: 50 })).toThrow(FieldWriteError);
        expect(() => fieldUpdateFrom({ key: '$set', id: FILES, updateObject: { fieldFilesKind: 'anything' } })).toThrow(FieldWriteError);
        expect(fieldUpdateFrom({ key: '$set', id: FILES, updateObject: { fieldFilesMax: 3 } }).fieldFilesMax).toBe(3);
    });

    it('can be filtered by whether it has files in a saved view', () => {
        const row = { name: { value: `customField.${FILES}`, type: 'custom', fieldType: 'files', filterOn: `customField.${FILES}.fieldValue` }, comparison: { value: ':empty' }, values: [true], condition: '&&' };
        expect(cleanViewSettings({ filters: [row] }).filters).toHaveLength(1);
    });
});

const seed = () => {
    guard.reset();
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Private', CompanyId: CID, isPrivateSpace: true, AssigneeUserId: [OWNER], isGlobalPermission: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: PRIVATE_TASK, TaskName: 'Private task', ProjectID: PRIVATE_PROJECT, CompanyId: CID, TaskTypeKey: 1, deletedStatusKey: 0, customField: {} });
    const field = (id, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: id, fieldTitle: 'Files', fieldType: 'files', type: 'task', global: true, isDelete: true, ...extra });
    field(FILES);
    field(IMAGES, { fieldFilesKind: 'images' });
    field(DOCS, { fieldFilesKind: 'documents' });
    field(TWO, { fieldFilesMax: 2 });
};

describe('writing a files value on a task', () => {
    const routes = {};
    const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

    const patch = (body, uid = OWNER) => new Promise((resolve) => {
        const res = { statusCode: 200 };
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
        res.json = res.send;
        routes['PATCH /api/v2/tasks']({ method: 'PATCH', path: '/api/v2/tasks', headers: { companyid: CID }, aud: CID, uid, body }, res, () => resolve({ code: 'next' }));
    }).then(async (result) => { await settle(); return result; });

    const write = (fieldId, fieldValue, { taskId = OPEN_TASK, uid = OWNER } = {}) => patch({
        action: 'updateTaskCustomField', companyId: CID, taskId, customFieldId: fieldId, updateDetail: { _id: fieldId, fieldValue },
    }, uid);
    const stored = (fieldId, taskId = OPEN_TASK) => (mockDb.store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === taskId).customField || {})[fieldId];
    const refused = (answer, pattern) => {
        expect(answer.code).toBe(400);
        expect(answer.body).toMatchObject({ status: false, statusText: expect.stringMatching(pattern) });
    };

    beforeEach(seed);

    it('stores the files uploaded for this field on this task, and stamps who added each and when', async () => {
        const answer = await write(FILES, [{ ...sent('a.pdf'), uploadedBy: MEMBER, uploadedAt: '1999-01-01T00:00:00.000Z', extra: 'x' }, sent('b.png')]);
        expect(answer.body.status).toBe(true);
        const value = stored(FILES).fieldValue;
        expect(value.map((file) => Object.keys(file).sort())).toEqual([['key', 'name', 'size', 'type', 'uploadedAt', 'uploadedBy'], ['key', 'name', 'size', 'type', 'uploadedAt', 'uploadedBy']]);
        expect(value[0]).toMatchObject({ key: keyOf('a.pdf'), name: 'a.pdf', size: 1200, type: 'application/pdf', uploadedBy: OWNER });
        expect(new Date(value[0].uploadedAt).getFullYear()).toBeGreaterThan(2000);
    });

    it('keeps the stamp of a file already on the field when another is added or removed', async () => {
        await write(FILES, [sent('a.pdf')]);
        const first = stored(FILES).fieldValue[0];
        await write(FILES, [{ ...sent('a.pdf'), name: 'renamed.pdf', size: 5 }, sent('b.pdf')], { uid: MEMBER });
        const value = stored(FILES).fieldValue;
        expect(value[0]).toEqual(first);
        expect(value[1]).toMatchObject({ name: 'b.pdf', uploadedBy: MEMBER });
        await write(FILES, [sent('b.pdf')], { uid: MEMBER });
        expect(stored(FILES).fieldValue.map((file) => file.name)).toEqual(['b.pdf']);
        expect((await write(FILES, [])).body.status).toBe(true);
        expect(stored(FILES).fieldValue).toEqual([]);
    });

    it.each([
        ['another task', { taskId: OPEN_TASK_2 }],
        ['another field', { fieldId: IMAGES }],
        ['a task that does not exist', { taskId: MISSING_TASK }],
        ['another company\'s task', { projectId: OTHER_COMPANY, taskId: OTHER_COMPANY }],
    ])('refuses a key from the folder of %s, and stores nothing', async (_where, where) => {
        refused(await write(FILES, [sent('a.pdf'), sent('stolen.pdf', where)]), /uploaded for this field on this task/i);
        expect(stored(FILES)).toBeUndefined();
    });

    it.each([
        ['a task attachment', `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/a.pdf`],
        ['a path that climbs out of the folder', `Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Field/${FILES}/../../../../../${OTHER_COMPANY}/a.pdf`],
        ['a url', 'https://files.example.com/a.pdf'],
    ])('refuses %s as a key', async (_what, key) => {
        refused(await write(FILES, [{ ...sent('a.pdf'), key }]), /file/i);
        expect(stored(FILES)).toBeUndefined();
    });

    it('enforces the cap the field sets', async () => {
        refused(await write(TWO, ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => sent(name, { fieldId: TWO }))), /at most 2 files/i);
        expect((await write(TWO, ['a.pdf', 'b.pdf'].map((name) => sent(name, { fieldId: TWO })))).body.status).toBe(true);
    });

    it('enforces the kinds the field allows', async () => {
        refused(await write(IMAGES, [sent('a.pdf', { fieldId: IMAGES })]), /images/i);
        expect((await write(IMAGES, [sent('a.png', { fieldId: IMAGES })])).body.status).toBe(true);
        refused(await write(DOCS, [sent('a.png', { fieldId: DOCS })]), /documents/i);
        expect((await write(DOCS, [sent('a.pdf', { fieldId: DOCS })])).body.status).toBe(true);
    });

    it('reads the task and the field from the signed-in company', async () => {
        await write(FILES, [sent('a.pdf')]);
        const reads = mockDb.calls.filter((call) => [SCHEMA_TYPE.TASKS, SCHEMA_TYPE.CUSTOM_FIELDS].includes(call.type));
        expect(reads.length).toBeGreaterThan(0);
        reads.forEach((call) => expect([CID, 'global']).toContain(call.companyId));
    });
});

describe('reading a field file', () => {
    beforeEach(seed);
    const read = (uid, key) => judge({ companyId: CID, uid, key, storage: 'server' });

    it('has a layout of its own, apart from task attachments', () => {
        expect(layoutOf(keyOf('a.pdf')).entry.type).toBe('task_field_file');
        expect(layoutOf(`Project/${OPEN_PROJECT}/Sprint/${OPEN_TASK}/Attachment/a.pdf`).entry.type).toBe('task_attachment');
    });

    it('is allowed to someone who can open the task and see its custom fields', async () => {
        expect(await read(OWNER, keyOf('a.pdf'))).toEqual({ allowed: true, type: 'task_field_file' });
        expect(await read(MEMBER, keyOf('a.pdf'))).toEqual({ allowed: true, type: 'task_field_file' });
    });

    it('is refused to a member who cannot open the task\'s project', async () => {
        const key = keyOf('a.pdf', { projectId: PRIVATE_PROJECT, taskId: PRIVATE_TASK });
        expect(await read(MEMBER, key)).toMatchObject({ allowed: false, type: 'task_field_file', reason: 'no_access' });
        expect(await read(OWNER, key)).toMatchObject({ allowed: true });
    });

    it('is refused to a member whose role cannot see custom fields', async () => {
        guard.setRule(null, 'task_custom_field', null);
        expect(await read(MEMBER, keyOf('a.pdf'))).toMatchObject({ allowed: false, reason: 'no_access' });
    });

    it('is refused when the folder names no task of this company', async () => {
        expect(await read(OWNER, keyOf('a.pdf', { taskId: MISSING_TASK }))).toMatchObject({ allowed: false, reason: 'not_found' });
        expect(await read(OWNER, keyOf('a.pdf', { projectId: OTHER_COMPANY, taskId: OTHER_COMPANY }))).toMatchObject({ allowed: false });
    });
});

describe('copy paths', () => {
    beforeEach(() => {
        seed();
        mockCopyStoredFile.mockClear();
    });
    const source = () => ({ _id: OPEN_TASK, ProjectID: OPEN_PROJECT, customField: { [FILES]: { _id: FILES, fieldValue: [{ ...sent('a.pdf'), uploadedBy: OWNER, uploadedAt: '2026-10-01T10:00:00.000Z' }] } } });

    it('never carry a field file onto another task: a create, an import row or a template leaves the value out', async () => {
        const created = { TaskName: 'New', ProjectID: OPEN_PROJECT, customField: source().customField };
        expect(await storableFieldValues({ companyId: CID, task: created })).toEqual({ customField: {}, dropped: [FILES] });
        const other = { _id: OPEN_TASK_2, ProjectID: OPEN_PROJECT, customField: source().customField };
        expect(await storableFieldValues({ companyId: CID, task: other })).toEqual({ customField: {}, dropped: [FILES] });
    });

    it('copy the stored files into the new task\'s own folder when a duplicate is asked to copy attachments', async () => {
        const copied = await copyFieldFiles({ companyId: CID, source: source(), target: { _id: OPEN_TASK_2, ProjectID: OPEN_PROJECT } });
        const key = keyOf('a.pdf', { taskId: OPEN_TASK_2 });
        expect(mockCopyStoredFile).toHaveBeenCalledWith(CID, keyOf('a.pdf'), key);
        expect(copied).toEqual({ [FILES]: { _id: FILES, fieldValue: [{ key, name: 'a.pdf', size: 1200, type: 'application/pdf', uploadedBy: OWNER, uploadedAt: '2026-10-01T10:00:00.000Z' }] } });
        expect(mockDb.store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === OPEN_TASK_2).customField[FILES].fieldValue[0].key).toBe(key);
    });

    it('copy nothing that is not the source task\'s own file', async () => {
        const forged = source();
        forged.customField[FILES].fieldValue[0].key = keyOf('a.pdf', { taskId: PRIVATE_TASK, projectId: PRIVATE_PROJECT });
        expect(await copyFieldFiles({ companyId: CID, source: forged, target: { _id: OPEN_TASK_2, ProjectID: OPEN_PROJECT } })).toEqual({});
        expect(mockCopyStoredFile).not.toHaveBeenCalled();
    });
});
