'use strict';

const fs = require('fs');
const path = require('path');
const {
    WRITEBACK_EVENTS,
    isWritebackEnabled,
    eventGate,
    chooseWrite,
    planTaskAutofill,
    followupCommentText,
    followupActivityMessage,
    shouldNotifyForWriteback,
    heuristicPageBriefing,
    shapePageBriefing,
    listEmptyTargets,
} = require('../Modules/Automations/helpers/agentWriteback');
const {
    NATIVE_ASSIGNEE_ID,
    sanitizeSuggestions,
    isAssigneeEmpty,
} = require('../Modules/Tasks/helpers/taskAiAutofill');
const R = require('../Modules/Automations/helpers/automationRules');

const PROJECT = '64b7f0c2a1b2c3d4e5f60711';
const TASK = '64c7f0c2a1b2c3d4e5f60722';
const PAGE = '64d7f0c2a1b2c3d4e5f60733';
const ADA = { id: 'u-ada', name: 'Ada Lovelace', email: 'ada@example.com' };
const GRACE = { id: 'u-grace', name: 'Grace Hopper', email: 'grace@example.com' };

const FIELDS = [
    { _id: 'f-summary', fieldTitle: 'Summary', fieldType: 'text', type: 'task', global: true },
    { _id: 'f-date', fieldTitle: 'Due', fieldType: 'date', type: 'task', global: true },
    {
        _id: 'f-tag',
        fieldTitle: 'Priority tag',
        fieldType: 'dropdown',
        type: 'task',
        global: true,
        fieldOptions: [
            { id: 'opt-launch', label: 'Launch' },
            { id: 'opt-blocked', label: 'Blocked' },
        ],
    },
];

function emptyTask(overrides = {}) {
    return {
        _id: TASK,
        TaskKey: 'SMOKE-1',
        TaskName: 'Ship the invite for 2026-08-27 launch',
        ProjectID: PROJECT,
        description: 'Ada Lovelace owns the invite. Launch is blocked on legal.',
        AssigneeUserId: [],
        customField: {},
        ...overrides,
    };
}

const STATUS_EVENT = {
    type: 'task_status_changed',
    companyId: 'co-1',
    taskId: TASK,
    statusText: 'In Progress',
};
const PAGE_EVENT = {
    type: 'page_updated',
    companyId: 'co-1',
    pageId: PAGE,
};
const COMMENT_EVENT = {
    type: 'comment_created',
    companyId: 'co-1',
    taskId: TASK,
    comment: {
        userId: 'u-ada',
        taskId: TASK,
        type: 'text',
        message: 'Ada Lovelace will send the Launch invite.',
        projectId: PROJECT,
    },
};

describe('AUTOMATIONS - agent write-back event gate', () => {
    test('only status, page save, and comment events pass', () => {
        expect(WRITEBACK_EVENTS).toEqual(['task_status_changed', 'page_updated', 'comment_created']);
        expect(eventGate(STATUS_EVENT).allowed).toBe(true);
        expect(eventGate(PAGE_EVENT).allowed).toBe(true);
        expect(eventGate(COMMENT_EVENT).allowed).toBe(true);
        expect(eventGate({ type: 'task_created', companyId: 'co-1', taskId: TASK }).allowed).toBe(false);
        expect(eventGate({ type: 'task_status_changed' }).reason).toBe('companyId');
        expect(eventGate({ type: 'task_status_changed', companyId: 'co-1' }).reason).toBe('task-id');
        expect(eventGate({ type: 'page_updated', companyId: 'co-1' }).reason).toBe('page-id');
    });

    test('disabled project, Alian author, @Alian mention, and briefing-only saves are skipped', () => {
        expect(isWritebackEnabled({ aiWritebackEnabled: false })).toBe(false);
        expect(isWritebackEnabled({})).toBe(true);
        expect(eventGate({ ...STATUS_EVENT, aiWritebackEnabled: false }).reason).toBe('disabled');
        expect(eventGate({
            ...COMMENT_EVENT,
            comment: { ...COMMENT_EVENT.comment, userId: 'alian' },
        }).reason).toBe('alian-author');
        expect(eventGate({
            ...COMMENT_EVENT,
            comment: { ...COMMENT_EVENT.comment, message: '@Alian what is next?' },
        }).reason).toBe('alian-mention');
        expect(eventGate({ ...PAGE_EVENT, briefingOnly: true }).reason).toBe('briefing-only');
        expect(eventGate({
            ...COMMENT_EVENT,
            comment: { userId: 'u-ada', taskId: 'default', message: 'hi', type: 'text' },
        }).reason).toBe('not-task-comment');
    });

    test('permission gate blocks field writes the caller cannot set', () => {
        expect(eventGate({
            ...STATUS_EVENT,
            permissions: { customField: null, assignee: false },
        }).allowed).toBe(false);
        expect(eventGate({
            ...STATUS_EVENT,
            permissions: { customField: null, assignee: false },
        }).reason).toBe('permission');
        expect(eventGate({
            ...STATUS_EVENT,
            permissions: { customField: true, assignee: false },
        }).allowed).toBe(true);
        expect(eventGate({
            ...PAGE_EVENT,
            permissions: { customField: null, assignee: false },
        }).allowed).toBe(true);
    });
});

describe('AUTOMATIONS - agent write-back skip-filled and invented ids', () => {
    test('skip-filled: already-valued fields are not planned for write-back', () => {
        const filled = emptyTask({
            AssigneeUserId: [ADA.id],
            customField: {
                'f-summary': { fieldValue: 'Already written' },
                'f-tag': { fieldValue: ['opt-launch'] },
            },
        });
        const targets = listEmptyTargets({
            task: filled,
            fields: FIELDS,
            people: [ADA, GRACE],
            permissions: { customField: true, assignee: true },
        });
        expect(targets.map((row) => row.fieldId)).toEqual(['f-date']);

        const planned = planTaskAutofill({
            incoming: [
                { fieldId: 'f-summary', value: 'Overwrite me' },
                { fieldId: 'f-tag', optionId: 'opt-blocked' },
                { fieldId: 'assignee', personId: GRACE.id },
                { fieldId: 'f-date', value: '2026-08-27' },
            ],
            targets,
            people: [ADA, GRACE],
            task: filled,
        });
        expect(planned.skipped).toEqual(expect.arrayContaining([
            { fieldId: 'f-summary', reason: 'filled' },
            { fieldId: 'f-tag', reason: 'filled' },
            { fieldId: 'assignee', reason: 'filled' },
        ]));
        expect(planned.suggestions).toEqual([
            expect.objectContaining({ fieldId: 'f-date', value: '2026-08-27' }),
        ]);
        expect(planned.writes.every((row) => row.fieldId !== 'f-summary')).toBe(true);
    });

    test('Owner write-back does not assign the native assignee', () => {
        const ownerField = {
            _id: 'f-owner',
            fieldTitle: 'Owner',
            fieldType: 'dropdown',
            type: 'task',
            global: true,
            fieldOptions: [{ id: 'opt-ada', label: 'Ada Lovelace' }],
        };
        const task = emptyTask();
        const targets = listEmptyTargets({
            task,
            fields: [...FIELDS, ownerField],
            people: [ADA, GRACE],
            permissions: { customField: true, assignee: true },
        });
        const planned = planTaskAutofill({
            incoming: [
                { fieldId: 'f-owner', kind: 'owner', optionId: 'opt-ada' },
            ],
            targets,
            people: [ADA, GRACE],
            task,
        });
        expect(planned.suggestions.map((row) => row.fieldId)).toEqual(['f-owner']);
        expect(planned.writes.some((row) => row.type === 'assignee')).toBe(false);
        expect(planned.writes).toEqual([
            expect.objectContaining({ type: 'customField', fieldId: 'f-owner' }),
        ]);
        expect(isAssigneeEmpty(task)).toBe(true);
    });

    test('invented people, tags, and task ids are dropped', () => {
        const task = emptyTask();
        const targets = listEmptyTargets({
            task,
            fields: FIELDS,
            people: [ADA, GRACE],
            permissions: { customField: true, assignee: true },
        });
        const { suggestions, skipped } = sanitizeSuggestions([
            { fieldId: 'f-tag', kind: 'tag', value: 'Invented' },
            { fieldId: 'assignee', kind: 'owner', personId: 'u-invented', value: 'Ghost' },
            { fieldId: 'f-tag', kind: 'tag', optionId: 'opt-launch' },
            { fieldId: 'assignee', kind: 'owner', personId: ADA.id },
        ], { targets, people: [ADA, GRACE], task });
        expect(suggestions.map((row) => row.fieldId)).toEqual(['f-tag', 'assignee']);
        expect(skipped.map((row) => row.reason)).toEqual(expect.arrayContaining([
            'invented-tag',
            'invented-person',
        ]));

        const shaped = shapePageBriefing({
            markdown: 'Briefing from Local Smoke.',
            packCitations: [{ type: 'task', id: TASK, title: 'SMOKE-1 Ship the invite' }],
            usedHints: [
                { type: 'task', id: 'invented-task' },
                { type: 'task', id: TASK },
            ],
        });
        expect(shaped.apply).toBe(false);
        expect(shaped.contentUntouched).toBe(true);
        expect(shaped.citations.map((row) => row.id)).toEqual([TASK]);
        expect(shaped.citations.some((row) => row.id === 'invented-task')).toBe(false);
    });

    test('status and comment choose autofill when empties exist, otherwise a follow-up comment; page updates a briefing', () => {
        const targets = listEmptyTargets({
            task: emptyTask(),
            fields: FIELDS,
            people: [ADA],
            permissions: { customField: true, assignee: true },
        });
        expect(chooseWrite({ event: STATUS_EVENT, emptyTargets: targets }).action).toBe('autofill');
        expect(chooseWrite({ event: COMMENT_EVENT, emptyTargets: targets }).action).toBe('autofill');
        expect(chooseWrite({ event: STATUS_EVENT, emptyTargets: [] }).action).toBe('activity');
        expect(chooseWrite({ event: COMMENT_EVENT, emptyTargets: [] }).action).toBe('activity');
        expect(chooseWrite({ event: PAGE_EVENT, pageText: 'Ship the invite.' }).action).toBe('briefing');
        expect(chooseWrite({ event: PAGE_EVENT, pageText: '' }).action).toBe('skip');

        const filledNote = followupCommentText({
            event: STATUS_EVENT,
            applied: [{ title: 'Summary' }, { title: 'Due' }],
        });
        expect(filledNote).toMatch(/Filled empty fields after this status change: Summary, Due/);
        expect(followupActivityMessage({
            event: STATUS_EVENT,
            applied: [{ title: 'Summary' }, { title: 'Due' }],
        })).toMatch(/<b>Alian<\/b> filled empty fields after this status change: Summary, Due/);
        expect(followupActivityMessage({
            event: STATUS_EVENT,
            applied: [],
            statusText: 'In Progress',
            taskTitle: 'Ship the invite',
        })).toMatch(/<b>Alian<\/b> noted the status change to In Progress/);
        expect(shouldNotifyForWriteback({})).toBe(false);
        expect(shouldNotifyForWriteback({ taggedUserIds: [] })).toBe(false);
        expect(shouldNotifyForWriteback({ taggedUserIds: ['u-ada'] })).toBe(true);

        const brief = heuristicPageBriefing({
            title: 'Local Smoke',
            rawText: 'Ada Lovelace owns the invite.',
            linkedTasks: [{ _id: TASK, TaskKey: 'SMOKE-1', TaskName: 'Ship the invite' }],
        });
        expect(brief.markdown).toContain('Local Smoke');
        expect(brief.markdown).toContain('Ada Lovelace');
        expect(brief.used).toEqual([{ type: 'task', id: TASK }]);
        expect(NATIVE_ASSIGNEE_ID).toBe('assignee');
    });
});

describe('AUTOMATIONS - write-back reuses 005-007 without wiring set_priority into live events', () => {
    test('AUTO-03 actions stay on-demand set_priority', () => {
        expect(R.ACTION_TYPES).toEqual(['set_priority']);
        expect(R.TRIGGERS).toEqual(['manual', 'task_created', 'task_status_changed']);
    });

    test('kiln affordance and project toggle are on the page and automations hub', () => {
        const panel = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PagesPanel.vue'), 'utf8');
        const hub = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Integrations', 'IntegrationsHub.vue'), 'utf8');
        const locale = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        const comments = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Comments', 'controller.js'), 'utf8');
        const pages = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Pages', 'controller.js'), 'utf8');
        const status = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Tasks', 'helpers', 'taskMongo', 'updateBasic.js'), 'utf8');
        const run = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Automations', 'helpers', 'agentWritebackRun.js'), 'utf8');
        const card = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'TaskAiAutofill', 'TaskAiAutofill.vue'), 'utf8');
        const activity = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'ActivityLogContent', 'ActivityContent.vue'), 'utf8');

        expect(panel).toContain('pg__writeback');
        expect(panel).toContain('pg__briefing');
        expect(panel).toContain('briefingDismissed');
        expect(panel).toContain('pages_briefing_dismiss');
        expect(panel).toContain('pages_writeback');
        expect(panel).toContain('${env.AUTOMATIONS}/writeback');
        expect(hub).toContain('ig-writeback');
        expect(hub).toContain('toggleWriteback');
        expect(locale).toContain('pages_writeback_fired');
        expect(locale).toContain('writeback_intro');
        expect(comments).toContain("type: 'comment_created'");
        expect(pages).toContain('applyPageWriteback');
        expect(status).toContain("type: 'task_status_changed'");
        expect(run).toContain('applyAutofillWrites');
        expect(run).toContain('postWritebackActivity');
        expect(run).toContain('HandleHistory');
        expect(run).not.toContain('saveAlianComment');
        expect(run).toContain("action: applied.length ? 'autofill' : 'activity'");
        expect(run.indexOf('if (!isWritebackEnabled(project))')).toBeLessThan(
            run.indexOf("action: 'activity', reason: context.reason"),
        );
        expect(card).not.toContain('taf__kind');
        expect(card).toContain('taf__pick');
        expect(card).toContain('autofill_fill_empty');
        expect(activity).toContain('alian-mark');
        expect(activity).toContain('agent_writeback');
    });
});
