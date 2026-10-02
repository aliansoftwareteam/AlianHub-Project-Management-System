const { manageEmailData } = require('../Modules/notification/sendEmail/controller');
const { Notification_key, TemplateType } = require('../Config/notificationKey');

const PROJECT = { ProjectName: 'Apollo' };
const listTask = (over = {}) => ({ TaskName: 'Write spec', TaskKey: 'APO-1', isParentTask: true, sprintArray: { name: 'Sprint 1' }, ...over });

const details = (key, over = {}) => ({
    notification: { type: 'tasks', key, User_Employee_Name: 'Ada', User_Employee_profileImage: 'ada.png', createdAt: { seconds: 1700000000 }, ...over.notification },
    projects: [PROJECT],
    tasks: [listTask()],
    comments: [],
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'notification')),
});

describe('manageEmailData header', () => {
    it('titles a task email with the project and lists project, list, task key', async () => {
        const { templateHeader } = await manageEmailData(details(Notification_key.CREATE_TASK));
        expect(templateHeader.title).toBe('Apollo');
        expect(templateHeader.description).toEqual([
            { title: 'Apollo', showFolder: false },
            { title: 'Sprint 1', showFolder: false },
            { title: 'APO-1', showFolder: false },
        ]);
    });

    it('puts the folder between the project and the list when the list sits in a folder', async () => {
        const task = listTask({ sprintArray: { name: 'Sprint 1', folderName: 'Q4' } });
        const { templateHeader } = await manageEmailData(details(Notification_key.TASK_STATUS, { tasks: [task] }));
        expect(templateHeader.description).toEqual([
            { title: 'Apollo', showFolder: false },
            { title: 'Q4', showFolder: true },
            { title: 'Sprint 1', showFolder: false },
            { title: 'APO-1', showFolder: false },
        ]);
    });

    it('only names the project when a task email carries no tasks', async () => {
        const { templateHeader } = await manageEmailData(details(Notification_key.COMMENTS_IM_MENTIONS_IN, { tasks: [] }));
        expect(templateHeader.description).toEqual([{ title: 'Apollo', showFolder: false }]);
    });

    it('gives a task email for a key with no template an empty header', async () => {
        const { templateHeader } = await manageEmailData(details('task_assignee'));
        expect(templateHeader).toEqual({ title: '', description: [] });
    });

    it('titles a project email with the project name and no description', async () => {
        const { templateHeader } = await manageEmailData(details('project_name', { notification: { type: 'project' } }));
        expect(templateHeader).toEqual({ title: 'Apollo', description: [] });
    });

    it('leaves a project email with no project untitled', async () => {
        const { templateHeader } = await manageEmailData(details('project_name', { notification: { type: 'project' }, projects: [] }));
        expect(templateHeader).toEqual({ title: '', description: [] });
    });

    it('leaves a "before" or unknown notification type with an empty header', async () => {
        for (const type of ['before', 'chat', undefined]) {
            const { templateHeader } = await manageEmailData(details(Notification_key.CREATE_TASK, { notification: { type } }));
            expect(templateHeader).toEqual({ title: '', description: [] });
        }
    });
});

describe('manageEmailData body', () => {
    it('describes a created task with who made it, when, and where it sits', async () => {
        const { templateBody } = await manageEmailData(details(Notification_key.CREATE_TASK));
        expect(templateBody).toHaveLength(1);
        expect(templateBody[0].key).toBe(TemplateType.CREATE);
        expect(templateBody[0].data).toEqual([{
            name: 'Ada', profile: 'ada.png', date: expect.stringMatching(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2} (AM|PM) \[IST\]$/),
            taskValue: 'Write spec', taskLabel: 'Task', list: 'Sprint 1',
        }]);
    });

    it('labels a sub task and carries the folder when there is one', async () => {
        const task = listTask({ isParentTask: false, sprintArray: { name: 'Sprint 1', folderName: 'Q4' } });
        const { templateBody } = await manageEmailData(details(Notification_key.CREATE_TASK, { tasks: [task] }));
        expect(templateBody[0].data[0]).toMatchObject({ taskLabel: 'Sub Task', folder: 'Q4', list: 'Sprint 1' });
    });

    it('gives one row per created task', async () => {
        const tasks = [listTask({ TaskName: 'A' }), listTask({ TaskName: 'B' })];
        const { templateBody } = await manageEmailData(details(Notification_key.CREATE_TASK, { tasks }));
        expect(templateBody[0].data.map((row) => row.taskValue)).toEqual(['A', 'B']);
    });

    it('shows N/A as the date when the notification has no timestamp', async () => {
        const { templateBody } = await manageEmailData(details(Notification_key.CREATE_TASK, { notification: { createdAt: undefined } }));
        expect(templateBody[0].data[0].date).toBe('N/A');
    });

    it('shows N/A as the date when the timestamp is zero or not in seconds form', async () => {
        for (const createdAt of [{ seconds: 0 }, {}, null]) {
            const { templateBody } = await manageEmailData(details(Notification_key.CREATE_TASK, { notification: { createdAt } }));
            expect(templateBody[0].data[0].date).toBe('N/A');
        }
    });

    it('lists each comment message under the commenter', async () => {
        const comments = [{ message: 'first' }, { message: 'second' }];
        const { templateBody } = await manageEmailData(details(Notification_key.COMMENTS_IM_MENTIONS_IN, { comments }));
        expect(templateBody).toHaveLength(1);
        expect(templateBody[0].key).toBe(TemplateType.COMMENTS);
        expect(templateBody[0].data.map((row) => [row.name, row.profile, row.message])).toEqual([['Ada', 'ada.png', 'first'], ['Ada', 'ada.png', 'second']]);
    });

    it('returns an empty comments block when there are no comments', async () => {
        const { templateBody } = await manageEmailData(details(Notification_key.COMMENTS_IM_MENTIONS_IN));
        expect(templateBody).toEqual([{ key: TemplateType.COMMENTS, data: [] }]);
    });

    it.each([Notification_key.TASK_STATUS, Notification_key.TASK_NAME, Notification_key.TASK_DESCRIPTION, Notification_key.TASK_PRIORITY])(
        'describes a %s change with its type and data, one row per task',
        async (key) => {
            const tasks = [listTask(), listTask({ TaskName: 'Second' })];
            const notification = { changeType: 'status', changeData: { from: 'Open', to: 'Done' } };
            const { templateBody } = await manageEmailData(details(key, { notification, tasks }));
            expect(templateBody[0].key).toBe(TemplateType.UPDATES);
            expect(templateBody[0].data).toHaveLength(2);
            expect(templateBody[0].data[0]).toMatchObject({ name: 'Ada', profile: 'ada.png', changeType: 'status', changeData: { from: 'Open', to: 'Done' } });
        },
    );

    it('defaults a change with no type or data to empty values', async () => {
        const { templateBody } = await manageEmailData(details(Notification_key.TASK_STATUS));
        expect(templateBody[0].data[0]).toMatchObject({ changeType: '', changeData: {} });
    });

    it('returns an empty updates block when no task changed', async () => {
        const { templateBody } = await manageEmailData(details(Notification_key.TASK_STATUS, { tasks: [] }));
        expect(templateBody).toEqual([{ key: TemplateType.UPDATES, data: [] }]);
    });

    it('returns no body blocks for a notification key that has no template', async () => {
        const { templateBody } = await manageEmailData(details('task_assignee'));
        expect(templateBody).toEqual([]);
    });
});
