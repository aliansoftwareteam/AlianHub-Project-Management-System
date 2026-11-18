const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { dbCollections } = require('../Config/collections');
const { TemplateData } = require('../utils/Tempates/task_type');
const { projectRequestFromTemplates } = require('../Modules/Setup/demoProject');

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { delete mockDb.store[type]; });
    mockDb.seed(dbCollections.APPS, { key: 'tags' });
    mockDb.seed(dbCollections.PROJECT_TAB_COMPONENTS, { keyName: 'ProjectListView' });
    mockDb.seed(dbCollections.TASK_STATUS_TEMPLATES, {
        default: true,
        defaultActive: { name: 'To Do', key: 1, textColor: '#ff9600' },
        ActiveStatusList: [{ name: 'In Progress', key: 3, textColor: '#6473e8' }],
        defaultComplete: { name: 'Complete', key: 2, textColor: '#6bc950' },
    });
    mockDb.seed(dbCollections.PROJECT_STATUS_TEMPLATES, { default: true, projectActiveStatus: [{ value: 'open', default: true }] });
});

describe('projectRequestFromTemplates', () => {
    it('uses the built-in task types when the company has no task type template', async () => {
        const { body } = await projectRequestFromTemplates('c1', 'u1', { ProjectName: 'QA Sandbox' });
        const builtIn = TemplateData().find((template) => template.default === true);

        expect(body.taskTypeCounts).toEqual(builtIn.taskTypes);
        expect(body.TaskTypeTemplateId).toBe('');
        expect(body.taskStatusData.map((s) => s.type)).toEqual(['default_active', 'active', 'close']);
    });

    it('prefers the company template and lets fields override the defaults', async () => {
        const template = mockDb.seed(dbCollections.TASK_TYPE_TEMPLATES, { default: true, taskTypes: [{ name: 'Story', key: 7 }] });
        const { body } = await projectRequestFromTemplates('c1', 'u1', { ProjectName: 'QA Sandbox', AssigneeUserId: ['u1', 'u2'], demo: true });

        expect(body.taskTypeCounts).toEqual([{ name: 'Story', key: 7 }]);
        expect(body.TaskTypeTemplateId).toBe(template._id);
        expect(body).toMatchObject({ CompanyId: 'c1', projectCreatedBy: 'u1', ProjectName: 'QA Sandbox', AssigneeUserId: ['u1', 'u2'], demo: true });
    });

    it('refuses when the company has no task status template', async () => {
        delete mockDb.store[dbCollections.TASK_STATUS_TEMPLATES];
        await expect(projectRequestFromTemplates('c1', 'u1')).rejects.toThrow(/no seeded templates/);
    });
});
