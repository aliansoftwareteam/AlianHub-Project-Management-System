/**
 * Webhook Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Webhooks/helpers/webhookRules.js — the pure rules
 * behind the outgoing-webhook system. No DB or network needed.
 */

const {
    EVENT_TYPES,
    WILDCARD,
    WEBHOOK_FORMATS,
    isValidUrl,
    validateWebhookInput,
    subscribesTo,
    classifyTaskEvent,
    shouldDeliverTask,
    normalizeChangedFields,
    summarizeTaskChange,
    trimTaskForDelivery,
    signPayload,
    generateSecret,
    normalizeFormat,
    formatForTarget,
} = require('../Modules/Webhooks/helpers/webhookRules');

describe('webhook format presets', () => {
    // A back-to-back status + priority + due change collapsed into one window.
    const body = {
        event: 'task.updated',
        companyId: 'c1',
        changedFields: ['status', 'Task_Priority', 'DueDate'],
        data: { TaskKey: 'AHE-1', TaskName: 'Fix login', status: { text: 'In Progress' }, Task_Priority: 'HIGH', DueDate: '2026-07-01' },
    };

    test('normalizeFormat falls back to json for unknown/empty', () => {
        expect(normalizeFormat('slack')).toBe('slack');
        expect(normalizeFormat('discord')).toBe('discord');
        expect(normalizeFormat('teams')).toBe('json');
        expect(normalizeFormat(undefined)).toBe('json');
    });

    test('json format returns the raw envelope unchanged', () => {
        expect(formatForTarget('json', body)).toBe(body);
        expect(formatForTarget(undefined, body)).toBe(body);
    });

    test('slack format announces the change with text + blocks', () => {
        const out = formatForTarget('slack', body);
        expect(out.text).toContain('AHE-1');
        expect(Array.isArray(out.blocks)).toBe(true);
        const rendered = JSON.stringify(out);
        expect(rendered).toContain('Task updated'); // multi-field change → generic headline
        expect(rendered).toContain('In Progress');
        expect(rendered).toContain('HIGH');
    });

    test('discord format embeds only the fields that actually changed', () => {
        const out = formatForTarget('discord', body);
        expect(Array.isArray(out.embeds)).toBe(true);
        expect(out.embeds[0].title).toContain('Fix login');
        const names = out.embeds[0].fields.map((f) => f.name);
        expect(names).toEqual(expect.arrayContaining(['Status', 'Priority', 'Due']));
    });

    test('a single-field change announces that one action and omits the rest', () => {
        const assigneeChange = {
            event: 'task.updated',
            changedFields: ['AssigneeUserId'],
            data: { TaskKey: 'AHE-1', TaskName: 'Fix login', status: { text: 'In Progress' }, Task_Priority: 'HIGH', assigneeNames: ['Jane Doe'] },
        };
        const out = formatForTarget('discord', assigneeChange);
        expect(out.embeds[0].description).toBe('Assignees updated');
        expect(out.embeds[0].fields.map((f) => f.name)).toEqual(['Assignees']);
        expect(out.embeds[0].fields[0].value).toBe('Jane Doe');
        // Status/Priority are NOT shown on an assignee-only change.
        const rendered = JSON.stringify(out);
        expect(rendered).not.toContain('In Progress');
        expect(rendered).not.toContain('HIGH');
    });

    test('validateWebhookInput rejects an unknown format but accepts a valid one', () => {
        const base = { name: 'h', url: 'https://x.test', events: ['*'] };
        expect(validateWebhookInput({ ...base, format: 'teams' }).valid).toBe(false);
        expect(validateWebhookInput({ ...base, format: 'slack' }).valid).toBe(true);
        expect(validateWebhookInput(base).valid).toBe(true); // format optional
    });

    test('WEBHOOK_FORMATS lists the three supported shapes', () => {
        expect(WEBHOOK_FORMATS).toEqual(['json', 'slack', 'discord']);
    });
});

describe('🪝 WEBHOOKS - Rules', () => {

    describe('validateWebhookInput', () => {

        const valid = { name: 'CI hook', url: 'https://example.com/hook', events: ['task.updated'] };

        test('a valid registration passes', () => {
            expect(validateWebhookInput(valid).valid).toBe(true);
        });

        test('wildcard subscription passes', () => {
            expect(validateWebhookInput({ ...valid, events: [WILDCARD] }).valid).toBe(true);
        });

        test('missing or oversized name fails', () => {
            expect(validateWebhookInput({ ...valid, name: '' }).valid).toBe(false);
            expect(validateWebhookInput({ ...valid, name: 'x'.repeat(81) }).valid).toBe(false);
        });

        test('non-http(s) urls fail', () => {
            expect(validateWebhookInput({ ...valid, url: 'ftp://example.com' }).valid).toBe(false);
            expect(validateWebhookInput({ ...valid, url: 'not a url' }).valid).toBe(false);
            expect(validateWebhookInput({ ...valid, url: 'javascript:alert(1)' }).valid).toBe(false);
        });

        test('unknown events are rejected by name', () => {
            const result = validateWebhookInput({ ...valid, events: ['task.updated', 'project.created'] });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/project\.created/);
        });

        test('empty events fail', () => {
            expect(validateWebhookInput({ ...valid, events: [] }).valid).toBe(false);
        });
    });

    describe('subscribesTo', () => {

        test('explicit subscription matches only its events', () => {
            const hook = { events: ['task.deleted'] };
            expect(subscribesTo(hook, 'task.deleted')).toBe(true);
            expect(subscribesTo(hook, 'task.updated')).toBe(false);
        });

        test('wildcard matches everything', () => {
            const hook = { events: [WILDCARD] };
            EVENT_TYPES.forEach((event) => expect(subscribesTo(hook, event)).toBe(true));
        });
    });

    describe('classifyTaskEvent', () => {

        const doc = { _id: 'x', createdAt: new Date('2026-01-01T00:00:00Z'), };
        const now = new Date('2026-06-01T00:00:00Z').getTime();

        test('insert payloads classify as created', () => {
            expect(classifyTaskEvent({ type: 'insert', doc, updatedFields: {}, now })).toBe('task.created');
        });

        test('deletedStatusKey transitions classify correctly', () => {
            expect(classifyTaskEvent({ type: 'update', doc, updatedFields: { deletedStatusKey: 1 }, now })).toBe('task.deleted');
            expect(classifyTaskEvent({ type: 'update', doc, updatedFields: { deletedStatusKey: 2 }, now })).toBe('task.archived');
            expect(classifyTaskEvent({ type: 'update', doc, updatedFields: { deletedStatusKey: 0 }, now })).toBe('task.restored');
        });

        test('TaskKey assignment right after creation classifies as created', () => {
            const fresh = { ...doc, createdAt: new Date(now - 5000) };
            expect(classifyTaskEvent({ type: 'update', doc: fresh, updatedFields: { TaskKey: 'AH-1' }, now })).toBe('task.created');
        });

        test('TaskKey change on an old task is just an update', () => {
            expect(classifyTaskEvent({ type: 'update', doc, updatedFields: { TaskKey: 'AH-1' }, now })).toBe('task.updated');
        });

        test('create-flow churn right after creation is suppressed (no spurious task.updated)', () => {
            const fresh = { ...doc, createdAt: new Date(now - 3000) };
            // The TaskKey assignment emits with no updatedFields; counter/index
            // writes carry only internal fields — the insert already fired created.
            expect(classifyTaskEvent({ type: 'update', doc: fresh, updatedFields: {}, now })).toBe(null);
            expect(classifyTaskEvent({ type: 'update', doc: fresh, updatedFields: { groupByStatusIndex: 2, subTasks: 0 }, now })).toBe(null);
            // ...but a genuine field change right after create still notifies.
            expect(classifyTaskEvent({ type: 'update', doc: fresh, updatedFields: { status: { text: 'In Progress' } }, now })).toBe('task.updated');
            // Outside the create window, behaviour is unchanged (still an update).
            expect(classifyTaskEvent({ type: 'update', doc, updatedFields: {}, now })).toBe('task.updated');
        });

        test('everything else is task.updated; missing doc is null', () => {
            expect(classifyTaskEvent({ type: 'update', doc, updatedFields: { TaskName: 'x' }, now })).toBe('task.updated');
            expect(classifyTaskEvent({ type: 'update', doc: null, updatedFields: {}, now })).toBe(null);
        });
    });

    describe('shouldDeliverTask', () => {

        test('a real task (re-read found one) is delivered', () => {
            expect(shouldDeliverTask({ _id: 'task1', TaskKey: 'AH-1' }, false)).toBe(true);
        });

        test('a clean read that found no task is dropped (non-task payload)', () => {
            // The create flow bumps the project counter and emits the PROJECT doc
            // under module:'task'; its _id is a project id, so the task re-read is
            // empty — that must not deliver a phantom task.updated.
            expect(shouldDeliverTask(null, false)).toBe(false);
            expect(shouldDeliverTask(undefined, false)).toBe(false);
            expect(shouldDeliverTask({}, false)).toBe(false);
        });

        test('a transient read error falls back to best-effort delivery', () => {
            expect(shouldDeliverTask(null, true)).toBe(true);
        });
    });

    describe('normalizeChangedFields', () => {

        test('flattens mongo operators (the assignee path) to field names', () => {
            expect([...normalizeChangedFields({ $addToSet: { AssigneeUserId: 'u1' } })]).toEqual(['AssigneeUserId']);
            expect([...normalizeChangedFields({ $pull: { AssigneeUserId: 'u1' } })]).toEqual(['AssigneeUserId']);
            expect([...normalizeChangedFields({ $set: { AssigneeUserId: ['u1', 'u2'] } })]).toEqual(['AssigneeUserId']);
        });

        test('keeps plain field maps and strips dotted suffixes', () => {
            const out = normalizeChangedFields({ Task_Priority: 'HIGH', 'customField.abc': 1 });
            expect(out.has('Task_Priority')).toBe(true);
            expect(out.has('customField')).toBe(true);
        });

        test('empty or missing payloads yield an empty set', () => {
            expect(normalizeChangedFields(undefined).size).toBe(0);
            expect(normalizeChangedFields({}).size).toBe(0);
        });
    });

    describe('summarizeTaskChange', () => {

        const task = {
            TaskKey: 'AHE-1', TaskName: 'Fix login',
            status: { text: 'In Progress' }, Task_Priority: 'HIGH',
            DueDate: '2026-07-01', assigneeNames: ['Jane'], leadName: 'Sam',
        };

        test('created announces creation with the practical fields', () => {
            const s = summarizeTaskChange({ event: 'task.created', changedFields: [], task });
            expect(s.headline).toBe('Task created');
            expect(s.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['Assignees', 'Priority', 'Due']));
        });

        test('a single change names the action and shows only that field', () => {
            expect(summarizeTaskChange({ event: 'task.updated', changedFields: ['status'], task }).headline).toBe('Status changed');
            const assignee = summarizeTaskChange({ event: 'task.updated', changedFields: ['AssigneeUserId'], task });
            expect(assignee.headline).toBe('Assignees updated');
            expect(assignee.fields.map((f) => f.name)).toEqual(['Assignees']);
            expect(assignee.fields[0].value).toBe('Jane');
        });

        test('multiple changes use a generic headline listing each field', () => {
            const s = summarizeTaskChange({ event: 'task.updated', changedFields: ['status', 'Task_Priority'], task });
            expect(s.headline).toBe('Task updated');
            expect(s.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['Status', 'Priority']));
        });

        test('rename shows the name; description stays headline-only', () => {
            const renamed = summarizeTaskChange({ event: 'task.updated', changedFields: ['TaskName'], task });
            expect(renamed.headline).toBe('Task renamed');
            expect(renamed.fields).toEqual([{ name: 'Name', value: 'Fix login', inline: true }]);
            expect(summarizeTaskChange({ event: 'task.updated', changedFields: ['rawDescription'], task }).headline)
                .toBe('Description updated');
        });

        test('renders a from → to transition when the previous value is known', () => {
            const previous = { ...task, status: { text: 'To Do' }, TaskName: 'Old title' };
            const status = summarizeTaskChange({ event: 'task.updated', changedFields: ['status'], task, previous });
            expect(status.headline).toBe('Status changed');
            expect(status.fields[0].value).toBe('To Do → In Progress');

            const renamed = summarizeTaskChange({ event: 'task.updated', changedFields: ['TaskName'], task, previous });
            expect(renamed.fields[0].value).toBe('Old title → Fix login');
        });

        test('omits the arrow when the value did not actually change', () => {
            const status = summarizeTaskChange({ event: 'task.updated', changedFields: ['status'], task, previous: { ...task } });
            expect(status.fields[0].value).toBe('In Progress');
        });

        test('estimate renders minutes as a readable duration with a transition', () => {
            const s = summarizeTaskChange({
                event: 'task.updated', changedFields: ['totalEstimatedTime'],
                task: { ...task, totalEstimatedTime: 240 },
                previous: { ...task, totalEstimatedTime: 120 },
            });
            expect(s.headline).toBe('Estimate updated');
            expect(s.fields[0].value).toBe('2h → 4h');
        });

        test('story points changes announce with a from → to transition', () => {
            const s = summarizeTaskChange({
                event: 'task.updated', changedFields: ['points'],
                task: { ...task, points: 8 },
                previous: { ...task, points: 3 },
            });
            expect(s.headline).toBe('Story points changed');
            expect(s.fields).toEqual([{ name: 'Points', value: '3 → 8', inline: true }]);
        });

        test('an internal-only / unrecognized change is a quiet generic update', () => {
            const s = summarizeTaskChange({ event: 'task.updated', changedFields: ['subTasks'], task });
            expect(s.headline).toBe('Task updated');
            expect(s.fields).toEqual([]);
        });

        test('lifecycle events announce the action with no rows', () => {
            expect(summarizeTaskChange({ event: 'task.deleted', changedFields: [], task }).headline).toBe('Task deleted');
            expect(summarizeTaskChange({ event: 'task.archived', changedFields: [], task }).headline).toBe('Task archived');
            expect(summarizeTaskChange({ event: 'task.restored', changedFields: [], task }).fields).toEqual([]);
        });
    });

    describe('payload + signature', () => {

        test('trimTaskForDelivery whitelists fields and drops the rest', () => {
            const trimmed = trimTaskForDelivery({ _id: '1', TaskKey: 'AH-1', TaskName: 'n', secretField: 'leak', watchers: ['u'] });
            expect(trimmed.TaskKey).toBe('AH-1');
            expect(trimmed).not.toHaveProperty('secretField');
            expect(trimmed).not.toHaveProperty('watchers');
        });

        test('signPayload is deterministic and secret-dependent', () => {
            const body = JSON.stringify({ a: 1 });
            expect(signPayload('s1', body)).toBe(signPayload('s1', body));
            expect(signPayload('s1', body)).not.toBe(signPayload('s2', body));
            expect(signPayload('s1', body)).toMatch(/^sha256=[0-9a-f]{64}$/);
        });

        test('generateSecret yields unique 48-char hex', () => {
            const one = generateSecret();
            expect(one).toMatch(/^[0-9a-f]{48}$/);
            expect(generateSecret()).not.toBe(one);
        });
    });

    test('url validator accepts http and https only', () => {
        expect(isValidUrl('http://x.dev/hook')).toBe(true);
        expect(isValidUrl('https://x.dev/hook')).toBe(true);
        expect(isValidUrl('file:///etc/passwd')).toBe(false);
    });
});
