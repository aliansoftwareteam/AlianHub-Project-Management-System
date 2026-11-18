jest.mock('../Modules/notification/email-notification-handler/controllerV2', () => ({
    fetchProjectDetailsSingle: jest.fn(async () => []),
    fetchTaskDetails: jest.fn(async () => []),
}));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({})) }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');

const C = '6f0000000000000000000c01';
const within = (promise, ms = 500) => Promise.race([
    promise.then(() => 'resolved', () => 'rejected'),
    new Promise((resolve) => setTimeout(() => resolve('pending'), ms)),
]);

describe('MSG-06 HandleBothNotification always settles', () => {
    it('settles for an empty payload', async () => {
        expect(await within(HandleBothNotification({}))).toBe('rejected');
    });

    it('settles when the task it names does not exist', async () => {
        const payload = { type: 'tasks', companyId: C, projectId: '6f0000000000000000000701', taskId: '6f0000000000000000000801', object: { key: 'k', message: 'm' }, userData: { id: 'u' } };
        expect(await within(HandleBothNotification(payload))).toBe('rejected');
    });

    it('settles when the project it names does not exist', async () => {
        const payload = { type: 'project', companyId: C, projectId: '6f0000000000000000000701', object: { key: 'k', message: 'm' }, userData: { id: 'u' } };
        expect(await within(HandleBothNotification(payload))).toBe('rejected');
    });
});
