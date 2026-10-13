const mockCrud = jest.fn(async () => ({ acknowledged: true, modifiedCount: 1 }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { dbCollections, settingsCollectionDocs } = require('../Config/collections');
const rules = require('../Modules/settings/securityPermissions/controller');
const taskTypeTemplates = require('../Modules/settings/templates/taskType/controller');
const taskStatusTemplates = require('../Modules/settings/templates/taskStatus/controller');
const dateFormat = require('../Modules/settings/commonDateFormate/controller');
const fileExtensions = require('../Modules/settings/fileExtensions/controller');
const taskPriority = require('../Modules/settings/taskPriority/controller');
const milestone = require('../Modules/settings/settingMilestone/controller');

const C = '6f0000000000000000000c01';
const ID = '6f0000000000000000000a01';

const call = async (handler, body) => {
    const r = { code: 200 };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    await handler({ headers: { companyid: C }, body, uid: '6f0000000000000000000001' }, r);
    return r;
};

const writeOf = () => {
    expect(mockCrud).toHaveBeenCalledTimes(1);
    const [companyId, { type, data }, method] = mockCrud.mock.calls[0];
    return { companyId, type, data, method };
};

beforeEach(() => mockCrud.mockClear());

const ROUTES = {
    securityPermissions: rules.updateSecurityPermissions,
    'templates/taskType': taskTypeTemplates.updateTaskTypeTemplate,
    'templates/taskStatus': taskStatusTemplates.updateTaskStatusTemplate,
    commonDateFormate: dateFormat.updateCommonDateFormate,
    fileExtensions: fileExtensions.updateFileExtensions,
    taskPriority: taskPriority.updateTaskPriority,
    milestoneStatus: milestone.updateMilestoneStatus,
};

describe('the updates the settings screens send still apply', () => {
    it('security permissions: set the roles of one rule', async () => {
        const roles = [{ key: 3, permission: true }];
        const r = await call(ROUTES.securityPermissions, { type: 'updateOne', key: '$set', updateObject: { roles }, id: ID });

        expect(r.code).toBe(200);
        const { type, data } = writeOf();
        expect(type).toBe(dbCollections.RULES);
        expect(data[1].$set).toMatchObject({ roles });
    });

    it.each([
        ['templates/taskType', dbCollections.TASK_TYPE_TEMPLATES],
        ['templates/taskStatus', dbCollections.TASK_STATUS_TEMPLATES],
    ])('%s: rename a template', async (route, collection) => {
        const r = await call(ROUTES[route], { type: 'updateOne', key: '$set', updateObject: { TemplateName: 'Renamed' }, id: ID });

        expect(r.code).toBe(200);
        const { type, data } = writeOf();
        expect(type).toBe(collection);
        expect(data[1].$set).toMatchObject({ TemplateName: 'Renamed' });
    });

    it('date format: set the format', async () => {
        const r = await call(ROUTES.commonDateFormate, { key: '$set', updateObject: { settings: [{ dateFormat: 'DD/MM/YYYY' }] } });

        expect(r.code).toBe(200);
        expect(writeOf().data[1]).toEqual({ $set: { settings: [{ dateFormat: 'DD/MM/YYYY' }] } });
    });

    it.each([
        ['fileExtensions', settingsCollectionDocs.ALLOWED_FILE_EXTENSION, { name: 'pdf', systemGenerated: false }],
        ['taskPriority', settingsCollectionDocs.TASK_PRIORITIES, { name: 'Low', image: 'x.png', statusImage: 'x.png', value: 'LOW', isDeleted: true, isExpanded: true }],
        ['milestoneStatus', settingsCollectionDocs.PROJECT_MILESTONE_STATUS, { name: 'Late', backgroundColor: '#818181', isFuture: false, isPast: true, isDeleted: true, value: 'abc', isDefault: false, isCount: 0 }],
    ])('%s: add and remove an entry', async (route, docName, entry) => {
        for (const key of ['$push', '$pull']) {
            mockCrud.mockClear();
            const r = await call(ROUTES[route], { key, updateObject: { settings: entry } });

            expect(r.code).toBe(200);
            const { type, data } = writeOf();
            expect(type).toBe(dbCollections.SETTINGS);
            expect(data[0]).toEqual({ name: docName });
            expect(data[1]).toEqual({ [key]: { settings: entry } });
        }
    });

    it('milestoneStatus: edit one entry through its array filter', async () => {
        const entry = { name: 'Late', backgroundColor: '#000000', isFuture: false, isPast: true, value: 'abc' };
        const r = await call(ROUTES.milestoneStatus, {
            key: '$set',
            updateObject: { 'settings.$[elementIndex]': entry },
            arrayFilters: [{ 'elementIndex.value': 'abc' }],
        });

        expect(r.code).toBe(200);
        const { data } = writeOf();
        expect(data[1]).toEqual({ $set: { 'settings.$[elementIndex]': entry } });
        expect(data[2]).toEqual({ arrayFilters: [{ 'elementIndex.value': 'abc' }] });
    });
});

describe('any other update is refused with 400 and writes nothing', () => {
    const refused = async (route, body) => {
        const r = await call(ROUTES[route], body);
        expect(r.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    };

    it.each([
        ['securityPermissions', { type: 'updateOne', key: '$unset', updateObject: { roles: '' }, id: ID }],
        ['securityPermissions', { type: 'updateOne', key: '$set', updateObject: { key: 'renamed_rule' }, id: ID }],
        ['securityPermissions', { type: 'updateOne', key: '$set', updateObject: { roles: 'all' }, id: ID }],
        ['securityPermissions', { type: 'updateOne', key: '$rename', updateObject: { roles: 'x' }, id: ID }],
        ['templates/taskType', { type: 'updateOne', key: '$set', updateObject: { settings: [] }, id: ID }],
        ['templates/taskType', { type: 'updateOne', key: '$unset', updateObject: { TemplateName: '' }, id: ID }],
        ['templates/taskStatus', { type: 'updateOne', key: '$set', updateObject: { TemplateName: { $concat: ['a'] } }, id: ID }],
        ['templates/taskStatus', { type: 'updateOne', key: '$push', updateObject: { settings: {} }, id: ID }],
        ['commonDateFormate', { key: '$unset', updateObject: { settings: '' } }],
        ['commonDateFormate', { key: '$set', updateObject: { name: 'other_doc' } }],
        ['fileExtensions', { key: '$set', updateObject: { settings: [] } }],
        ['fileExtensions', { key: '$pull', updateObject: { settings: { name: { $ne: 'pdf' } } } }],
        ['fileExtensions', { key: '$push', updateObject: { name: 'x' } }],
        ['taskPriority', { key: '$unset', updateObject: { settings: '' } }],
        ['taskPriority', { key: '$push', updateObject: { settings: 'LOW' } }],
        ['milestoneStatus', { key: '$set', updateObject: { settings: [] } }],
        ['milestoneStatus', { key: '$inc', updateObject: { 'settings.0.isCount': 1 } }],
        ['milestoneStatus', { key: '$set', updateObject: { 'settings.$[elementIndex]': { name: 'x' } }, arrayFilters: [{ 'elementIndex.value': { $exists: true } }] }],
        ['milestoneStatus', { key: '$push', updateObject: { settings: { name: 'x' } }, arrayFilters: [{ 'elementIndex.value': 'abc' }] }],
    ])('%s refuses %j', refused);

    it.each(Object.keys(ROUTES))('%s refuses an update object that is not an object', async (route) => {
        await refused(route, { type: 'updateOne', key: '$set', updateObject: ['roles'], id: ID });
    });
});
