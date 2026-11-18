const mockSettings = { rows: [] };
const mockRooms = {};
const mockSeated = { companies: {} };

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/settings-controllerV2', () => ({
    getNotificationSetttings: jest.fn(async (userIds) => mockSettings.rows.filter((row) => userIds.includes(row.userId))),
}));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({ employeeNameOf: jest.fn(async () => 'Asha Rao') }));
jest.mock('../socket/helper', () => ({
    joinRoom: jest.fn(),
    upsertRoom: jest.fn(),
    findRoomsByPrefix: (prefix) => mockRooms[prefix] || [],
}));
jest.mock('../socket/roomAccess', () => ({
    onJoin: jest.fn(),
    roomFor: jest.fn(),
    isSelf: jest.fn(),
    toSeated: async (rooms, companyId, send) => {
        for (const room of rooms) {
            if ((mockSeated.companies[room.uid] || []).includes(companyId)) send(room);
        }
    },
}));

const socketEmitter = require('../event/socketEventEmitter');
const { tellChatRecipients, previewOf, CHAT_NOTICE_EVENT } = require('../Modules/Comments/helpers/chatNotices');
const { relayChatNotice } = require('../socket/controller/userNotificationCount');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const DIRECTS = '6f0000000000000000000b03';
const CHATS = '6f0000000000000000000b02';
const SPRINT = '6f0000000000000000000d01';
const DM = '6f0000000000000000000e03';
const [AUTHOR, READER, MUTED] = ['01', '02', '03'].map((n) => `6f00000000000000000000${n}`);

const emitted = () => socketEmitter.emit.mock.calls.filter(([name]) => name === CHAT_NOTICE_EVENT).map(([, payload]) => payload);
const message = (thread, extra = {}) => ({ _id: 'c1', userId: AUTHOR, message: 'Lunch at one?', ...thread, ...extra });

beforeEach(() => {
    socketEmitter.emit.mockClear();
    mockSettings.rows = [];
});

describe('a chat message is announced to the people it reached', () => {
    it('a direct message tells its other participant who wrote what, and where to open it', async () => {
        await tellChatRecipients(C, message({ projectId: DIRECTS, sprintId: SPRINT, taskId: DM }), { userIds: [READER], chatSpace: true, channelName: '' });

        expect(emitted()).toEqual([{
            companyId: C,
            deliveries: [{
                userId: READER,
                notice: {
                    commentId: 'c1', projectId: DIRECTS, sprintId: SPRINT, conversationId: DM, channel: false, channelName: '',
                    senderId: AUTHOR, senderName: 'Asha Rao', preview: 'Lunch at one?', fileName: '', browser: true,
                },
            }],
        }]);
    });

    it('a channel post is opened by its channel and carries its name', async () => {
        await tellChatRecipients(C, message({ projectId: CHATS, sprintId: SPRINT, taskId: 'default' }), { userIds: [READER], chatSpace: true, channelName: 'design' });

        const [{ notice }] = emitted()[0].deliveries;
        expect(notice).toMatchObject({ conversationId: SPRINT, channel: true, channelName: 'design' });
    });

    it('a person who turned off browser notices for new messages still gets the in-app notice', async () => {
        mockSettings.rows = [{ userId: MUTED, chat: { items: [{ key: 'message_create', browser: false }] } }];
        await tellChatRecipients(C, message({ projectId: DIRECTS, sprintId: SPRINT, taskId: DM }), { userIds: [READER, MUTED], chatSpace: true });

        expect(emitted()[0].deliveries.map(({ userId, notice }) => [userId, notice.browser])).toEqual([[READER, true], [MUTED, false]]);
    });

    it('a file with no text is named by its file', async () => {
        await tellChatRecipients(C, message({ projectId: DIRECTS, sprintId: SPRINT, taskId: DM }, { message: '', mediaOriginalName: 'plan.pdf' }), { userIds: [READER], chatSpace: true });

        expect(emitted()[0].deliveries[0].notice).toMatchObject({ preview: '', fileName: 'plan.pdf' });
    });

    it('nothing for a task comment, or when nobody else was reached', async () => {
        await tellChatRecipients(C, message({ projectId: DIRECTS, sprintId: SPRINT, taskId: DM }), { userIds: [READER], chatSpace: false });
        await tellChatRecipients(C, message({ projectId: DIRECTS, sprintId: SPRINT, taskId: DM }), { userIds: [], chatSpace: true });
        await tellChatRecipients(C, message({ projectId: DIRECTS, sprintId: SPRINT, taskId: DM }), null);

        expect(emitted()).toEqual([]);
    });
});

describe('the preview is short plain text', () => {
    it('names a mention by its person and drops markup', () => {
        expect(previewOf('Hi @[Asha Rao](6f0000000000000000000001) &amp; <b>team</b>')).toBe('Hi @Asha Rao & team');
    });

    it('cuts a long message', () => {
        const preview = previewOf('a'.repeat(400));
        expect(preview).toHaveLength(140);
        expect(preview.endsWith('…')).toBe(true);
    });
});

describe('the relay sends each person only their own notice', () => {
    const roomOf = (uid) => ({ uid, roomName: `userIdNotification_${uid}**s-${uid}`, namespace: { to: jest.fn(() => ({ emit: roomOf.sent(uid) })) } });
    roomOf.log = [];
    roomOf.sent = (uid) => (event, payload) => roomOf.log.push([uid, event, payload]);

    beforeEach(() => {
        roomOf.log = [];
        mockRooms[`userIdNotification_${READER}`] = [roomOf(READER)];
        mockRooms[`userIdNotification_${MUTED}`] = [roomOf(MUTED)];
        mockSeated.companies = { [READER]: [C], [MUTED]: [OTHER_COMPANY] };
    });

    it('in the company the message was written in', async () => {
        await relayChatNotice({
            companyId: C,
            deliveries: [{ userId: READER, notice: { commentId: 'c1', browser: true } }, { userId: MUTED, notice: { commentId: 'c1', browser: false } }],
        });

        expect(roomOf.log).toEqual([[READER, 'chatMessageNotice', { commentId: 'c1', browser: true }]]);
    });
});
