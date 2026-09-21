const { io } = require('socket.io-client');
const { createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

const connect = ({ accessToken, companyId = state.companyId, userId }) => new Promise((resolve, reject) => {
    const socket = io(`${state.baseURL}/userid_${companyId}_${userId}`, {
        transports: ['websocket'],
        auth: { token: accessToken },
        query: { userRole: 3 },
        reconnection: false,
        timeout: 10000,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
        socket.close();
        reject(error);
    });
});

const joinTask = (socket, taskId) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    socket.emit('joinTaskDetail', { taskId, socketId: socket.id }, (answer) => {
        clearTimeout(timer);
        resolve(answer);
    });
});

const setPriority = (api, { project, task, user, priority }) => api.patch('/api/v2/tasks', {
    action: 'updatePriority',
    firebaseObj: { Task_Priority: priority },
    projectData: { _id: String(project._id), ProjectName: project.name, CompanyId: api.companyId },
    taskData: { _id: String(task._id), ProjectID: String(project._id), sprintId: task.sprintId },
    priorityObj: { taskId: String(task._id), taskName: task.name || '', priorityName: 'MEDIUM', newPriorityName: priority },
    userData: { Employee_Name: 'E2E', id: user.userId, companyOwnerId: user.userId },
    isUpdateTask: true,
});

describe('socket room authorisation', () => {
    const open = [];
    afterEach(() => {
        open.splice(0).forEach((socket) => socket.close());
    });
    const openAs = async (session) => {
        const socket = await connect({ accessToken: session.accessToken, userId: session.userId });
        open.push(socket);
        return socket;
    };

    it('lets a member join a task room in a shared project and receive its updates', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const task = state.tasks[0];
        const socket = await openAs(member);
        expect(await joinTask(socket, task._id)).toEqual({ joined: true });

        const update = new Promise((resolve) => socket.once('taskDetail_taskUpdate', resolve));
        const res = await setPriority(owner.api, { project: state.projects.shared, task, user: state.users.owner, priority: 'HIGH' });
        expect(res.status).toBe(200);
        const payload = await update;
        expect(String(payload.fullDocument._id)).toBe(task._id);
    });

    it('refuses a member the room of a task in a private project they are not on', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const task = await createTask(owner.api, { project: state.projects.restricted, name: `SOCKET Hidden ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.userId });
        const socket = await openAs(member);
        expect(await joinTask(socket, task._id)).toEqual({ joined: false });
        const ownerSocket = await openAs(owner);
        expect(await joinTask(ownerSocket, task._id)).toEqual({ joined: true });
    });

    it('refuses a namespace naming another user', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        await expect(connect({ accessToken: member.accessToken, userId: owner.userId })).rejects.toThrow(/Authentication error/);
    });
});
