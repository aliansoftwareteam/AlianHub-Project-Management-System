/* Task 046 slice A1: a relationship field names other tasks, a voting field counts the people who voted. Neither value
   rides on the task document: the task keeps a marker (and a vote count), the ids are kept beside it and read per viewer. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { fieldInsertFrom, fieldUpdateFrom, FieldWriteError } = require('../Modules/CustomField/helpers/fieldWrite');
const { typeModuleOf, MODULE_FIELD_TYPES } = require('../Modules/CustomField/fieldTypes');
const { storableFieldValues } = require('../Modules/CustomField/helpers/fieldValueWrite');
const { storedValueOf } = require('../Modules/CustomField/helpers/fieldValueInput');
const { copyFieldLinks } = require('../Modules/CustomField/helpers/fieldLinks');
const { describeCustomFieldValue } = require('../Modules/Tasks/helpers/taskItemHistory');
const { cleanViewSettings } = require('../Modules/Project/helpers/viewSettings');
const { normaliseAiConfig, AiConfigError } = require('../Modules/CustomField/aiFields/config');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const OPEN_PROJECT = '6f0000000000000000000a01';
const PRIVATE_PROJECT = '6f0000000000000000000a09';
const COPY_PROJECT = '6f0000000000000000000a0a';
const SPRINT = '6f0000000000000000000e01';
const CLIENT = '6f0000000000000000000e31';
const VOTES = '6f0000000000000000000e32';
const TEXT = '6f0000000000000000000e33';
const task = (n) => `6f0000000000000000000b${String(n).padStart(2, '0')}`;
const [SOURCE, CHILD, OUTSIDE, HIDDEN, GONE, SOURCE_COPY, CHILD_COPY] = [1, 2, 3, 4, 5, 6, 7].map(task);

const relationship = typeModuleOf('relationship');
const voting = typeModuleOf('voting');
const ids = (count) => Array.from({ length: count }, (_, at) => task(20 + at));
const links = () => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELD_LINKS] || [];
const linksOf = (taskId, fieldId) => (links().find((doc) => doc.taskId === taskId && doc.fieldId === fieldId) || {}).ids;
const storedTask = (id) => mockDb.store[SCHEMA_TYPE.TASKS].find((row) => String(row._id) === id);

const seed = () => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, ProjectName: 'Open', isPrivateSpace: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: COPY_PROJECT, ProjectName: 'Copy', isPrivateSpace: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Private', isPrivateSpace: true, AssigneeUserId: [OWNER] });
    const row = (_id, ProjectID, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, ProjectID, sprintId: SPRINT, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `T-${_id.slice(-2)}`, deletedStatusKey: 0, ...extra });
    row(SOURCE, OPEN_PROJECT, { customField: { [CLIENT]: { _id: CLIENT, fieldValue: '', revision: 5 }, [VOTES]: { _id: VOTES, fieldValue: 2, revision: 5 } } });
    row(CHILD, OPEN_PROJECT, { ParentTaskId: SOURCE });
    row(OUTSIDE, OPEN_PROJECT);
    row(HIDDEN, PRIVATE_PROJECT);
    row(GONE, OPEN_PROJECT, { deletedStatusKey: 1 });
    row(SOURCE_COPY, COPY_PROJECT);
    row(CHILD_COPY, COPY_PROJECT, { ParentTaskId: SOURCE_COPY });
    const field = (id, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: id, fieldTitle: fieldType, fieldType, type: 'task', global: true, isDelete: true, ...extra });
    field(CLIENT, 'relationship', { fieldLinkMax: 10, fieldLinkScope: 'any' });
    field(VOTES, 'voting', { fieldVotersShown: true });
    field(TEXT, 'text');
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: SOURCE, fieldId: CLIENT, kind: 'relationship', ids: [CHILD, OUTSIDE, HIDDEN, GONE] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: CHILD, fieldId: CLIENT, kind: 'relationship', ids: [SOURCE] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: SOURCE, fieldId: VOTES, kind: 'voting', ids: [OWNER, MEMBER] });
};

beforeEach(seed);

describe('the two type modules', () => {
    it('are registered after the others, and say their value is kept beside the task', () => {
        expect(MODULE_FIELD_TYPES).toEqual(['people', 'url', 'rating', 'progress', 'files', 'relationship', 'voting']);
        expect(relationship).toMatchObject({ type: 'relationship', sortable: false, sideStored: true });
        expect(voting).toMatchObject({ type: 'voting', sideStored: true, castOnly: true });
        expect(voting.sortable).not.toBe(false);
        expect(relationship.sortValue([task(1)], {})).toBeNull();
    });

    it('links up to ten tasks of any project unless the field says otherwise', () => {
        expect(relationship.settings({})).toEqual({ settings: { fieldLinkMax: 10, fieldLinkScope: 'any', fieldLinkProjectId: '', fieldLinkSprintId: '' } });
        expect(relationship.settings({ fieldLinkMax: '20', fieldLinkScope: 'project', fieldLinkProjectId: OPEN_PROJECT }).settings)
            .toEqual({ fieldLinkMax: 20, fieldLinkScope: 'project', fieldLinkProjectId: OPEN_PROJECT, fieldLinkSprintId: '' });
        expect(relationship.settings({ fieldLinkScope: 'list', fieldLinkProjectId: OPEN_PROJECT, fieldLinkSprintId: SPRINT }).settings)
            .toMatchObject({ fieldLinkScope: 'list', fieldLinkProjectId: OPEN_PROJECT, fieldLinkSprintId: SPRINT });
        expect(relationship.settings({ fieldLinkScope: 'any', fieldLinkProjectId: OPEN_PROJECT }).settings).toMatchObject({ fieldLinkProjectId: '', fieldLinkSprintId: '' });
        [{ fieldLinkMax: 0 }, { fieldLinkMax: 21 }, { fieldLinkMax: 2.5 }, { fieldLinkMax: 'many' }, { fieldLinkScope: 'company' }, { fieldLinkScope: 'project' },
            { fieldLinkScope: 'project', fieldLinkProjectId: 'p1' }, { fieldLinkScope: 'list', fieldLinkProjectId: OPEN_PROJECT }, { fieldLinkScope: 'list', fieldLinkSprintId: { $ne: null } }]
            .forEach((bad) => expect(relationship.settings(bad).error).toEqual(expect.any(String)));
    });

    it('reads a relationship value as a list of task ids, each once, up to the field\'s cap', () => {
        expect(relationship.parse([task(1), task(2).toUpperCase(), task(1)], {})).toEqual({ value: [task(1), task(2)] });
        expect(relationship.parse('', {})).toEqual({ value: [] });
        expect(relationship.parse(ids(10), {}).value).toHaveLength(10);
        expect(relationship.parse(ids(11), {}).error).toMatch(/at most 10 tasks/i);
        expect(relationship.parse(ids(2), { fieldLinkMax: 1 }).error).toMatch(/at most 1 task/i);
        expect(relationship.parse(ids(20), { fieldLinkMax: 20 }).value).toHaveLength(20);
        [task(1), [{ $ne: null }], ['T-12'], [7], { id: task(1) }].forEach((bad) => expect(relationship.parse(bad, {}).error).toEqual(expect.any(String)));
    });

    it('shows the linked tasks a viewer was given, by key and title', () => {
        const shown = [{ id: task(1), key: 'T-1', title: 'Contract' }, { id: task(2), key: 'T-2', title: 'Invoice' }];
        expect(relationship.text(shown, {})).toBe('T-1 Contract, T-2 Invoice');
        expect(relationship.text([task(1)], {})).toBe('');
        expect(relationship.text('', {})).toBe('');
    });

    it('shows who voted unless the field says otherwise, and never takes a vote as a value', () => {
        expect(voting.settings({})).toEqual({ settings: { fieldVotersShown: true } });
        expect(voting.settings({ fieldVotersShown: false })).toEqual({ settings: { fieldVotersShown: false } });
        expect(voting.settings({ fieldVotersShown: 'no' }).error).toEqual(expect.any(String));
        [[OWNER], 3, '', null, [], { count: 3 }].forEach((sent) => expect(voting.parse(sent, {}).error).toEqual(expect.any(String)));
    });

    it('reads a vote count as a number to show and to order by', () => {
        expect(voting.text(3, {})).toBe('3');
        expect(voting.text(0, {})).toBe('');
        expect(voting.text('', {})).toBe('');
        expect(voting.sortValue(12, {})).toBe(12);
        expect(voting.sortValue('7', {})).toBe(7);
        expect(voting.sortValue(undefined, {})).toBeNull();
        expect(voting.sortValue(0, {})).toBeNull();
        expect(voting.sortValue([OWNER], {})).toBeNull();
    });
});

describe('saving the two field definitions', () => {
    it('declares their settings on the custom field schema and the linked ids on their own collection', () => {
        expect(schema.customFields.fieldLinkMax).toMatchObject({ type: Number });
        expect(schema.customFields.fieldLinkScope).toMatchObject({ type: String });
        expect(schema.customFields.fieldLinkProjectId).toMatchObject({ type: String });
        expect(schema.customFields.fieldLinkSprintId).toMatchObject({ type: String });
        expect(schema.customFields.fieldVotersShown).toMatchObject({ type: Boolean });
        expect(schema.customFieldLinks).toMatchObject({ taskId: { type: String, required: true }, fieldId: { type: String, required: true }, kind: { type: String, required: true }, ids: { type: [String] } });
        expect(schema.tasks.customField).toMatchObject({ type: Object });
    });

    it('fills the defaults and refuses settings that do not fit', () => {
        expect(fieldInsertFrom({ fieldTitle: 'Client', fieldType: 'relationship' })).toMatchObject({ fieldLinkMax: 10, fieldLinkScope: 'any' });
        expect(fieldInsertFrom({ fieldTitle: 'Upvotes', fieldType: 'voting' })).toMatchObject({ fieldVotersShown: true });
        expect(() => fieldInsertFrom({ fieldTitle: 'Client', fieldType: 'relationship', fieldLinkMax: 50 })).toThrow(FieldWriteError);
        expect(() => fieldUpdateFrom({ key: '$set', id: CLIENT, updateObject: { fieldLinkScope: 'company' } })).toThrow(FieldWriteError);
        expect(() => fieldUpdateFrom({ key: '$set', id: VOTES, updateObject: { fieldVotersShown: 'yes' } })).toThrow(FieldWriteError);
        expect(fieldUpdateFrom({ key: '$set', id: CLIENT, updateObject: { fieldLinkMax: 3 } }).fieldLinkMax).toBe(3);
        expect(fieldUpdateFrom({ key: '$set', id: TEXT, updateObject: { fieldTitle: 'Notes' } })).toEqual({ fieldTitle: 'Notes' });
    });

    it('cannot be filled by AI', () => {
        ['relationship', 'voting'].forEach((fieldType) => expect(() => normaliseAiConfig({ enabled: true }, fieldType)).toThrow(AiConfigError));
    });

    it('keeps their filters in a saved view', () => {
        const row = (fieldId, fieldType, comparison, values) => ({ name: { value: `customField.${fieldId}`, type: 'custom', fieldType, filterOn: `customField.${fieldId}.fieldValue` }, comparison: { value: comparison }, values, condition: '&&' });
        const kept = cleanViewSettings({ filters: [row(CLIENT, 'relationship', ':empty', [true]), row(CLIENT, 'relationship', ':has', [OUTSIDE]), row(VOTES, 'voting', ':mine', [true]), row(VOTES, 'voting', ':>', [3])] }).filters;
        expect(kept.map((filter) => filter.comparison.value)).toEqual([':empty', ':has', ':mine', ':>']);
    });
});

describe('writes that carry many values', () => {
    it('are refused by a caller that has no form', () => {
        expect(storedValueOf({ fieldType: 'relationship' }, [OUTSIDE]).error).toMatch(/linked in the app/i);
        expect(storedValueOf({ fieldType: 'voting' }, 3).error).toMatch(/cast in the app/i);
        expect(storedValueOf({ fieldType: 'voting' }, null).error).toEqual(expect.any(String));
    });

    it('leave both fields out of a new or copied task, without counting them as lost values', async () => {
        const sent = { [CLIENT]: { _id: CLIENT, fieldValue: [OUTSIDE, HIDDEN] }, [VOTES]: { _id: VOTES, fieldValue: [OWNER, MEMBER], count: 40 }, [TEXT]: { _id: TEXT, fieldValue: 'Acme' } };
        const kept = await storableFieldValues({ companyId: CID, task: { _id: SOURCE_COPY, ProjectID: COPY_PROJECT, customField: sent } });
        expect(kept).toEqual({ customField: { [TEXT]: sent[TEXT] }, dropped: [] });
    });

    it('say nothing of the linked tasks in the activity log', () => {
        const actor = { Employee_Name: 'Olivia Owner' };
        const definition = { _id: CLIENT, fieldTitle: 'Client', fieldType: 'relationship' };
        const entry = describeCustomFieldValue({ actor, definition, next: { _id: CLIENT, fieldValue: '', revision: 9 }, previous: { _id: CLIENT, fieldValue: '', revision: 5 } });
        expect(entry.message).toBe('<b>Olivia Owner</b> has changed the <b>Client</b> Custom Field.');
        expect(entry.message).not.toMatch(/T-\d|Task \d/);
    });
});

describe('copying a task that has linked tasks and votes', () => {
    const pairs = () => new Map([[SOURCE, SOURCE_COPY], [CHILD, CHILD_COPY]]);

    it('points a link inside the copied set at the copy, and keeps one outside it', async () => {
        await copyFieldLinks({ companyId: CID, actorId: OWNER, pairs: pairs() });
        expect(linksOf(SOURCE_COPY, CLIENT)).toEqual([CHILD_COPY, OUTSIDE, HIDDEN]);
        expect(linksOf(CHILD_COPY, CLIENT)).toEqual([SOURCE_COPY]);
        expect(linksOf(SOURCE, CLIENT)).toEqual([CHILD, OUTSIDE, HIDDEN, GONE]);
    });

    it('keeps only the outside links the person copying can open', async () => {
        await copyFieldLinks({ companyId: CID, actorId: MEMBER, pairs: pairs() });
        expect(linksOf(SOURCE_COPY, CLIENT)).toEqual([CHILD_COPY, OUTSIDE]);
    });

    it('marks the copy as written whether or not a link was kept', async () => {
        mockDb.store[SCHEMA_TYPE.CUSTOM_FIELD_LINKS].find((doc) => doc.taskId === SOURCE && doc.fieldId === CLIENT).ids = [HIDDEN];
        await copyFieldLinks({ companyId: CID, actorId: MEMBER, pairs: new Map([[SOURCE, SOURCE_COPY]]) });
        expect(linksOf(SOURCE_COPY, CLIENT)).toEqual([]);
        expect(storedTask(SOURCE_COPY).customField[CLIENT]).toMatchObject({ _id: CLIENT, fieldValue: '', revision: expect.any(Number) });
    });

    it('does not copy votes', async () => {
        await copyFieldLinks({ companyId: CID, actorId: OWNER, pairs: pairs() });
        expect(linksOf(SOURCE_COPY, VOTES)).toBeUndefined();
        expect((storedTask(SOURCE_COPY).customField || {})[VOTES]).toBeUndefined();
    });

    it('does nothing for a task with no linked tasks', async () => {
        await copyFieldLinks({ companyId: CID, actorId: OWNER, pairs: new Map([[OUTSIDE, SOURCE_COPY]]) });
        expect(links()).toHaveLength(3);
        expect(storedTask(SOURCE_COPY).customField).toBeUndefined();
    });
});
