/* Task 046 slice A1.1: people, url, rating and progress custom fields. Each type's shape is checked by its own
   module, and the server refuses a definition or a value that does not fit instead of storing it. */
const mockDb = require('./fixtures/fakeMongo').create();

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
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { fieldInsertFrom, fieldUpdateFrom, FieldWriteError } = require('../Modules/CustomField/helpers/fieldWrite');
const { typeModuleOf, MODULE_FIELD_TYPES } = require('../Modules/CustomField/fieldTypes');
const { safeHref, hostOf } = require('../Modules/CustomField/fieldTypes/url');
const { fieldValueText } = require('../Modules/CustomField/helpers/customFieldText');
const aiConfig = require('../Modules/CustomField/aiFields/config');
const { specOf } = require('../Modules/CustomField/aiFields/outputs');
const { CID, OWNER, MEMBER, OPEN_PROJECT, OPEN_TASK } = require('./fixtures/taskWriteGuard');

const PRIVATE_PROJECT = '6f0000000000000000000a09';
const PRIVATE_TASK = '6f0000000000000000000b09';
const INVITED = '6f0000000000000000000004';
const STRANGER = '6f0000000000000000000005';
const OUTSIDER = '6f0000000000000000000006';
const FIELD = { people: '6f0000000000000000000e01', single: '6f0000000000000000000e02', url: '6f0000000000000000000e03', rating: '6f0000000000000000000e04', ten: '6f0000000000000000000e05', progress: '6f0000000000000000000e06' };
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const people = typeModuleOf('people');
const url = typeModuleOf('url');
const rating = typeModuleOf('rating');
const progress = typeModuleOf('progress');

describe('the field type modules', () => {
    it('are one module per type, each with the same shape', () => {
        expect(MODULE_FIELD_TYPES).toEqual(['people', 'url', 'rating', 'progress']);
        MODULE_FIELD_TYPES.forEach((type) => {
            const module = typeModuleOf(type);
            expect(module.type).toBe(type);
            ['settings', 'parse', 'text', 'sortValue'].forEach((name) => expect(typeof module[name]).toBe('function'));
            expect(module.parse(module.empty, {})).toEqual({ value: module.empty });
        });
        expect(typeModuleOf('text')).toBeNull();
        expect(typeModuleOf('constructor')).toBeNull();
    });
});

describe('a people value', () => {
    it('is a list of user ids without repeats', () => {
        expect(people.parse([OWNER, MEMBER, OWNER], {})).toEqual({ value: [OWNER, MEMBER] });
        expect(people.parse([], {})).toEqual({ value: [] });
        expect(people.parse('', {})).toEqual({ value: [] });
    });

    it.each([[OWNER], [[1]], [['not-an-id']], [[{ $ne: null }]], [{ 0: OWNER }], [[`tId_${OWNER}`]], [Array.from({ length: 51 }, (_, at) => String(at).padStart(24, 'a'))]])('refuses %j', (value) => {
        expect(people.parse(value, {}).error).toEqual(expect.any(String));
    });

    it('holds one person when the field is not multiple', () => {
        expect(people.parse([OWNER], { fieldMultiple: false })).toEqual({ value: [OWNER] });
        expect(people.parse([OWNER, MEMBER], { fieldMultiple: false }).error).toMatch(/one person/i);
    });

    it('reads and sorts by the name of the first person', () => {
        const names = { [OWNER]: 'Olivia Owner', [MEMBER]: 'Max Member' };
        const context = { userName: (id) => names[id] };
        expect(people.text([OWNER, MEMBER], {}, context)).toBe('Olivia Owner, Max Member');
        expect(people.text([STRANGER], {}, context)).toBe('');
        expect(people.sortValue([MEMBER, OWNER], {}, context)).toBe('max member');
        expect(people.sortValue([], {}, context)).toBeNull();
    });
});

describe('a url value', () => {
    it('keeps an http or https link', () => {
        expect(url.parse('https://example.com/a?b=1', {})).toEqual({ value: 'https://example.com/a?b=1' });
        expect(url.parse('  http://example.com  ', {})).toEqual({ value: 'http://example.com/' });
        expect(url.parse('', {})).toEqual({ value: '' });
    });

    it.each([['javascript:alert(1)'], ['JaVaScRiPt:alert(1)'], ['data:text/html,<script>1</script>'], ['vbscript:x'], ['file:///etc/passwd'], ['ftp://example.com'], ['//example.com'], ['example.com'], ['not a link'], [42], [['https://example.com']], [`https://example.com/${'a'.repeat(2100)}`]])('refuses %j', (value) => {
        expect(url.parse(value, {}).error).toEqual(expect.any(String));
    });

    it('gives an href only for a stored value that is still http or https', () => {
        expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
        expect(safeHref('javascript:alert(1)')).toBe('');
        expect(safeHref(' java\nscript:alert(1)')).toBe('');
        expect(safeHref({ href: 'https://example.com' })).toBe('');
        expect(hostOf('https://www.example.com/a/b?c=1')).toBe('www.example.com');
        expect(hostOf('javascript:alert(1)')).toBe('');
        expect(url.text('javascript:alert(1)', {})).toBe('');
    });
});

describe('a rating value', () => {
    it('is a whole number from 1 to the field\'s maximum', () => {
        expect(rating.parse(3, {})).toEqual({ value: 3 });
        expect(rating.parse('5', {})).toEqual({ value: 5 });
        expect(rating.parse(8, { fieldRatingMax: 10 })).toEqual({ value: 8 });
        expect(rating.parse('', {})).toEqual({ value: '' });
        expect(rating.parse(null, {})).toEqual({ value: '' });
    });

    it.each([[0], [6], [2.5], ['x'], ['3 stars'], [true], [[3]], [{ $gt: 0 }], [-1], [Infinity]])('refuses %j', (value) => {
        expect(rating.parse(value, {}).error).toEqual(expect.any(String));
    });

    it('reads as "value/max" and sorts as a number', () => {
        expect(rating.text(3, {})).toBe('3/5');
        expect(rating.text(8, { fieldRatingMax: 10 })).toBe('8/10');
        expect(rating.text('', {})).toBe('');
        expect(rating.sortValue('4', {})).toBe(4);
        expect(rating.sortValue('', {})).toBeNull();
    });
});

describe('a progress value', () => {
    it('is a whole number from 0 to 100', () => {
        expect(progress.parse(0, {})).toEqual({ value: 0 });
        expect(progress.parse('100', {})).toEqual({ value: 100 });
        expect(progress.parse('', {})).toEqual({ value: '' });
    });

    it.each([[101], [-1], [50.5], ['half'], ['50%'], [true], [[50]], [{ $gt: 0 }]])('refuses %j', (value) => {
        expect(progress.parse(value, {}).error).toEqual(expect.any(String));
    });

    it('reads as a percentage and sorts as a number', () => {
        expect(progress.text(0, {})).toBe('0%');
        expect(progress.text(40, {})).toBe('40%');
        expect(progress.text('', {})).toBe('');
        expect(progress.sortValue(0, {})).toBe(0);
        expect(progress.sortValue('', {})).toBeNull();
    });
});

describe('saving a field definition of one of the types', () => {
    it('declares the settings the types add on the custom field schema', () => {
        expect(schema.customFields.fieldMultiple).toMatchObject({ type: Boolean });
        expect(schema.customFields.fieldRatingMax).toMatchObject({ type: Number });
    });

    it('fills each type\'s settings with its defaults', () => {
        expect(fieldInsertFrom({ fieldTitle: 'Reviewers', fieldType: 'people' }).fieldMultiple).toBe(true);
        expect(fieldInsertFrom({ fieldTitle: 'Owner', fieldType: 'people', fieldMultiple: false }).fieldMultiple).toBe(false);
        expect(fieldInsertFrom({ fieldTitle: 'Score', fieldType: 'rating' }).fieldRatingMax).toBe(5);
        expect(fieldInsertFrom({ fieldTitle: 'Score', fieldType: 'rating', fieldRatingMax: '10' }).fieldRatingMax).toBe(10);
        expect(fieldInsertFrom({ fieldTitle: 'Spec', fieldType: 'url' })).toEqual({ fieldTitle: 'Spec', fieldType: 'url' });
        expect(fieldInsertFrom({ fieldTitle: 'Done', fieldType: 'progress' })).toEqual({ fieldTitle: 'Done', fieldType: 'progress' });
    });

    it.each([
        [{ fieldType: 'rating', fieldRatingMax: 2 }], [{ fieldType: 'rating', fieldRatingMax: 11 }], [{ fieldType: 'rating', fieldRatingMax: 4.5 }],
        [{ fieldType: 'rating', fieldRatingMax: 'many' }], [{ fieldType: 'people', fieldMultiple: 'yes' }],
    ])('refuses %j', (definition) => {
        expect(() => fieldInsertFrom({ fieldTitle: 'Field', ...definition })).toThrow(FieldWriteError);
    });

    it('checks a setting changed on its own', () => {
        expect(fieldUpdateFrom({ key: '$set', id: FIELD.rating, updateObject: { fieldRatingMax: 7 } }).fieldRatingMax).toBe(7);
        expect(() => fieldUpdateFrom({ key: '$set', id: FIELD.rating, updateObject: { fieldRatingMax: 99 } })).toThrow(FieldWriteError);
        expect(() => fieldUpdateFrom({ key: '$set', id: FIELD.people, updateObject: { fieldMultiple: 1 } })).toThrow(FieldWriteError);
        expect(fieldUpdateFrom({ key: '$set', id: FIELD.url, updateObject: { fieldTitle: 'Spec link' } })).toEqual({ fieldTitle: 'Spec link' });
    });
});

describe('writing a value on a task', () => {
    const routes = {};
    const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

    const patch = (body) => new Promise((resolve) => {
        const res = { statusCode: 200 };
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (answer) => { resolve({ code: res.statusCode, body: answer }); return res; };
        res.json = res.send;
        routes['PATCH /api/v2/tasks']({ method: 'PATCH', path: '/api/v2/tasks', headers: { companyid: CID }, aud: CID, uid: OWNER, body }, res, () => resolve({ code: 'next' }));
    }).then(async (result) => { await settle(); return result; });

    const write = (fieldId, fieldValue, taskId = OPEN_TASK, extra = {}) => patch({
        action: 'updateTaskCustomField', companyId: CID, taskId, customFieldId: fieldId, updateDetail: { _id: fieldId, fieldValue, ...extra },
    });
    const stored = (fieldId, taskId = OPEN_TASK) => mockDb.store.tasks.find((task) => String(task._id) === taskId).customField[fieldId];

    const field = (id, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true, ...extra });

    beforeEach(() => {
        Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
        mockDb.calls.length = 0;
        socketEmitter.emit.mockClear();
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, ProjectName: 'Open', CompanyId: CID });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Private', CompanyId: CID, isPrivateSpace: true, AssigneeUserId: [OWNER] });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITED, roleType: 3, status: 1, isDelete: false });
        field(FIELD.people, 'people', { fieldMultiple: true });
        field(FIELD.single, 'people', { fieldMultiple: false });
        field(FIELD.url, 'url');
        field(FIELD.rating, 'rating', { fieldRatingMax: 5 });
        field(FIELD.ten, 'rating', { fieldRatingMax: 10 });
        field(FIELD.progress, 'progress');
        const kept = { [FIELD.people]: { _id: FIELD.people, fieldValue: [STRANGER] }, [FIELD.rating]: { _id: FIELD.rating, fieldValue: 2 } };
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: OPEN_TASK, TaskName: 'Open task', ProjectID: OPEN_PROJECT, CompanyId: CID, TaskTypeKey: 1, deletedStatusKey: 0, customField: { ...kept } });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: PRIVATE_TASK, TaskName: 'Private task', ProjectID: PRIVATE_PROJECT, CompanyId: CID, TaskTypeKey: 1, deletedStatusKey: 0, customField: {} });
    });

    const refused = async (answer, pattern) => {
        expect(answer.code).toBe(400);
        expect(answer.body).toMatchObject({ status: false, statusText: expect.stringMatching(pattern) });
    };

    describe('people', () => {
        it('stores active members who can open the project, and tells the other clients', async () => {
            const answer = await write(FIELD.people, [OWNER, MEMBER]);
            expect(answer.body.status).toBe(true);
            expect(stored(FIELD.people)).toEqual({ _id: FIELD.people, fieldValue: [OWNER, MEMBER] });
            expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'task', updatedFields: { [`customField.${FIELD.people}`]: { _id: FIELD.people, fieldValue: [OWNER, MEMBER] } } }));
        });

        it.each([['someone with no seat', OUTSIDER], ['someone whose invitation is still pending', INVITED]])('refuses %s', async (_who, id) => {
            await refused(await write(FIELD.people, [OWNER, id]), /active members/i);
            expect(stored(FIELD.people).fieldValue).toEqual([STRANGER]);
        });

        it('refuses a member who cannot open the task\'s project', async () => {
            await refused(await write(FIELD.people, [MEMBER], PRIVATE_TASK), /cannot open this project/i);
            expect(stored(FIELD.people, PRIVATE_TASK)).toBeUndefined();
            expect((await write(FIELD.people, [OWNER], PRIVATE_TASK)).body.status).toBe(true);
        });

        it('reads seats and the project from the signed-in company', async () => {
            await write(FIELD.people, [MEMBER]);
            const reads = mockDb.calls.filter((call) => [SCHEMA_TYPE.COMPANY_USERS, SCHEMA_TYPE.PROJECTS].includes(call.type));
            expect(reads.length).toBeGreaterThan(0);
            reads.forEach((call) => expect(call.companyId).toBe(CID));
        });

        it('keeps a person already on the field, so the others can still be changed', async () => {
            const answer = await write(FIELD.people, [STRANGER, MEMBER]);
            expect(answer.body.status).toBe(true);
            expect(stored(FIELD.people).fieldValue).toEqual([STRANGER, MEMBER]);
        });

        it.each([['a bare id', OWNER], ['a team', [`tId_${OWNER}`]], ['an object', [{ id: OWNER }]], ['a number', 7]])('refuses %s', async (_what, value) => {
            await refused(await write(FIELD.people, value), /list of people/i);
            expect(stored(FIELD.people).fieldValue).toEqual([STRANGER]);
        });

        it('holds one person when the field is not multiple', async () => {
            await refused(await write(FIELD.single, [OWNER, MEMBER]), /one person/i);
            expect((await write(FIELD.single, [MEMBER])).body.status).toBe(true);
        });

        it('can be emptied', async () => {
            expect((await write(FIELD.people, [])).body.status).toBe(true);
            expect(stored(FIELD.people).fieldValue).toEqual([]);
        });

        it('names the people in the activity log, never their ids', () => {
            expect(fieldValueText({ fieldType: 'people' }, { fieldValue: [OWNER, MEMBER] }, { userName: (id) => (id === OWNER ? 'Olivia Owner' : '') })).toBe('Olivia Owner');
        });
    });

    describe('url', () => {
        it('stores an http or https link and nothing else beside it', async () => {
            const answer = await write(FIELD.url, 'https://example.com/spec', OPEN_TASK, { href: 'javascript:alert(1)' });
            expect(answer.body.status).toBe(true);
            expect(stored(FIELD.url)).toEqual({ _id: FIELD.url, fieldValue: 'https://example.com/spec' });
        });

        it.each([['javascript:alert(1)'], ['data:text/html,x'], ['ftp://example.com/file'], ['example.com'], [42]])('refuses %j', async (value) => {
            await refused(await write(FIELD.url, value), /http/i);
            expect(stored(FIELD.url)).toBeUndefined();
        });

        it('can be cleared', async () => {
            await write(FIELD.url, 'https://example.com');
            expect((await write(FIELD.url, '')).body.status).toBe(true);
            expect(stored(FIELD.url).fieldValue).toBe('');
        });
    });

    describe('rating', () => {
        it('stores a whole number up to the field\'s maximum', async () => {
            expect((await write(FIELD.rating, 4)).body.status).toBe(true);
            expect(stored(FIELD.rating).fieldValue).toBe(4);
            expect((await write(FIELD.ten, '9')).body.status).toBe(true);
            expect(stored(FIELD.ten).fieldValue).toBe(9);
        });

        it.each([[0], [6], [2.5], ['five'], [[3]]])('refuses %j and keeps the stored value', async (value) => {
            await refused(await write(FIELD.rating, value), /whole number from 1 to 5/i);
            expect(stored(FIELD.rating).fieldValue).toBe(2);
        });

        it('can be cleared', async () => {
            expect((await write(FIELD.rating, '')).body.status).toBe(true);
            expect(stored(FIELD.rating).fieldValue).toBe('');
        });
    });

    describe('progress', () => {
        it('stores a whole number from 0 to 100', async () => {
            expect((await write(FIELD.progress, 0)).body.status).toBe(true);
            expect(stored(FIELD.progress).fieldValue).toBe(0);
            expect((await write(FIELD.progress, '100')).body.status).toBe(true);
            expect(stored(FIELD.progress).fieldValue).toBe(100);
        });

        it.each([[101], [-5], [33.3], ['half']])('refuses %j', async (value) => {
            await write(FIELD.progress, 40);
            await refused(await write(FIELD.progress, value), /whole number from 0 to 100/i);
            expect(stored(FIELD.progress).fieldValue).toBe(40);
        });
    });

    it('refuses a value that is not sent as { fieldValue }', async () => {
        const answer = await patch({ action: 'updateTaskCustomField', companyId: CID, taskId: OPEN_TASK, customFieldId: FIELD.progress, updateDetail: 50 });
        expect(answer.code).toBe(400);
        expect(stored(FIELD.progress)).toBeUndefined();
    });
});

describe('an AI rating output', () => {
    const config = { output: 'rating', template: 'custom', prompt: 'How risky is this?' };

    it('can target a rating field as well as a number field', () => {
        expect(aiConfig.normaliseAiConfig(config, 'rating')).toEqual(expect.objectContaining({ enabled: true, output: 'rating' }));
        expect(aiConfig.normaliseAiConfig(config, 'number')).toEqual(expect.objectContaining({ output: 'rating' }));
        expect(() => aiConfig.normaliseAiConfig({ ...config, output: 'number' }, 'rating')).toThrow(aiConfig.AiConfigError);
        ['people', 'url', 'progress'].forEach((type) => expect(() => aiConfig.normaliseAiConfig(config, type)).toThrow(aiConfig.AiConfigError));
    });

    it('fills a rating field with a number up to the field\'s own maximum', () => {
        const definition = { fieldType: 'rating', fieldRatingMax: 10 };
        const spec = specOf('rating');
        expect(spec.parse(8, { definition, config })).toEqual({ fieldValue: 8, text: '8', empty: false });
        expect(spec.parse(11, { definition, config })).toMatchObject({ invalid: true, reason: 'out_of_range' });
        expect(spec.format(config, {}, definition)).toContain('from 1 to 10');
    });

    it('still fills a number field with text from 1 to 5', () => {
        const definition = { fieldType: 'number' };
        const spec = specOf('rating');
        expect(spec.parse(4, { definition, config })).toEqual({ fieldValue: '4', text: '4', empty: false });
        expect(spec.parse(6, { definition, config })).toMatchObject({ invalid: true });
        expect(spec.format(config, {}, definition)).toContain('from 1 to 5');
    });
});
