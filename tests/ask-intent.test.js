const { readIntent, dueWindow, zoneFor, RULES } = require('../Modules/AI/askIntent');

const ME = '6f0000000000000000000001';
const PRIYA = '6f0000000000000000000002';
const SMOKE = '6f0000000000000000000a01';
const PLATFORM = '6f0000000000000000000a02';
const SPRINT_4 = '6f0000000000000000000d04';
const SPRINT_5 = '6f0000000000000000000d05';

const STATUSES = [
    { key: 1, name: 'To Do', type: 'default_active' },
    { key: 3, name: 'In Progress', type: 'active' },
    { key: 4, name: 'In Review', type: 'active' },
    { key: 2, name: 'Done', type: 'done' },
];

const context = {
    selfId: ME,
    projects: [
        { id: SMOKE, name: 'Local Smoke', code: 'SMOKE', statuses: STATUSES },
        { id: PLATFORM, name: 'AlianHub Platform', code: 'AP', statuses: STATUSES.filter((s) => s.name !== 'In Review') },
    ],
    members: [
        { id: ME, name: 'Mevil Bhojani', first: 'Mevil', last: 'Bhojani' },
        { id: PRIYA, name: 'Priya Shah', first: 'Priya', last: 'Shah' },
    ],
    sprints: [
        { id: SPRINT_4, name: 'Sprint 4', projectId: SMOKE, active: false },
        { id: SPRINT_5, name: 'Sprint 5', projectId: SMOKE, active: true },
    ],
};

const read = (question) => readIntent(question, context);

describe('askIntent reads a project from the question', () => {
    it('matches a visible project by name, whatever the case', () => {
        const intent = read('Which tasks in local smoke are overdue?');
        expect(intent.projectIds).toEqual([SMOKE]);
        expect(intent.projects).toEqual([{ id: SMOKE, name: 'Local Smoke' }]);
    });

    it('matches a project by its task-key prefix', () => {
        expect(read('What is overdue in SMOKE?').projectIds).toEqual([SMOKE]);
        expect(read('what is overdue in smoke?').projectIds).toEqual([SMOKE]);
    });

    it('matches a short prefix only when it is written in capitals', () => {
        expect(read('Open tasks in AP').projectIds).toEqual([PLATFORM]);
        expect(read('open tasks in ap').projectIds).toEqual([]);
    });

    it('reads a full task key as a named task, not a project filter', () => {
        const intent = read('Is SMOKE-12 done?');
        expect(intent.projectIds).toEqual([]);
        expect(intent.taskKeys).toEqual(['SMOKE-12']);
        expect(intent.filtered).toBe(false);
    });

    it('treats a project the asker cannot see exactly like one that does not exist', () => {
        const hidden = read('Which tasks in Secret Plans are overdue?');
        const missing = read('Which tasks in Nothing Here are overdue?');
        expect(hidden.projectIds).toEqual([]);
        expect(hidden).toEqual(missing);
    });

    it('keeps a project-only question as a narrowing, not a task list', () => {
        const intent = read('What is the Local Smoke project about?');
        expect(intent.projectIds).toEqual([SMOKE]);
        expect(intent.filtered).toBe(false);
    });

    it('lists a project\'s tasks when the question asks for tasks', () => {
        expect(read('List the tasks in Local Smoke').filtered).toBe(true);
    });
});

describe('askIntent reads a status', () => {
    it.each([
        ['What are my open tasks?', { type: 'open' }],
        ['Which tasks are not done yet?', { type: 'open' }],
        ['What still needs to be done in Local Smoke?', { type: 'open' }],
        ['Which tasks are completed?', { type: 'done' }],
        ['What got finished this week?', { type: 'done' }],
        ['What is closed?', { type: 'done' }],
    ])('%s', (question, status) => {
        expect(read(question).status).toEqual(status);
    });

    it('matches the company\'s own status names, per project', () => {
        expect(read('Which tasks are in review?').status).toEqual({ name: 'In Review', keys: [{ projectId: SMOKE, key: 4 }] });
    });

    it('prefers a status named "In Progress" to the generic type', () => {
        expect(read('What is in progress?').status).toEqual({
            name: 'In Progress',
            keys: [{ projectId: SMOKE, key: 3 }, { projectId: PLATFORM, key: 3 }],
        });
    });

    it('falls back to the status type when no status carries the name', () => {
        expect(readIntent('What is in progress?', { ...context, projects: [{ id: SMOKE, name: 'Local Smoke', code: 'SMOKE', statuses: [] }] }).status).toEqual({ type: 'active' });
    });

    it('reads a done-type status name as the done group', () => {
        expect(read('Which tasks are done?').status).toEqual({ type: 'done' });
    });
});

describe('askIntent reads an assignee', () => {
    it.each([
        'What are my tasks?',
        'Which tasks are assigned to me?',
        'What do I have overdue?',
        'Anything of mine due today?',
    ])('%s is the asker', (question) => {
        expect(read(question).assignee).toEqual({ self: true, id: ME });
    });

    it.each([
        'Show me the overdue tasks',
        'Tell me what is overdue in Local Smoke',
        'Give me the tasks due this week',
    ])('%s is not about the asker', (question) => {
        expect(read(question).assignee).toBeNull();
    });

    it('resolves a member by full name, whatever the case', () => {
        expect(read('tasks assigned to priya shah due this week').assignee).toEqual({ id: PRIYA, name: 'Priya Shah' });
    });

    it('resolves a member by a capitalised first name', () => {
        expect(read('What is Priya working on?').assignee).toEqual({ id: PRIYA, name: 'Priya Shah' });
        expect(read("Show Priya's overdue tasks").assignee).toEqual({ id: PRIYA, name: 'Priya Shah' });
    });

    it('does not resolve a name the asker cannot see', () => {
        expect(read('What is Rahul working on?').assignee).toBeNull();
    });

    it('reads unassigned work', () => {
        expect(read('Unassigned tasks in Local Smoke').assignee).toEqual({ none: true });
    });
});

describe('askIntent reads a due window', () => {
    it.each([
        ['Which tasks in Local Smoke are overdue?', 'overdue'],
        ['What is past due?', 'overdue'],
        ['Which tasks are running late?', 'overdue'],
        ['What is due today?', 'today'],
        ['What is due tomorrow?', 'tomorrow'],
        ['Tasks due this week', 'this_week'],
        ['What is due next week?', 'next_week'],
        ['What is due soon?', 'soon'],
        ['Which tasks have no due date?', 'none'],
    ])('%s', (question, due) => {
        expect(read(question).due).toBe(due);
    });

    it('does not read "latest" as late', () => {
        expect(read('What is the latest on Local Smoke?').due).toBeNull();
    });
});

describe('askIntent reads a sprint', () => {
    it('resolves the current sprint to the active ones', () => {
        expect(read('What is left in the current sprint?').sprint).toEqual({ current: true, ids: [SPRINT_5] });
    });

    it('resolves a named sprint', () => {
        expect(read('Which tasks in Sprint 4 are done?').sprint).toEqual({ name: 'Sprint 4', ids: [SPRINT_4] });
    });

    it('reads nothing when no sprint is named', () => {
        expect(read('What is overdue?').sprint).toBeNull();
    });
});

describe('askIntent says whether the question is structured', () => {
    it('is not for a plain text question', () => {
        const intent = read('What did we decide about the salary bands?');
        expect(intent.filtered).toBe(false);
        expect(intent.projectIds).toEqual([]);
    });

    it('keeps its rules in one table per language', () => {
        expect(Object.keys(RULES)).toContain('en');
        ['self', 'notSelf', 'unassigned', 'status', 'due', 'sprint', 'listing'].forEach((key) => expect(RULES.en).toHaveProperty(key));
    });
});

describe('dueWindow is computed in the asker\'s timezone', () => {
    const now = new Date('2026-09-28T10:00:00Z');

    it('starts overdue at the asker\'s midnight', () => {
        expect(dueWindow('overdue', { now, timeZone: 'Asia/Kolkata' })).toEqual({ before: new Date('2026-09-27T18:30:00Z') });
        expect(dueWindow('overdue', { now: new Date('2026-09-28T03:00:00Z'), timeZone: 'America/Los_Angeles' })).toEqual({ before: new Date('2026-09-27T07:00:00Z') });
    });

    it('bounds today, this week and next week', () => {
        expect(dueWindow('today', { now, timeZone: 'UTC' })).toEqual({ from: new Date('2026-09-28T00:00:00Z'), before: new Date('2026-09-29T00:00:00Z') });
        expect(dueWindow('this_week', { now, timeZone: 'UTC' })).toEqual({ from: new Date('2026-09-28T00:00:00Z'), before: new Date('2026-10-05T00:00:00Z') });
        expect(dueWindow('next_week', { now, timeZone: 'UTC' })).toEqual({ from: new Date('2026-10-05T00:00:00Z'), before: new Date('2026-10-12T00:00:00Z') });
    });

    it('uses the user\'s zone, then the company\'s, then UTC', () => {
        expect(zoneFor('Asia/Kolkata', 'Europe/Berlin')).toBe('Asia/Kolkata');
        expect(zoneFor('', 'Europe/Berlin')).toBe('Europe/Berlin');
        expect(zoneFor('Nowhere/Land', 'Also/Not')).toBe('UTC');
        expect(zoneFor()).toBe('UTC');
    });
});
