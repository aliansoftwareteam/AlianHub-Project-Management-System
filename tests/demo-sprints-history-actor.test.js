/* The demo project's extra sprints went through addSprintFun with `userData: {}`, so each one's
   history row had no UserId and failed validation ("UserId required") during setup. */
const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { addSprintFun } = require('../Modules/Sprints/controller');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { seedSampleTasks, demoTasksForFocus } = require('../utils/sampleTasks');

const OWNER = '664d8a1e00f2ae12ba606d22';
const project = {
    _id: '67beeeea2930c35b90cd873e',
    CompanyId: '664d884cae4b92e071ac3b99',
    ProjectName: 'Welcome to AlianHub',
    ProjectCode: 'WELCOME',
    lastTaskId: 0,
    taskTypeCounts: [{ name: 'Task', key: 1, value: 'task' }],
    taskStatusData: [
        { name: 'To Do', key: 1, type: 'default_active' },
        { name: 'In Progress', key: 3, type: 'active' },
        { name: 'Done', key: 6, type: 'active' },
        { name: 'Complete', key: 2, type: 'close' },
    ],
};
const sprint = { _id: '67beeeea2930c35b90cd874c', name: 'List', projectId: project._id, tasks: 0 };

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockImplementation(async (db, query) => (
        query.type === SCHEMA_TYPE.USERS ? { _id: OWNER, Employee_Name: 'Priya Shah' } : {}
    ));
    addSprintFun.mockImplementation(async ({ body }) => ({
        status: true,
        data: { _id: new mongoose.Types.ObjectId(), name: body.sprintName, projectId: body.projectId },
    }));
});

test('the demo sprints are attributed to the project owner', async () => {
    await seedSampleTasks(project, sprint, demoTasksForFocus(''), OWNER);

    expect(addSprintFun).toHaveBeenCalled();
    for (const [req] of addSprintFun.mock.calls) {
        expect(req.body.userData).toMatchObject({ id: OWNER, Employee_Name: 'Priya Shah' });
    }
});
