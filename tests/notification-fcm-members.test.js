jest.mock('../Modules/notification/notification-middleware/push-controllerV2', () => ({}));
jest.mock('../Modules/notification/notification-middleware/email-controllerV2', () => ({}));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn() }));
jest.mock('../Modules/notification/notification-middleware/sendNotification', () => ({ sendFCMNotification: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/notification/prepare-notification-data/settings-controllerV2', () => ({ getNotificationSetttings: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/user-controllerV2', () => ({ getUsersDetails: jest.fn() }));
jest.mock('../Modules/notification/activeMembers', () => ({ activeMemberIds: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { sendFCMNotification } = require('../Modules/notification/notification-middleware/sendNotification');
const { getNotificationSetttings } = require('../Modules/notification/prepare-notification-data/settings-controllerV2');
const { getUsersDetails } = require('../Modules/notification/prepare-notification-data/user-controllerV2');
const { activeMemberIds } = require('../Modules/notification/activeMembers');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { sendFcmNotificationsHandler } = require('../Modules/notification/notification-middleware/controllerV2');

const C = '6f0000000000000000000c01';
const SENDER = '6f0000000000000000000a01';
const MEMBER = '6f0000000000000000000a02';
const STRANGER = '6f0000000000000000000a03';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

const call = async (body) => {
    const r = res();
    await sendFcmNotificationsHandler({
        headers: { companyid: C },
        uid: SENDER,
        body: { companyId: C, message: 'hi', key: 'message_create', type: 'chat', actionUrl: `${C}/chat/p/t`, senderUserDetail: { Employee_Name: 'Someone Else' }, ...body },
    }, r);
    return r;
};

beforeEach(() => {
    jest.clearAllMocks();
    activeMemberIds.mockImplementation(async (_, ids) => ids.filter((id) => id === MEMBER));
    getNotificationSetttings.mockImplementation(async (ids) => ids.map((userId) => ({ userId, chat: { items: [{ key: 'message_create', browser: true }] } })));
    getUsersDetails.mockImplementation(async (ids) => ids.map((userId) => ({ userId, webTokens: [`token-${userId}`] })));
    MongoDbCrudOpration.mockResolvedValue({ Employee_Name: 'Sam Sender' });
});

describe('send-fcm', () => {
    it('pushes to the active members named, titled with the signed-in sender', async () => {
        const r = await call({ userIdArray: [MEMBER, STRANGER] });

        expect(r.body).toEqual({ success: true, message: 'Notification processed' });
        expect(activeMemberIds).toHaveBeenCalledWith(C, [MEMBER, STRANGER]);
        expect(getNotificationSetttings).toHaveBeenCalledWith([MEMBER], C);
        expect(sendFCMNotification).toHaveBeenCalledTimes(1);
        const { notification, tokens } = sendFCMNotification.mock.calls[0][0];
        expect(tokens).toEqual([`token-${MEMBER}`]);
        expect(notification.title).toBe('Sam Sender - Chat Notification');
    });

    it('sends nothing, and answers the same, when no one named is a member', async () => {
        const r = await call({ userIdArray: [STRANGER] });

        expect(r.body).toEqual({ success: true, message: 'Notification processed' });
        expect(getNotificationSetttings).not.toHaveBeenCalled();
        expect(sendFCMNotification).not.toHaveBeenCalled();
    });

    it('answers the same when sending fails', async () => {
        sendFCMNotification.mockRejectedValueOnce(new Error('fcm down'));
        const r = await call({ userIdArray: [MEMBER] });

        expect([r.code, r.body]).toEqual([200, { success: true, message: 'Notification processed' }]);
    });

    it('refuses a body that names another company before reading anything', async () => {
        const r = await call({ userIdArray: [MEMBER], companyId: '6f0000000000000000000c02' });

        expect([r.code, r.body.success]).toEqual([403, false]);
        expect(activeMemberIds).not.toHaveBeenCalled();
    });
});
