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
    trimTaskForDelivery,
    signPayload,
    generateSecret,
    normalizeFormat,
    formatForTarget,
} = require('../Modules/Webhooks/helpers/webhookRules');

describe('webhook format presets', () => {
    const body = {
        event: 'task.updated',
        companyId: 'c1',
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

    test('slack format produces text + blocks with the task details', () => {
        const out = formatForTarget('slack', body);
        expect(out.text).toContain('AHE-1');
        expect(Array.isArray(out.blocks)).toBe(true);
        const rendered = JSON.stringify(out);
        expect(rendered).toContain('Task updated');
        expect(rendered).toContain('In Progress');
        expect(rendered).toContain('HIGH');
    });

    test('discord format produces an embed with status/priority/due fields', () => {
        const out = formatForTarget('discord', body);
        expect(Array.isArray(out.embeds)).toBe(true);
        expect(out.embeds[0].title).toContain('Fix login');
        const names = out.embeds[0].fields.map((f) => f.name);
        expect(names).toEqual(expect.arrayContaining(['Status', 'Priority', 'Due']));
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

        test('everything else is task.updated; missing doc is null', () => {
            expect(classifyTaskEvent({ type: 'update', doc, updatedFields: { TaskName: 'x' }, now })).toBe('task.updated');
            expect(classifyTaskEvent({ type: 'update', doc: null, updatedFields: {}, now })).toBe(null);
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
