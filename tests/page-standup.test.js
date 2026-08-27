const fs = require('fs');
const path = require('path');
const { AI_ACTIONS, isAiAction } = require('../Modules/Pages/helpers/pageContent');
const { composePage } = require('../Modules/Pages/helpers/pageAi');
const { selectCitations } = require('../Modules/Pages/helpers/pageWorkspaceAsk');
const {
    STANDUP_SYSTEM,
    STANDUP_MAX_TOKENS,
    standupWindow,
    permissionScope,
    filterTasksForStandup,
    groupStandupActivity,
    shapeStandupResult,
    buildStandupPrompt,
    summarizeStandup,
} = require('../Modules/Pages/helpers/pageStandup');

const PROJ = '64b7f0c2a1b2c3d4e5f60711';
const OTHER = '64b7f0c2a1b2c3d4e5f60722';
const NOW = new Date('2026-08-27T12:00:00.000Z').getTime();

function hoursAgo(n) {
    return new Date(NOW - n * 3600000);
}

function daysAgo(n) {
    return new Date(NOW - n * 86400000);
}

const TASKS = [
    {
        _id: 't1', TaskKey: 'SMOKE-1', TaskName: 'Ship the invite', ProjectID: PROJ,
        statusType: 'close', status: { text: 'Complete' }, createdAt: daysAgo(20), updatedAt: hoursAgo(2),
    },
    {
        _id: 't2', TaskKey: 'SMOKE-2', TaskName: 'Write the brief', ProjectID: PROJ,
        statusType: 'active', status: { text: 'In Progress' }, createdAt: daysAgo(10), updatedAt: hoursAgo(4),
    },
    {
        _id: 't3', TaskKey: 'SMOKE-3', TaskName: 'Waiting on legal', ProjectID: PROJ,
        statusType: 'active', status: { text: 'Blocked' }, relations: [{ type: 'blocked_by', taskId: 't4' }],
        createdAt: daysAgo(12), updatedAt: daysAgo(30),
    },
    {
        _id: 't4', TaskKey: 'SMOKE-4', TaskName: 'Legal review', ProjectID: PROJ,
        statusType: 'default_active', status: { text: 'To Do' }, createdAt: hoursAgo(6), updatedAt: hoursAgo(6),
    },
    {
        _id: 't5', TaskKey: 'SMOKE-5', TaskName: 'Spike the kiln shell', ProjectID: PROJ,
        statusType: 'active', status: { text: 'In Progress' }, createdAt: daysAgo(3), updatedAt: daysAgo(3),
    },
    {
        _id: 'ghost', TaskKey: 'OTHER-1', TaskName: 'Other company work', ProjectID: OTHER,
        statusType: 'close', createdAt: hoursAgo(1), updatedAt: hoursAgo(1),
    },
];

const COMMENTS = [
    { taskId: 't1', message: 'Shipped to staging.', createdAt: hoursAgo(1), projectId: PROJ },
    { taskId: 't5', message: 'Three-day-old note.', createdAt: daysAgo(3), projectId: PROJ },
    { taskId: 'ghost', message: 'Should not leak.', createdAt: hoursAgo(1), projectId: OTHER },
];

function groupsOf(windowName) {
    const window = standupWindow(windowName, NOW);
    return groupStandupActivity({
        tasks: TASKS,
        comments: COMMENTS,
        since: window.since,
        until: window.until,
        projectId: PROJ,
    });
}

function groupMap(grouped) {
    const map = {};
    for (const group of grouped.groups) map[group.key] = group.items.map((item) => item.taskId);
    return map;
}

describe('PAGES - standup / project update', () => {

    test('standup is a compose action and does not replace the page', () => {
        expect(AI_ACTIONS).toEqual(expect.arrayContaining(['transcript', 'standup']));
        expect(isAiAction('standup')).toBe(true);
        expect(STANDUP_SYSTEM).toMatch(/Do not rewrite or replace any page/);
        expect(STANDUP_MAX_TOKENS).toBe(4096);
    });

    test('project is required before the model runs', async () => {
        const result = await composePage({
            action: 'standup',
            title: 'Local Smoke',
            window: '24h',
            tasks: TASKS,
            comments: COMMENTS,
            now: NOW,
        });
        expect(result.status).toBe(false);
        expect(result.reason).toMatch(/project/i);
    });

    test('window filter: 24h is default and 7d includes older in-range work', () => {
        const day = standupWindow(undefined, NOW);
        expect(day.key).toBe('24h');
        expect(day.until.getTime() - day.since.getTime()).toBe(24 * 60 * 60 * 1000);

        const week = standupWindow('7d', NOW);
        expect(week.key).toBe('7d');
        expect(week.until.getTime() - week.since.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

        const dayMap = groupMap(groupsOf('24h'));
        expect(dayMap.completed).toEqual(['t1']);
        expect(dayMap.inProgress).toEqual(['t2', 't4']);
        expect(dayMap.blocked).toEqual(['t3']);
        expect(dayMap.created).toEqual(['t4']);
        expect(dayMap.comments).toEqual(['t1']);
        expect(dayMap.inProgress).not.toContain('t5');
        expect(dayMap.comments).not.toContain('t5');

        const weekMap = groupMap(groupsOf('week'));
        expect(weekMap.created).toEqual(['t4', 't5']);
        expect(weekMap.inProgress).toEqual(['t2', 't4', 't5']);
        expect(weekMap.comments).toEqual(['t1', 't5']);
        expect(weekMap.completed).toEqual(['t1']);
    });

    test('permission pack keeps only the selected project and drops other-project tasks', () => {
        expect(permissionScope({ projectId: '' }).allowed).toBe(false);
        expect(permissionScope({
            projectId: PROJ,
            visibleProjectIds: [OTHER],
            restrictProjects: true,
        }).allowed).toBe(false);
        expect(permissionScope({
            projectId: PROJ,
            visibleProjectIds: [PROJ],
            restrictProjects: true,
        }).allowed).toBe(true);
        expect(permissionScope({
            projectId: PROJ,
            visibleProjectIds: [OTHER],
            restrictProjects: false,
        }).allowed).toBe(true);

        const scoped = filterTasksForStandup(TASKS, PROJ);
        expect(scoped.map((row) => row._id)).toEqual(['t1', 't2', 't3', 't4', 't5']);
        expect(scoped.some((row) => row._id === 'ghost')).toBe(false);

        const grouped = groupsOf('24h');
        const ids = grouped.citations.map((row) => row.id);
        expect(ids).toEqual(expect.arrayContaining(['t1', 't2', 't3', 't4']));
        expect(ids).not.toContain('ghost');
        expect(grouped.groups.some((group) => group.items.some((item) => item.taskId === 'ghost'))).toBe(false);
    });

    test('invented ids are dropped from citations and grouped items', () => {
        const grouped = groupsOf('24h');
        const shaped = shapeStandupResult({
            markdown: 'SMOKE-1 landed. Invented AH-999 did not.',
            groups: [
                ...grouped.groups,
                { key: 'inProgress', label: 'In progress', items: [{ title: 'Ghost work', taskId: 'invented' }] },
            ],
            packCitations: grouped.citations,
            usedHints: [{ type: 'task', id: 'invented' }, { type: 'task', id: 't1' }],
            window: '24h',
        });
        expect(shaped.status).toBe(true);
        expect(shaped.data.apply).toBe(false);
        expect(shaped.data.action).toBe('standup');
        expect(shaped.data.window).toBe('24h');
        expect(shaped.data.groups.some((group) => group.items.some((item) => item.taskId === 'invented'))).toBe(false);
        expect(shaped.data.citations.map((row) => row.id)).toContain('t1');
        expect(shaped.data.citations.some((row) => row.id === 'invented' || row.id === 'ghost')).toBe(false);
        expect(selectCitations(grouped.citations, [{ type: 'task', id: 'nope' }], { fallback: false })).toEqual([]);
    });

    test('standup briefing cites real tasks and does not apply the page', async () => {
        const result = await summarizeStandup({
            title: 'Local Smoke',
            window: '24h',
            projectId: PROJ,
            tasks: TASKS,
            comments: COMMENTS,
            now: NOW,
            isAiConfigured: () => false,
        });
        expect(result.status).toBe(true);
        expect(result.data.apply).toBe(false);
        expect(result.data.markdown).toMatch(/SMOKE-1/);
        expect(result.data.markdown).toMatch(/SMOKE-2/);
        expect(result.data.citations.some((row) => /SMOKE-1/.test(row.title))).toBe(true);
        expect(result.data.groups.find((group) => group.key === 'comments').items[0].notes).toMatch(/staging/i);
    });

    test('standup prompt carries grouped activity and says not to replace the page', () => {
        const grouped = groupsOf('24h');
        const { formatStandupPack } = require('../Modules/Pages/helpers/pageStandup');
        const prompt = buildStandupPrompt({
            title: 'Local Smoke',
            window: standupWindow('24h', NOW),
            packText: formatStandupPack({ groups: grouped.groups }),
        });
        expect(prompt).toContain('Local Smoke');
        expect(prompt).toContain('last 24 hours');
        expect(prompt).toContain('[task:t1]');
        expect(prompt).toContain('SMOKE-1');
        expect(STANDUP_SYSTEM).toMatch(/Do not rewrite or replace any page/);
    });

    test('compose rail hides standup until a project is selected and does not apply the page', () => {
        const rail = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PageComposeRail.vue'), 'utf8');
        const panel = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PagesPanel.vue'), 'utf8');
        const locale = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        const provider = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Pages', 'helpers', 'pageAi.js'), 'utf8');
        const controller = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Pages', 'controller.js'), 'utf8');

        expect(rail).toContain("key: 'standup'");
        expect(rail).toContain("item.key !== 'standup'");
        expect(rail).toContain('props.projectId');
        expect(rail).toContain("windowKey === item.key");
        expect(rail).toContain("action === 'standup'");
        expect(rail).toContain("payload.apply === false");
        expect(rail).toContain("action.value === 'standup'");
        expect(rail).toContain('pcr__group');
        expect(rail).toContain("emit('apply'");
        expect(rail).toContain('pages_standup_need_project');
        expect(panel).toContain(':project-id="taskProjectId"');
        expect(locale).toContain('pages_compose_standup');
        expect(locale).toContain('pages_standup_24h');
        expect(locale).toContain('pages_standup_7d');
        expect(provider).toContain('summarizeStandup');
        expect(controller).toContain('gatherStandupContext');
        expect(controller).toContain("resolvedAction === 'standup'");
        expect(controller).toContain('A project is required.');
    });
});
