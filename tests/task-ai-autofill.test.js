'use strict';

const {
    AUTOFILL_ACTIONS,
    NATIVE_ASSIGNEE_ID,
    NATIVE_DUE_ID,
    isAiAction,
    kindForField,
    isEmptyValue,
    permissionGate,
    listEmptyTargets,
    sanitizeSuggestions,
    heuristicSuggestions,
    sprintDueStamp,
    planAutofillWrites,
    selectSuggestionsByFieldIds,
    previewFromParts,
    parseSuggestionsPayload,
} = require('../Modules/Tasks/helpers/taskAiAutofill');

const PROJECT = '64b7f0c2a1b2c3d4e5f60711';
const ADA = { id: 'u-ada', name: 'Ada Lovelace', email: 'ada@example.com' };
const GRACE = { id: 'u-grace', name: 'Grace Hopper', email: 'grace@example.com' };

const FIELDS = [
    { _id: 'f-summary', fieldTitle: 'Summary', fieldType: 'text', type: 'task', global: true },
    { _id: 'f-notes', fieldTitle: 'Notes', fieldType: 'textarea', type: 'task', global: true },
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
    {
        _id: 'f-owner',
        fieldTitle: 'Owner',
        fieldType: 'dropdown',
        type: 'task',
        global: true,
        fieldOptions: [
            { id: 'opt-ada', label: 'Ada Lovelace' },
            { id: 'opt-grace', label: 'Grace Hopper' },
        ],
    },
    { _id: 'f-money', fieldTitle: 'Budget', fieldType: 'money', type: 'task', global: true },
    { _id: 'f-formula', fieldTitle: 'Rollup', fieldType: 'formula', type: 'task', global: true },
];

function emptyTask(overrides = {}) {
    return {
        _id: 't-smoke',
        TaskKey: 'SMOKE-1',
        TaskName: 'Ship the invite for 2026-08-27 launch',
        ProjectID: PROJECT,
        description: 'Ada Lovelace owns the invite. Launch is blocked on legal.',
        AssigneeUserId: [],
        customField: {},
        ...overrides,
    };
}

function preview(task, extra = {}) {
    return previewFromParts({
        task,
        fields: FIELDS,
        people: [ADA, GRACE],
        permissions: { customField: true, assignee: true, uid: 'u-ada', roleType: 1 },
        comments: [{ message: 'Ada Lovelace will send it after Launch review.' }],
        ...extra,
    });
}

describe('TASKS - AI autofill custom fields', () => {

    test('preview and apply are the autofill actions', () => {
        expect(AUTOFILL_ACTIONS).toEqual(['preview', 'apply']);
        expect(isAiAction('preview')).toBe(true);
        expect(isAiAction('apply')).toBe(true);
        expect(isAiAction('standup')).toBe(false);
    });

    test('maps summary, date, owner, and tag kinds; skips other types', () => {
        expect(kindForField(FIELDS[0])).toBe('summary');
        expect(kindForField(FIELDS[1])).toBe('summary');
        expect(kindForField(FIELDS[2])).toBe('date');
        expect(kindForField(FIELDS[3])).toBe('tag');
        expect(kindForField(FIELDS[4])).toBe('owner');
        expect(kindForField(FIELDS[5])).toBe(null);
        expect(kindForField(FIELDS[6])).toBe(null);
    });

    test('skip-filled: empty targets omit fields and assignee that already have values', () => {
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
        const ids = targets.map((row) => row.fieldId);
        expect(ids).toEqual(expect.arrayContaining(['f-notes', 'f-date', 'f-owner']));
        expect(ids).not.toContain('f-summary');
        expect(ids).not.toContain('f-tag');
        expect(ids).not.toContain(NATIVE_ASSIGNEE_ID);

        const ghosted = listEmptyTargets({
            task: emptyTask({ AssigneeUserId: ['ghost-not-in-project'] }),
            fields: FIELDS,
            people: [ADA, GRACE],
            permissions: { customField: true, assignee: true },
        });
        expect(ghosted.map((row) => row.fieldId)).toContain(NATIVE_ASSIGNEE_ID);
        expect(ids).not.toContain('f-money');

        const leftoverString = listEmptyTargets({
            task: emptyTask({ AssigneeUserId: ADA.id }),
            fields: FIELDS,
            people: [ADA, GRACE],
            permissions: { customField: true, assignee: true },
        });
        expect(leftoverString.map((row) => row.fieldId)).toContain(NATIVE_ASSIGNEE_ID);

        const { suggestions, skipped } = sanitizeSuggestions([
            { fieldId: 'f-summary', value: 'Overwrite me' },
            { fieldId: 'f-tag', optionId: 'opt-blocked' },
            { fieldId: 'assignee', personId: GRACE.id },
            { fieldId: 'f-notes', value: 'Still empty notes' },
            { fieldId: 'f-invented', value: 'nope' },
        ], { targets, people: [ADA, GRACE], task: filled });
        expect(skipped).toEqual([
            { fieldId: 'f-summary', reason: 'filled' },
            { fieldId: 'f-tag', reason: 'filled' },
            { fieldId: 'assignee', reason: 'filled' },
            { fieldId: 'f-invented', reason: 'unknown' },
        ]);
        expect(suggestions).toEqual([
            expect.objectContaining({ fieldId: 'f-notes', value: 'Still empty notes' }),
        ]);
    });

    test('invented people and tags are dropped', () => {
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
            { fieldId: 'f-owner', kind: 'owner', value: 'Not A Person' },
            { fieldId: 'f-tag', kind: 'tag', optionId: 'opt-launch' },
            { fieldId: 'assignee', kind: 'owner', personId: ADA.id },
        ], { targets, people: [ADA, GRACE], task });

        expect(suggestions.map((row) => row.fieldId)).toEqual(['f-tag', 'assignee']);
        expect(skipped.map((row) => row.reason)).toEqual(expect.arrayContaining([
            'invented-tag',
            'invented-person',
        ]));
        expect(suggestions.find((row) => row.fieldId === 'f-tag').optionId).toBe('opt-launch');
        expect(suggestions.find((row) => row.fieldId === 'assignee').personId).toBe(ADA.id);
    });

    test('permission gate hides fields the caller cannot set', () => {
        expect(permissionGate({ customField: null, assignee: false }).allowed).toBe(false);
        expect(permissionGate({ customField: true, assignee: false }).allowed).toBe(true);

        const task = emptyTask();
        const noFields = listEmptyTargets({
            task,
            fields: FIELDS,
            people: [ADA],
            permissions: { customField: false, assignee: true },
        });
        expect(noFields.every((row) => row.fieldId === NATIVE_ASSIGNEE_ID)).toBe(true);

        const noAssignee = listEmptyTargets({
            task,
            fields: FIELDS,
            people: [ADA],
            permissions: { customField: true, assignee: null },
        });
        expect(noAssignee.some((row) => row.fieldId === NATIVE_ASSIGNEE_ID)).toBe(false);
        expect(noAssignee.some((row) => row.kind === 'summary')).toBe(true);

        const denied = previewFromParts({
            task,
            fields: FIELDS,
            people: [ADA],
            permissions: { customField: null, assignee: false },
        });
        expect(denied.status).toBe(false);
        expect(denied.reason).toMatch(/permission/i);
        expect(denied.data.apply).toBe(false);
    });

    test('preview is grounded in the task and does not apply', () => {
        const result = preview(emptyTask());
        expect(result.status).toBe(true);
        expect(result.data.apply).toBe(false);
        const byId = Object.fromEntries(result.data.suggestions.map((row) => [row.fieldId, row]));
        expect(byId['f-summary'].value).toMatch(/Ada Lovelace/);
        expect(byId['f-date'].value).toBe('2026-08-27');
        expect(byId['f-tag'].optionId).toBe('opt-launch');
        expect(byId['f-owner'].optionId).toBe('opt-ada');
        expect(byId.assignee.personId).toBe(ADA.id);
        expect(result.data.suggestions.some((row) => row.fieldId === 'f-money')).toBe(false);
    });

    test('applying fills only empties; a second run does not clobber filled fields', () => {
        const first = preview(emptyTask());
        const writes = planAutofillWrites(first.data.suggestions);
        expect(writes.some((row) => row.type === 'customField' && row.fieldId === 'f-summary')).toBe(true);
        expect(writes.some((row) => row.type === 'assignee')).toBe(true);

        const filledTask = emptyTask({
            AssigneeUserId: [ADA.id],
            customField: {
                'f-summary': { fieldValue: first.data.suggestions.find((row) => row.fieldId === 'f-summary').value },
                'f-date': { fieldValue: '2026-08-27' },
                'f-tag': { fieldValue: ['opt-launch'] },
                'f-owner': { fieldValue: ['opt-ada'] },
            },
        });
        const second = preview(filledTask, {
            comments: [{ message: 'Grace Hopper should take this over on 2026-09-01. Blocked.' }],
        });
        expect(second.data.suggestions.every((row) => row.fieldId !== 'f-summary')).toBe(true);
        expect(second.data.suggestions.every((row) => row.fieldId !== 'f-date')).toBe(true);
        expect(second.data.suggestions.every((row) => row.fieldId !== 'assignee')).toBe(true);

        const clobber = sanitizeSuggestions([
            { fieldId: 'f-summary', value: 'Overwrite me' },
            { fieldId: 'assignee', personId: GRACE.id },
            { fieldId: 'f-notes', value: 'Still empty notes' },
        ], {
            targets: listEmptyTargets({
                task: filledTask,
                fields: FIELDS,
                people: [ADA, GRACE],
                permissions: { customField: true, assignee: true },
            }),
            people: [ADA, GRACE],
            task: filledTask,
        });
        expect(clobber.skipped).toEqual([
            { fieldId: 'f-summary', reason: 'filled' },
            { fieldId: 'assignee', reason: 'filled' },
        ]);
        expect(clobber.suggestions).toEqual([
            expect.objectContaining({ fieldId: 'f-notes', value: 'Still empty notes' }),
        ]);
    });

    test('fieldHide and hidden fields are not suggested', () => {
        const hidden = {
            _id: 'f-secret',
            fieldTitle: 'Secret summary',
            fieldType: 'text',
            type: 'task',
            global: true,
            fieldHide: ['u-ada'],
        };
        const targets = listEmptyTargets({
            task: emptyTask(),
            fields: [...FIELDS, hidden],
            people: [ADA],
            permissions: { customField: true, assignee: true, uid: 'u-ada' },
        });
        expect(targets.some((row) => row.fieldId === 'f-secret')).toBe(false);
    });

    test('heuristic skip when the text does not ground a tag or person', () => {
        const targets = listEmptyTargets({
            task: emptyTask({ TaskName: 'Untitled', description: '', AssigneeUserId: [] }),
            fields: FIELDS,
            people: [ADA, GRACE],
            permissions: { customField: true, assignee: true },
        });
        const guessed = heuristicSuggestions({
            targets,
            people: [ADA, GRACE],
            title: 'Untitled',
            description: '',
            comments: [],
        });
        expect(guessed.some((row) => row.fieldId === 'f-tag')).toBe(false);
        expect(guessed.some((row) => row.fieldId === NATIVE_ASSIGNEE_ID)).toBe(false);
        expect(guessed.some((row) => row.fieldId === 'f-date')).toBe(false);
    });

    test('parses model JSON even with fences', () => {
        const parsed = parseSuggestionsPayload('```json\n{"suggestions":[{"fieldId":"f-tag","optionId":"opt-launch"}]}\n```');
        expect(parsed).toEqual([{ fieldId: 'f-tag', optionId: 'opt-launch' }]);
    });

    test('Assignee and Owner stay two writes; Owner can fill without assigning', () => {
        const result = preview(emptyTask());
        const byId = Object.fromEntries(result.data.suggestions.map((row) => [row.fieldId, row]));
        expect(byId.assignee.title).toBe('Assignee');
        expect(byId['f-owner'].title).toBe('Owner');
        expect(byId.assignee.fieldId).not.toBe(byId['f-owner'].fieldId);

        const ownerOnly = selectSuggestionsByFieldIds(result.data.suggestions, ['f-owner']);
        const writes = planAutofillWrites(ownerOnly);
        expect(writes).toEqual([
            expect.objectContaining({ type: 'customField', fieldId: 'f-owner' }),
        ]);
        expect(writes.some((row) => row.type === 'assignee')).toBe(false);

        const none = selectSuggestionsByFieldIds(result.data.suggestions, []);
        expect(none).toEqual([]);
        expect(planAutofillWrites(none)).toEqual([]);
    });

    test('skip-filled is per field so Priority tag can land without re-applying Summary', () => {
        const first = preview(emptyTask());
        const summary = first.data.suggestions.find((row) => row.fieldId === 'f-summary');
        const filled = emptyTask({
            customField: {
                'f-summary': { fieldValue: summary.value },
            },
        });
        const second = preview(filled);
        const ids = second.data.suggestions.map((row) => row.fieldId);
        expect(ids).toContain('f-tag');
        expect(ids).toContain('f-owner');
        expect(ids).toContain(NATIVE_ASSIGNEE_ID);
        expect(ids).not.toContain('f-summary');

        const tagOnly = selectSuggestionsByFieldIds(second.data.suggestions, ['f-tag']);
        expect(tagOnly).toEqual([expect.objectContaining({ fieldId: 'f-tag' })]);
        expect(planAutofillWrites(tagOnly).every((row) => row.fieldId === 'f-tag')).toBe(true);
    });

    test('placeholder Due is empty and sprint dates seed an apply-able Due row', () => {
        expect(isEmptyValue('DD/MM/YYYY')).toBe(true);
        expect(isEmptyValue('MM/DD/YYYY')).toBe(true);
        expect(isEmptyValue({ date: '' })).toBe(true);
        expect(isEmptyValue({})).toBe(true);
        expect(isEmptyValue('2026-08-28')).toBe(false);

        const pm = { id: 'u-pm', name: 'Local PM', email: 'pm@local.test' };
        const smoke = emptyTask({
            TaskName: 'Test Ask Smoke on mobile',
            description: '',
            AssigneeUserId: [{ toHexString: () => 'deadbeefdeadbeefdeadbeef' }],
            Task_Leader: pm.id,
            DueDate: 'DD/MM/YYYY',
            sprintName: 'SMOKE - 24 - 28 Aug 2026',
            sprintArray: { name: 'SMOKE - 24 - 28 Aug 2026', endDate: '2026-08-28' },
            customField: {
                'f-summary': { fieldValue: 'Test Ask Smoke functionality on mobile devices' },
                'f-tag': { fieldValue: ['opt-launch'] },
                'f-owner': { fieldValue: ['opt-ada'] },
                'f-date': { fieldValue: 'DD/MM/YYYY' },
            },
        });
        const people = [pm, ADA, GRACE];
        const targets = listEmptyTargets({
            task: smoke,
            fields: FIELDS,
            people,
            permissions: { customField: true, assignee: true },
        });
        const ids = targets.map((row) => row.fieldId);
        expect(ids).toContain('f-date');
        expect(ids).toContain('f-notes');
        expect(ids).toContain(NATIVE_ASSIGNEE_ID);
        expect(ids).not.toContain('f-summary');
        expect(ids).not.toContain('f-owner');
        expect(ids).not.toContain('f-tag');
        expect(ids).not.toContain(NATIVE_DUE_ID);

        const result = preview(smoke, { comments: [], people });
        const due = result.data.suggestions.find((row) => row.fieldId === 'f-date');
        const assignee = result.data.suggestions.find((row) => row.fieldId === NATIVE_ASSIGNEE_ID);
        expect(due).toEqual(expect.objectContaining({ kind: 'date', value: '2026-08-28' }));
        expect(assignee).toEqual(expect.objectContaining({ personId: pm.id, display: 'Local PM' }));
        expect(result.data.suggestions.every((row) => row.fieldId !== 'f-summary')).toBe(true);
        expect(result.data.suggestions.every((row) => row.fieldId !== 'f-owner')).toBe(true);

        const writes = planAutofillWrites([due]);
        expect(writes).toEqual([
            expect.objectContaining({ type: 'customField', fieldId: 'f-date', alsoDueDate: true }),
        ]);

        const llmSkipped = previewFromParts({
            task: smoke,
            fields: FIELDS,
            people,
            permissions: { customField: true, assignee: true, uid: 'u-ada', roleType: 1 },
            comments: [],
        }, []);
        expect(llmSkipped.data.suggestions.find((row) => row.fieldId === 'f-date')).toEqual(
            expect.objectContaining({ kind: 'date', value: '2026-08-28' }),
        );
        expect(llmSkipped.data.suggestions.find((row) => row.fieldId === NATIVE_ASSIGNEE_ID)).toEqual(
            expect.objectContaining({ personId: pm.id }),
        );
        expect(sprintDueStamp(smoke)).toEqual(expect.any(Date));
        expect(sprintDueStamp(smoke).toISOString().slice(0, 10)).toBe('2026-08-28');
        expect(sprintDueStamp({}, { endDate: '2026-08-28' }).toISOString().slice(0, 10)).toBe('2026-08-28');

        const nativeOnly = listEmptyTargets({
            task: emptyTask({
                TaskName: 'Test Ask Smoke on mobile',
                AssigneeUserId: [],
                DueDate: 'DD/MM/YYYY',
                sprintName: 'SMOKE - 24 - 28 Aug 2026',
            }),
            fields: FIELDS.filter((field) => field._id !== 'f-date'),
            people: [pm],
            permissions: { customField: true, assignee: true },
        });
        expect(nativeOnly.map((row) => row.fieldId)).toContain(NATIVE_DUE_ID);
        const nativePreview = previewFromParts({
            task: emptyTask({
                TaskName: 'Test Ask Smoke on mobile',
                AssigneeUserId: [],
                DueDate: 'DD/MM/YYYY',
                Task_Leader: pm.id,
                sprintName: 'SMOKE - 24 - 28 Aug 2026',
            }),
            fields: FIELDS.filter((field) => field._id !== 'f-date'),
            people: [pm],
            permissions: { customField: true, assignee: true },
            comments: [],
        }, []);
        expect(nativePreview.data.suggestions.find((row) => row.fieldId === NATIVE_DUE_ID)).toEqual(
            expect.objectContaining({ kind: 'date', value: '2026-08-28' }),
        );
    });

    test('task panel Autofill is two labeled rows with per-row apply, not gated on AI plan', () => {
        const fs = require('fs');
        const path = require('path');
        const card = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'TaskAiAutofill', 'TaskAiAutofill.vue'), 'utf8');
        const render = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'plugins', 'customFieldView', 'component', 'molecules', 'customFieldTaskView', 'customFieldRender.vue'), 'utf8');
        expect(card).toContain('applyOne');
        expect(card).toContain('applyEmpty');
        expect(card).toContain('canFillEmpty');
        expect(card).toContain('sprintDueDisplay');
        expect(card).toContain('ghostUser');
        expect(card).toContain('ownerFilled');
        expect(card).toContain('canWrite');
        expect(card).toContain('assigneeSeed');
        expect(card).toContain('assigneeChipId');
        expect(card).toContain('nativeDueEmpty');
        expect(card).toContain("write: 'assignee'");
        expect(card).toContain("write: 'owner'");
        expect(card).toContain('showCard');
        expect(card).toContain('taf__go');
        expect(card).toContain('autofill_fill_empty');
        expect(card).toContain('autofill_no_suggestion');
        expect(card).toContain('suggestionLabel');
        expect(card).toContain('assigneeEmpty()');
        expect(card).toContain('assigneeRow');
        expect(card).toContain('assigneeTitle');
        expect(card).toContain("'Assignee'");
        expect(card).toContain('data-taf-row');
        expect(card).toContain('namedAssigneeChip');
        expect(card).toContain('seedPerson');
        expect(card).toContain('!Array.isArray(raw)');
        expect(card).toContain("t('ProjectDetails.assignee')");
        expect(card).toContain('next.unshift(seed)');
        expect(card).toContain("getters['users/users']");
        expect(card).toContain('dueIsEmpty');
        expect(card).toContain("item.fieldId === 'assignee'");
        expect(card).toContain('\\bowner\\b');
        expect(card).toContain('canApply');
        expect(card).toContain("write: 'date'");
        expect(card).toContain('customDueEmpty');
        expect(card).toContain('DATE_PLACEHOLDER');
        expect(card).toContain('dueField');
        expect(card).not.toContain('taf__kind');
        expect(card).not.toContain('taf__filled');
        expect(card).not.toContain('autofill_filled');
        expect(card).not.toContain("'—'");
        expect(card).not.toContain("checkApps('CustomFields')");
        expect(card).not.toContain('getAppState');
        expect(render).not.toContain('TaskAiAutofill');
        const tab = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'TaskDetailTab', 'TaskDetailTab.vue'), 'utf8');
        expect(tab).toContain('TaskAiAutofill');
        expect(tab.indexOf('TaskAiAutofill')).toBeLessThan(tab.indexOf('CheckListComponent'));
        expect(tab.indexOf('TaskAiAutofill')).toBeLessThan(tab.indexOf('CustomFieldRenderViewComponent'));
        expect(tab.indexOf('TaskAiAutofill')).toBeLessThan(tab.indexOf('Description'));
    });
});
