/* eslint-env browser */
/* Builds the README screenshots: boots the e2e harness against a disposable MongoDB, fills a demo
 * workspace with made-up data, and captures each screen at 1440x900 @2x in light and dark.
 * Usage: npm run readme:screenshots [-- --only home,board] [-- --out <dir>] [-- --mongo-url <url>] [-- --chromium <path>] */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('@playwright/test');


const { resetDatabase, listCompanyIds } = require('../e2e/support/database');
const { startServer } = require('../e2e/support/server');
const { createApiClient } = require('../e2e/support/api');
const { PASSWORD, assertOk, login, inviteMember, createProject, createList, createTask, firstSprint } = require('../e2e/support/fixtures');
const { signInThroughForm } = require('../e2e/support/pages');
const { SCREENS } = require('./atlas-manifest');
const { resolveRoute } = require('./atlas/routes');
const { settle, SHELL, SHELL_TIMEOUT_MS } = require('./atlas/browser');

const OUT_DEFAULT = path.join(__dirname, '..', '.gitbook', 'assets', 'screenshots');
const MAX_BYTES = 400 * 1024;
const VIEWPORT = { width: 1440, height: 900 };
const THEMES = ['light', 'dark'];
const DAY_MS = 24 * 60 * 60 * 1000;

const COMPANY = 'Northwind Studio';
const OWNER = { firstName: 'Maya', lastName: 'Chen', email: 'maya.chen@northwind.example' };
const TEAM = [
    { role: 'admin', firstName: 'Priya', lastName: 'Nair', email: 'priya.nair@northwind.example' },
    { role: 'member', firstName: 'Diego', lastName: 'Alvarez', email: 'diego.alvarez@northwind.example' },
    { role: 'member', firstName: 'Sofia', lastName: 'Rossi', email: 'sofia.rossi@northwind.example' },
    { role: 'member', firstName: 'Kenji', lastName: 'Tanaka', email: 'kenji.tanaka@northwind.example' },
];

const SPRINTS = ['Discovery', 'Design', 'Build', 'Launch'];

/* [name, sprint, assignee index (0 = Maya), status, priority, start day, length in days] relative to today. */
const TASKS = [
    ['Audit existing site content', 0, 1, 'done', 'MEDIUM', -26, 5],
    ['Interview five customers', 0, 2, 'done', 'HIGH', -24, 6],
    ['Define success metrics', 0, 0, 'done', 'HIGH', -20, 3],
    ['Draft information architecture', 1, 1, 'done', 'HIGH', -17, 5],
    ['Design homepage wireframes', 1, 3, 'done', 'MEDIUM', -13, 6],
    ['Build design system tokens', 1, 3, 'active', 'HIGH', -8, 9],
    ['Set up staging environment', 2, 4, 'done', 'MEDIUM', -9, 4],
    ['Implement navigation and footer', 2, 4, 'active', 'HIGH', -4, 8],
    ['Migrate blog posts', 2, 2, 'active', 'MEDIUM', -2, 10],
    ['Build pricing page', 2, 1, 'active', 'URGENT', 0, 7],
    ['Accessibility pass on templates', 2, 3, 'todo', 'MEDIUM', 5, 6],
    ['Set up redirects for old URLs', 3, 4, 'todo', 'HIGH', 9, 4],
    ['Write launch announcement', 3, 0, 'todo', 'LOW', 12, 3],
    ['Load test the checkout flow', 3, 2, 'todo', 'MEDIUM', 14, 4],
    ['Go-live checklist and rollback plan', 3, 0, 'todo', 'URGENT', 18, 3],
];

const h = (text, level) => ({ type: 'header', data: { text, level } });
const para = (text) => ({ type: 'paragraph', data: { text } });
const bullets = (items) => ({ type: 'list', data: { style: 'unordered', items: items.map((content) => ({ content, items: [] })) } });

const DOC_BLOCKS = [
    h('Launch plan', 1),
    para('The website relaunch goes live on the first Tuesday after the pricing page is signed off. This page is the single source of truth for what ships, who owns it and how we roll back.'),
    h('Scope', 2),
    bullets(['New navigation, footer and homepage built on the shared design tokens', 'Pricing page with the three plans and a comparison table', 'All blog posts migrated, with redirects from the old URLs']),
    h('Owners', 2),
    bullets(['<b>Content and launch announcement:</b> Maya Chen', '<b>Design system and templates:</b> Kenji Tanaka', '<b>Build and migration:</b> Diego Alvarez and Sofia Rossi', '<b>Go-live and rollback:</b> Priya Nair']),
    h('Rollback', 2),
    para('If the error rate stays above one percent for ten minutes after go-live, Priya flips the DNS record back to the old site. The old site stays read-only for two weeks.'),
];

const argValue = (flag) => {
    const at = process.argv.indexOf(flag);
    return at === -1 ? null : process.argv[at + 1];
};

const MONGO_URL = argValue('--mongo-url') || 'mongodb://127.0.0.1:27018';
const LOOPBACK_URL = /^mongodb:\/\/(?:[^@/]*@)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/;
if (!LOOPBACK_URL.test(MONGO_URL)) {
    process.stderr.write(`Refusing ${MONGO_URL}: the script drops every database it finds, so it only runs against a MongoDB on this machine.\n`);
    process.exit(1);
}
Object.assign(process.env, { E2E_MONGODB_URL: MONGO_URL });

const log = (message) => process.stdout.write(`${message}\n`);

async function seed(baseURL) {
    const setup = createApiClient({ baseURL });
    const { data } = assertOk(await setup.post('/api/v2/setup/complete', { ...OWNER, password: PASSWORD, companyName: COMPANY, sampleData: false }), 'setup wizard');
    const companyId = String(data.companyId);
    const ownerSession = await login(baseURL, OWNER.email);
    const ownerApi = createApiClient({ baseURL, accessToken: ownerSession.accessToken, companyId });
    const owner = { ...OWNER, role: 'owner', userId: String(data.userId), session: ownerSession, api: ownerApi };

    const members = [];
    for (const person of TEAM) {
        const made = await inviteMember({ baseURL, ownerApi, companyId, ...person });
        const session = await login(baseURL, person.email);
        members.push({ ...person, ...made, session, api: createApiClient({ baseURL, accessToken: session.accessToken, companyId }) });
    }
    const people = [owner, ...members];

    const project = await createProject(ownerApi, {
        name: 'Website relaunch', code: 'WEB', assigneeIds: people.map((p) => p.userId), createdBy: owner.userId,
    });
    const first = await firstSprint(ownerApi, project._id);
    assertOk(await ownerApi.patch(`/api/v1/sprint/${first._id}`, { type: 'editSprintName', sprintName: SPRINTS[0], projectId: project._id }), 'rename the first list');
    const sprints = [{ _id: String(first._id), name: SPRINTS[0] }];
    for (const name of SPRINTS.slice(1)) sprints.push(await createList(ownerApi, { project, name, user: owner }));

    const todo = project.taskStatusData.find((x) => x.type === 'default_active');
    const created = [];
    const today = new Date();
    today.setUTCHours(9, 0, 0, 0);
    for (const [name, sprintAt, personAt, state, priority, startDay, length] of TASKS) {
        const person = people[personAt];
        const task = await createTask(ownerApi, {
            project, name, user: owner, companyOwnerId: owner.userId, assigneeIds: [person.userId],
            sprint: { _id: sprints[sprintAt]._id, name: sprints[sprintAt].name },
        });
        const start = new Date(today.getTime() + startDay * DAY_MS);
        const due = new Date(start.getTime() + length * DAY_MS);
        const taskData = { _id: task._id, sprintId: task.sprintId, ProjectID: project._id };
        const projectData = { _id: project._id, CompanyId: companyId };
        assertOk(await ownerApi.patch('/api/v2/tasks', { action: 'updateDates', taskData, projectData, firebaseObj: { startDate: start.toISOString(), DueDate: due.toISOString() } }), `dates of ${name}`);
        assertOk(await ownerApi.patch('/api/v2/tasks', { action: 'updatePriority', taskData, projectData, firebaseObj: { Task_Priority: priority }, priorityObj: { taskId: task._id } }), `priority of ${name}`);
        const target = project.taskStatusData.find((x) => x.type === (state === 'done' ? 'close' : state === 'active' ? 'active' : 'default_active'));
        if (target.key !== todo.key) {
            assertOk(await ownerApi.patch('/api/v2/tasks', {
                action: 'updateStatus', task: { _id: task._id, sprintId: task.sprintId }, projectData: { _id: project._id },
                newStatus: { status: { key: target.key, text: target.name, type: target.type }, statusKey: target.key, statusType: target.type },
                prevStatus: { taskId: task._id },
            }), `status of ${name}`);
        }
        created.push({ ...task, name, person, startDay, length, state });
    }
    return { companyId, owner, members, people, project, sprints, tasks: created };
}

async function logTime(world) {
    const { tasks, project, companyId, owner } = world;
    const stamp = (daysAgo) => {
        const day = new Date(Date.now() - daysAgo * DAY_MS);
        return day.toISOString().slice(0, 10);
    };
    const entries = [
        [0, 8, '09:00', 150, 'Reviewed the sitemap'], [1, 8, '13:00', 120, 'Customer call notes'], [2, 7, '09:30', 180, 'Metric definitions'],
        [3, 7, '14:00', 120, 'Page hierarchy'], [4, 6, '09:00', 240, 'Homepage layouts'], [5, 6, '13:30', 180, 'Token audit'],
        [5, 5, '09:00', 210, 'Spacing scale'], [6, 5, '14:00', 150, 'Staging pipeline'], [7, 4, '09:30', 270, 'Navigation component'],
        [8, 4, '14:00', 150, 'Blog import script'], [7, 1, '09:00', 180, 'Footer links'], [9, 1, '13:00', 195, 'Pricing table'],
        [8, 0, '09:00', 120, 'Post cleanup'], [9, 0, '11:00', 150, 'Plan comparison copy'],
    ];
    const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    for (const [taskAt, daysAgo, start, minutes, note] of entries) {
        const task = tasks[taskAt];
        const person = owner;
        const [h, m] = start.split(':').map(Number);
        const begin = h * 60 + m;
        assertOk(await person.api.post('/api/v2/manualLogtime', {
            logTimeDate: stamp(daysAgo), description: note, startLogTime: start, endLogTime: clock(begin + minutes), timeDuration: clock(minutes),
            ticketId: task._id, taskId: task._id, projectId: project._id, companyId, userId: person.userId, isEdit: false, timeSheetId: '', previousLoggedTime: '',
            dateFormat: 'YYYY-MM-DD', taskName: task.name, projectName: project.ProjectName, sprintId: task.sprintId, folderId: '',
            companyOwnerId: owner.userId, timeZone: 'UTC', billable: true,
        }), `time on ${task.name}`);
    }
}

/* Spreads each open task's hours over its working days, so the workload grid has planned time to show. */
async function planHours(world) {
    const { tasks, project, owner } = world;
    const today = new Date();
    today.setUTCHours(9, 0, 0, 0);
    const loads = [180, 240, 120, 300];
    for (const [at, task] of tasks.entries()) {
        if (task.state === 'done') continue;
        for (let day = Math.max(task.startDay, -3); day < task.startDay + task.length && day < 14; day += 1) {
            const date = new Date(today.getTime() + day * DAY_MS);
            if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
            assertOk(await owner.api.put('/api/v1/estimatedTime', {
                userId: task.person.userId, taskId: String(task._id), projectId: String(project._id), date: date.toISOString(), minutes: loads[(at + day + 8) % loads.length],
            }), `plan hours on ${task.name}`);
        }
    }
}

async function seedScreens(world) {
    const { owner, project, tasks } = world;
    const page = assertOk(await owner.api.post('/api/v2/pages', { title: 'Launch plan', projectId: project._id, contentBlocks: DOC_BLOCKS.slice(1) }), 'create the doc').data;
    await seedAgents(world);
    await planHours(world);
    const dashboard = assertOk(await owner.api.post('/api/v1/dashboards', { title: 'Delivery overview', visibility: 'private' }), 'create the dashboard').data;
    await fillDashboard(owner.api, dashboard._id);
    return { pageId: String(page._id), dashboardId: String(dashboard._id), taskId: tasks[9]._id, sprintId: tasks[9].sprintId };
}

const AGENTS = [
    ['Status Reporter', 'Writes a Friday summary of what moved, what slipped and what is blocked.'],
    ['Priorities Manager', 'Flags tasks that are overdue or at risk and suggests a new order.'],
    ['Work Breakdown', 'Splits large tasks into subtasks a person can approve.'],
];

const PROPOSALS = [
    [0, 9, 'Post the weekly status summary on Build pricing page', 'Three tasks in Build moved this week and one is due in a week.'],
    [1, 8, 'Raise the priority of Migrate blog posts to High', 'It blocks the redirects task and is due in twelve days.'],
    [2, 10, 'Add four subtasks to Accessibility pass on templates', 'The task covers every template and has no breakdown yet.'],
    [1, 11, 'Comment on Set up redirects for old URLs: list of top 50 URLs', 'Redirects are easier to check against the most visited pages.'],
];

async function seedAgents(world) {
    const { createAgent, openProposals } = require('../e2e/support/proposals');
    const agents = [];
    for (const [name] of AGENTS) agents.push(await createAgent(world.owner.api, { project: world.project, name }));
    const proposals = await openProposals({ companyId: world.companyId });
    for (const [agentAt, taskAt, what, why] of PROPOSALS) {
        await proposals.seed({ agent: agents[agentAt], project: world.project, task: world.tasks[taskAt], what, why });
    }
}

async function fillDashboard(api, dashboardId) {
    const layout = [
        ['TasksByStatusCard', 0, 0, 6, 9, { timerange: 5 }],
        ['FreeResourcesCard', 6, 0, 6, 9, {}],
        ['DueSoonCard', 0, 9, 6, 9, {}],
        ['ProjectPulseCard', 6, 9, 6, 9, { timerange: 1 }],
    ];
    const cards = layout.map(([componentId, x, y, w, h, cardData], at) => ({
        componentId, cardId: '', uid: String(100000000 + at), config: { cardData, filterData: [], position: { x, y, w, h } },
    }));
    assertOk(await api.put(`/api/v1/dashboards/${dashboardId}/cards`, { cards }), 'fill the dashboard');
}

const click = async (page, locator) => {
    const target = locator.first();
    if (await target.isVisible().catch(() => false)) await target.click().catch(() => {});
};

const PREP = {
    home: async (page) => {
        await click(page, page.getByRole('button', { name: 'Dismiss', exact: true }));
        await click(page, page.getByRole('button', { name: 'Close', exact: true }));
        await page.waitForTimeout(800);
    },
    list: async (page) => {
        await click(page, page.locator('main, .ah-app').getByText('Build', { exact: true }).last());
        await page.waitForTimeout(1500);
    },
    board: async (page) => {
        await click(page, page.locator('aside, nav').getByText('Build', { exact: true }));
        await page.waitForTimeout(1500);
        await click(page, page.locator('[role=tab], button, a').filter({ hasText: /^Board$/ }));
        await page.waitForTimeout(2500);
    },
    'ai-inbox': async (page) => {
        await click(page, page.getByText('Raise the priority of Migrate blog posts to High'));
        await page.waitForTimeout(1500);
    },
    calendar: async (page, world) => {
        await page.goto(`/#/${world.companyId}/project/${world.project._id}/s/${world.sprints[2]._id}?tab=Calendar`);
        await page.locator(SHELL).waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
        await settle(page);
        await page.waitForTimeout(2500);
    },
    'ai-ask': async (page, world) => {
        assertOk(await world.owner.api.put('/api/v2/instance/settings', LOCAL_MODEL), 'point Ask at a local model');
        await page.reload();
        await page.locator(SHELL).waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
        await settle(page);
        await page.waitForTimeout(2000);
        await page.locator('#land-q').fill('Which tasks in the Build list are at risk of missing the launch date, and who owns them?');
        await page.locator('#land-q').blur();
        await page.waitForTimeout(800);
    },
    'time-tracking': async (page) => {
        await click(page, page.getByRole('button', { name: /previous/i }));
        await page.waitForTimeout(2000);
    },
};

/* Ask only enables its question box once a model is configured; a local OpenAI-compatible
 * endpoint on the discard port needs no key, and the question is typed but never sent. */
const LOCAL_MODEL = { LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_COMPATIBLE_MODEL: 'llama3.1:8b' };
const NO_MODEL = { LLM_PROVIDER: 'openai', OPENAI_COMPATIBLE_BASE_URL: '', OPENAI_COMPATIBLE_MODEL: '' };

const AFTER = {
    'ai-ask': async (page, world) => {
        assertOk(await world.owner.api.put('/api/v2/instance/settings', NO_MODEL), 'clear the local model');
    },
};

async function capture(browser, world, seeded, out, only) {
    const { companyId, owner } = world;
    const params = { cid: companyId, projectId: world.project._id, sprintId: seeded.sprintId, taskId: seeded.taskId, pageId: seeded.pageId, dashboardId: seeded.dashboardId };
    const shots = [
        ['home', 'home'], ['list', 'project-list'], ['board', 'project-board'], ['gantt', 'project-gantt'], ['task-detail', 'task-detail'],
        ['dashboard', 'dashboard'], ['time-tracking', 'timesheets'], ['docs', 'doc'], ['ai-inbox', 'ai-inbox'], ['ai-agents', 'ai-agents'],
        ['calendar', 'project-calendar'], ['workload', 'timesheet-workload'], ['settings', 'settings-general'], ['ai-ask', 'ai-ask'],
    ].filter(([name]) => !only || only.includes(name));
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-shots-'));
    const written = [];
    for (const theme of THEMES) {
        const context = await browser.newContext({ baseURL: world.baseURL, viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', colorScheme: theme });
        await context.addInitScript((value) => {
            localStorage.setItem('ah.theme', value);
            for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
            sessionStorage.setItem('ah.gs.dismissed', '1');
        }, theme);
        const page = await context.newPage();
        await signInThroughForm(page, { email: owner.email, password: PASSWORD, companyId });
        for (const [name, screenName] of shots) {
            const screen = SCREENS.find((s) => s.name === screenName);
            const { path: route, missing } = resolveRoute(screen.route, params);
            if (!route) throw new Error(`${screenName} needs ${missing.join(', ')}`);
            await page.goto(`/#${route}`);
            await page.locator(SHELL).waitFor({ state: 'visible', timeout: SHELL_TIMEOUT_MS });
            const note = await settle(page);
            await page.waitForTimeout(2500);
            await PREP[name]?.(page, world);
            const file = path.join(raw, `${name}-${theme}.png`);
            await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
            await AFTER[name]?.(page, world);
            written.push({ name, theme, file, note: note.note || '' });
            log(`captured ${name}-${theme}${note.note ? ` (${note.note})` : ''}`);
        }
        await context.close();
    }
    fs.mkdirSync(out, { recursive: true });
    const sizes = [];
    for (const shot of written) {
        const target = path.join(out, `${shot.name}-${shot.theme}.png`);
        const bytes = await compress(shot.file, target);
        sizes.push(`${path.basename(target)} ${(bytes / 1024).toFixed(0)} KB`);
    }
    log(sizes.join('\n'));
    return { raw, written };
}

/* Palette PNG with the fewest colours that still fit the budget; UI screenshots have flat areas, so this rarely goes below 128. */
async function compress(source, target) {
    let best = null;
    for (const colours of [256, 192, 128, 96, 64]) {
        const buffer = await sharp(source).png({ palette: true, colours, effort: 10, compressionLevel: 9, dither: 0.6 }).toBuffer();
        best = buffer;
        if (buffer.length <= MAX_BYTES) break;
    }
    if (best.length > MAX_BYTES) throw new Error(`${path.basename(target)} is ${best.length} bytes after compression, over the ${MAX_BYTES} budget`);
    fs.writeFileSync(target, best);
    return best.length;
}

async function main() {
    const out = path.resolve(argValue('--out') || OUT_DEFAULT);
    const only = argValue('--only') ? argValue('--only').split(',') : null;
    const mongoUrl = MONGO_URL;
    await resetDatabase(mongoUrl);
    const logFile = path.join(os.tmpdir(), 'readme-screenshots-server.log');
    const server = await startServer({ mongoUrl, logFile });
    const browser = await chromium.launch({ executablePath: argValue('--chromium') || undefined });
    try {
        const world = await seed(server.baseURL);
        world.baseURL = server.baseURL;
        await logTime(world);
        const seeded = await seedScreens(world);
        const { raw } = await capture(browser, world, seeded, out, only);
        log(`raw captures kept in ${raw}`);
    } finally {
        await browser.close();
        const companyIds = await listCompanyIds(mongoUrl).catch(() => []);
        await server.stop({ companyIds });
    }
}

main().then(() => process.exit(0), (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
