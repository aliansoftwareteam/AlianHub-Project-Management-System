const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/GeneralReminders/queue', () => ({ enqueue: jest.fn(async () => ({})), dequeue: jest.fn(async () => ({})) }));
jest.mock('../Modules/GeneralReminders/attachmentResolver', () => ({ buildMailAttachments: jest.fn(async () => []) }));
jest.mock('../Modules/service.js', () => ({ sendAttachMail: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/GeneralReminders/controller');

const C = '6f0000000000000000000c01';
const AUTHOR = '6f0000000000000000000a03';
const ASSIGNEE = '6f0000000000000000000a05';
const REMINDER = '6f0000000000000000000b01';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const call = async (handler, over = {}) => {
    const r = res();
    await handler({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid: AUTHOR, ...over }, r);
    return r;
};
const rows = () => mockDb.store[SCHEMA_TYPE.GENERAL_REMINDERS] || [];
const future = () => new Date(Date.now() + 86400000).toISOString();
const file = (url) => ({ name: 'file.png', url, extension: 'png', size: 10 });

const OWN = `Reminders/${C}/${AUTHOR}/1_file.png`;
const OF_THE_ASSIGNEE = `Reminders/${C}/${ASSIGNEE}/2_file.png`;
/* Keys of files kept elsewhere: a task's comment, another person's reminder, a path that climbs out, an address. */
const ELSEWHERE = [
    'Project/6f0000000000000000000a01/6f0000000000000000000b02/6f0000000000000000000d02/Comments/secret.png',
    OF_THE_ASSIGNEE,
    `Reminders/${C}/${AUTHOR}/../../Project/secret.png`,
    `Reminders/6f0000000000000000000c02/${AUTHOR}/3_file.png`,
    'https://files.example.test/secret.png',
];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    [AUTHOR, ASSIGNEE].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false }));
});

describe('the files of a reminder', () => {
    it('are the ones its person uploaded for a reminder, and nothing kept elsewhere', async () => {
        const made = await call(ctrl.createReminder, { body: { title: 'Call back', remindAt: future(), attachments: [file(OWN), ...ELSEWHERE.map(file)] } });

        expect(made.body.status).toBe(true);
        expect(rows()[0].attachments.map((a) => a.url)).toEqual([OWN]);
    });

    it('stay on it when another person edits it, and that person adds only their own', async () => {
        mockDb.seed(SCHEMA_TYPE.GENERAL_REMINDERS, {
            _id: REMINDER, title: 'for you', userId: ASSIGNEE, createdBy: AUTHOR, companyId: C, attachments: [file(OWN)],
            remindAt: new Date(future()), notifyBefore: -1, fired: false, isDone: false, deletedStatusKey: 0,
        });
        const edited = await call(ctrl.updateReminder, { uid: ASSIGNEE, params: { id: REMINDER }, body: { attachments: [file(OWN), file(OF_THE_ASSIGNEE), file(ELSEWHERE[0]), file(ELSEWHERE[4])] } });

        expect(edited.body.status).toBe(true);
        expect(rows()[0].attachments.map((a) => a.url)).toEqual([OWN, OF_THE_ASSIGNEE]);
    });
});
