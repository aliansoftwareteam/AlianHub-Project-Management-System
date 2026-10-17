const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { PASSWORD, assertOk, login, inviteMember, createProject, firstSprint } = require('../../e2e/support/fixtures');

const DAY_MS = 24 * 60 * 60 * 1000;

const COMPANY = 'Northwind Studio';
const OWNER = { firstName: 'Maya', lastName: 'Chen', title: 'Head of Delivery', email: 'maya.chen@northwind.example' };
const TEAM = [
    { role: 'admin', firstName: 'Priya', lastName: 'Nair', title: 'Project Manager', email: 'priya.nair@northwind.example' },
    { role: 'member', firstName: 'Diego', lastName: 'Alvarez', title: 'Full-stack Developer', email: 'diego.alvarez@northwind.example' },
    { role: 'member', firstName: 'Sofia', lastName: 'Rossi', title: 'Frontend Developer', email: 'sofia.rossi@northwind.example' },
    { role: 'member', firstName: 'Kenji', lastName: 'Tanaka', title: 'Product Designer', email: 'kenji.tanaka@northwind.example' },
    { role: 'member', firstName: 'Amara', lastName: 'Okafor', title: 'QA Lead', email: 'amara.okafor@northwind.example' },
];

const nameOf = (person) => `${person.firstName} ${person.lastName}`;

const LISTS = ['Discovery', 'Design', 'Build', 'Launch'];

/* [name, list, person (0 = Maya), state, priority, start day, length in days], days relative to today. */
const TASKS = [
    ['Audit existing site content', 0, 1, 'done', 'MEDIUM', -26, 5],
    ['Interview five customers', 0, 2, 'done', 'HIGH', -24, 6],
    ['Define success metrics', 0, 0, 'done', 'HIGH', -20, 3],
    ['Draft information architecture', 1, 1, 'done', 'HIGH', -17, 5],
    ['Design homepage wireframes', 1, 4, 'done', 'MEDIUM', -13, 6],
    ['Build design system tokens', 1, 4, 'active', 'HIGH', -8, 9],
    ['Set up staging environment', 2, 2, 'done', 'MEDIUM', -9, 4],
    ['Implement navigation and footer', 2, 3, 'active', 'HIGH', -4, 8],
    ['Migrate blog posts', 2, 2, 'active', 'MEDIUM', -2, 10],
    ['Build pricing page', 2, 3, 'active', 'URGENT', -1, 6],
    ['Accessibility pass on templates', 2, 5, 'todo', 'MEDIUM', 3, 6],
    ['Set up redirects for old URLs', 3, 2, 'todo', 'HIGH', 7, 4],
    ['Write launch announcement', 3, 0, 'todo', 'LOW', 10, 3],
    ['Load test the checkout flow', 3, 5, 'todo', 'MEDIUM', 12, 4],
    ['Go-live checklist and rollback plan', 3, 1, 'todo', 'URGENT', 15, 3],
    ['Client sign-off on homepage design', 1, 0, 'active', 'HIGH', -4, 4],
    ['Review pricing page copy', 2, 0, 'todo', 'MEDIUM', -1, 1],
    ['Plan launch week with the client', 3, 0, 'todo', 'HIGH', 0, 2],
];

/* [task, person, days ago, start, minutes, note]; Maya's own week is logged in the how-to video. */
const TIME = [
    [0, 1, 6, '09:00', 150, 'Reviewed the sitemap'], [1, 2, 6, '13:00', 120, 'Customer call notes'],
    [3, 1, 5, '09:30', 180, 'Page hierarchy'], [4, 4, 5, '14:00', 240, 'Homepage layouts'],
    [5, 4, 4, '09:00', 210, 'Token audit'], [6, 2, 4, '13:30', 150, 'Staging pipeline'],
    [7, 3, 3, '09:30', 270, 'Navigation component'], [8, 2, 3, '14:00', 150, 'Blog import script'],
    [5, 4, 2, '09:00', 180, 'Spacing scale'], [9, 3, 2, '13:00', 195, 'Pricing table'],
    [7, 3, 1, '09:00', 180, 'Footer links'], [8, 2, 1, '11:00', 120, 'Post cleanup'],
    [9, 3, 0, '09:00', 150, 'Plan comparison copy'], [10, 5, 1, '10:00', 90, 'Template checklist'],
    [2, 0, 4, '10:00', 60, 'Metrics review'], [12, 0, 2, '15:00', 45, 'Announcement outline'],
    [15, 0, 3, '09:00', 120, 'Homepage review with the client'], [15, 0, 2, '10:00', 90, 'Feedback round two'],
    [16, 0, 1, '09:30', 75, 'Pricing copy edits'], [17, 0, 1, '14:00', 60, 'Launch week outline'],
];

const AGENTS = [
    ['Status Reporter', 'Writes a Friday summary of what moved, what slipped and what is blocked.'],
    ['Priorities Manager', 'Flags tasks that are overdue or at risk and suggests a new order.'],
];

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const dayStamp = (daysAgo) => new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);

async function createList(api, { project, name, owner }) {
    const res = await api.post('/api/v1/sprint', {
        companyId: api.companyId, projectId: project._id, sprintName: name, userData: { id: owner.userId, Employee_Name: nameOf(owner) }, projectName: project.ProjectName,
        folder: {}, private: false,
    });
    return { _id: String(assertOk(res, `create list ${name}`).data._id), name };
}

async function createTask(api, { project, name, owner, assigneeIds, sprint }) {
    const status = project.taskStatusData.find((x) => x.type === 'default_active');
    const taskType = project.taskTypeCounts[0];
    const res = await api.post('/api/v2/tasks', {
        data: {
            TaskName: name, TaskKey: '--', AssigneeUserId: assigneeIds.map(String), watchers: [owner.userId], DueDate: '', dueDateDeadLine: [],
            TaskType: taskType.value, TaskTypeKey: taskType.key, ParentTaskId: '', ProjectID: project._id, CompanyId: api.companyId,
            status: { text: status.name, key: status.key, value: status.value, type: status.type }, statusKey: status.key, statusType: status.type,
            isParentTask: true, Task_Leader: owner.userId, sprintArray: { id: sprint._id, name: sprint.name, value: sprint.name },
            Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: sprint._id,
        },
        user: { id: owner.userId, Employee_Name: nameOf(owner), companyOwnerId: owner.userId },
        projectData: { _id: project._id, CompanyId: api.companyId, lastTaskId: 0, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode },
        indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: status.key },
    });
    assertOk(res, `create task ${name}`);
    return { _id: String(res.body.id), name, sprintId: sprint._id };
}

async function seedPeople(baseURL) {
    const setup = createApiClient({ baseURL });
    const { data } = assertOk(await setup.post('/api/v2/setup/complete', { ...OWNER, password: PASSWORD, companyName: COMPANY, sampleData: false }), 'setup wizard');
    const companyId = String(data.companyId);
    const ownerSession = await login(baseURL, OWNER.email);
    const owner = { ...OWNER, role: 'owner', userId: String(data.userId), api: createApiClient({ baseURL, accessToken: ownerSession.accessToken, companyId }) };
    const members = [];
    for (const person of TEAM) {
        const made = await inviteMember({ baseURL, ownerApi: owner.api, companyId, ...person });
        const session = await login(baseURL, person.email);
        members.push({ ...person, ...made, api: createApiClient({ baseURL, accessToken: session.accessToken, companyId }) });
    }
    return { companyId, owner, members, people: [owner, ...members] };
}

async function seedProject(world) {
    const { owner, people, companyId } = world;
    const project = await createProject(owner.api, { name: 'Harbor & Co. website', code: 'HBR', assigneeIds: people.map((p) => p.userId), createdBy: owner.userId });
    const first = await firstSprint(owner.api, project._id);
    assertOk(await owner.api.patch(`/api/v1/sprint/${first._id}`, { type: 'editSprintName', sprintName: LISTS[0], projectId: project._id }), 'rename the first list');
    const lists = [{ _id: String(first._id), name: LISTS[0] }];
    for (const name of LISTS.slice(1)) lists.push(await createList(owner.api, { project, name, owner }));

    const today = new Date();
    today.setUTCHours(9, 0, 0, 0);
    const tasks = [];
    for (const [name, listAt, personAt, state, priority, startDay, length] of TASKS) {
        const person = people[personAt];
        const task = await createTask(owner.api, { project, name, owner, assigneeIds: [person.userId], sprint: lists[listAt] });
        const start = new Date(today.getTime() + startDay * DAY_MS);
        const due = new Date(start.getTime() + length * DAY_MS);
        const taskData = { _id: task._id, sprintId: task.sprintId, ProjectID: project._id };
        const projectData = { _id: project._id, CompanyId: companyId };
        assertOk(await owner.api.patch('/api/v2/tasks', { action: 'updateDates', taskData, projectData, firebaseObj: { startDate: start.toISOString(), DueDate: due.toISOString() } }), `dates of ${name}`);
        assertOk(await owner.api.patch('/api/v2/tasks', { action: 'updatePriority', taskData, projectData, firebaseObj: { Task_Priority: priority }, priorityObj: { taskId: task._id } }), `priority of ${name}`);
        const target = project.taskStatusData.find((x) => x.type === (state === 'done' ? 'close' : state === 'active' ? 'active' : 'default_active'));
        if (target.type !== 'default_active') {
            assertOk(await owner.api.patch('/api/v2/tasks', {
                action: 'updateStatus', task: { _id: task._id, sprintId: task.sprintId }, projectData: { _id: project._id },
                newStatus: { status: { key: target.key, text: target.name, type: target.type }, statusKey: target.key, statusType: target.type },
                prevStatus: { taskId: task._id },
            }), `status of ${name}`);
        }
        tasks.push({ ...task, person, startDay, length, state });
    }
    return { project, lists, tasks };
}

async function seedTime(world) {
    const { tasks, project, companyId, owner, people } = world;
    for (const [taskAt, personAt, daysAgo, start, minutes, note] of TIME) {
        const task = tasks[taskAt];
        const person = people[personAt];
        const [h, m] = start.split(':').map(Number);
        assertOk(await person.api.post('/api/v2/manualLogtime', {
            logTimeDate: dayStamp(daysAgo), description: note, startLogTime: start, endLogTime: clock(h * 60 + m + minutes), timeDuration: clock(minutes),
            ticketId: task._id, taskId: task._id, projectId: project._id, companyId, userId: person.userId, isEdit: false, timeSheetId: '', previousLoggedTime: '',
            dateFormat: 'YYYY-MM-DD', taskName: task.name, projectName: project.ProjectName, sprintId: task.sprintId, folderId: '',
            companyOwnerId: owner.userId, timeZone: 'UTC', billable: true,
        }), `time on ${task.name}`);
    }
}

/* [task, author, text with @mentions as [person index]] */
const COMMENTS = [
    [9, 3, 'First cut of the plan table is on staging. {2} can you wire the checkout links?'],
    [9, 2, 'On it {3}. Links go live once the payment page is signed off.'],
    [8, 2, 'About 40 of 62 posts moved. {1} the old author pages need a decision.'],
    [5, 4, 'Spacing scale is done; colour tokens next. {0} want a quick review tomorrow?'],
];

async function seedComments(world) {
    const { tasks, people, project } = world;
    for (const [taskAt, authorAt, text] of COMMENTS) {
        const task = tasks[taskAt];
        const author = people[authorAt];
        const message = text.replace(/\{(\d)\}/g, (all, at) => `@[${nameOf(people[Number(at)])}](${people[Number(at)].userId})`);
        assertOk(await author.api.post('/api/v1/comments', {
            data: {
                message, type: 'text', taskId: task._id, projectId: project._id, sprintId: task.sprintId, userId: author.userId, project: false,
                hasReply: false, isDeleted: false, mediaName: '', mediaSize: 0, mediaURL: '', reply_userId: '', reply_type: '', reply_message: '', reply_id: '',
            },
        }), `comment on ${task.name}`);
    }
}

async function seedDashboard(api) {
    const dashboard = assertOk(await api.post('/api/v1/dashboards', { title: 'Delivery overview', visibility: 'private' }), 'create the dashboard').data;
    const layout = [
        ['TasksByStatusCard', 0, 0, 6, 9, { timerange: 5 }],
        ['DueSoonCard', 6, 0, 6, 9, {}],
        ['FreeResourcesCard', 0, 9, 6, 9, {}],
        ['ProjectPulseCard', 6, 9, 6, 9, { timerange: 1 }],
    ];
    const cards = layout.map(([componentId, x, y, w, h, cardData], at) => ({
        componentId, cardId: '', uid: String(100000000 + at), config: { cardData, filterData: [], position: { x, y, w, h } },
    }));
    assertOk(await api.put(`/api/v1/dashboards/${dashboard._id}/cards`, { cards }), 'fill the dashboard');
    return String(dashboard._id);
}

async function makeAgent(api, { project, name, description }) {
    const res = await api.post('/api/v2/agents', {
        name, description, autonomy: 1, spendCapUsd: 5, projectIds: [String(project._id)], skills: [], allowedActions: ['task.comment'],
    });
    return assertOk(res, `create agent ${name}`).data;
}

async function seedAgents(world) {
    const agents = [];
    for (const [name, description] of AGENTS) agents.push(await makeAgent(world.owner.api, { project: world.project, name, description }));
    return agents;
}

const AVATAR_COLOURS = ['#6473E8', '#E0617A', '#2E9E6B', '#D9822B', '#3B82F6', '#9B59B6'];

/* The app draws a stock silhouette for anyone without a photo, so each person gets an initials picture instead. */
const initialsAvatar = (person, at) => {
    const letters = `${person.firstName[0]}${person.lastName[0]}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${AVATAR_COLOURS[at % AVATAR_COLOURS.length]}"/>`
        + `<text x="48" y="50" dy=".35em" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="38" font-weight="600" fill="#fff">${letters}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

async function seedAvatars(people) {
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    try {
        const users = client.db('global').collection('users');
        for (const [at, person] of people.entries()) {
            const image = initialsAvatar(person, at);
            await users.updateOne({ _id: new ObjectId(person.userId) }, { $set: { Employee_profileImage: image, Employee_profileImageURL: image } });
        }
    } finally {
        await client.close();
    }
}

async function seed(baseURL) {
    const world = await seedPeople(baseURL);
    await seedAvatars(world.people);
    assertOk(await world.owner.api.put('/api/v2/users/onboarding', { dismissed: true }), 'dismiss the setup checklist');
    world.baseURL = baseURL;
    Object.assign(world, await seedProject(world));
    await seedTime(world);
    await seedComments(world);
    world.dashboardId = await seedDashboard(world.owner.api);
    world.agents = await seedAgents(world);
    return world;
}

module.exports = { seed, makeAgent, PASSWORD, COMPANY, OWNER, TEAM, nameOf, DAY_MS };
