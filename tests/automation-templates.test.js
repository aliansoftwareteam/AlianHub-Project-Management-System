const path = require('path');
const registry = require('../Modules/Automations/engine/registry');
const { TEMPLATES, CATEGORIES, FILL_KINDS, fillTemplate } = require('../Modules/Automations/templates');
const { validateRuleV2 } = require('../Modules/Automations/helpers/ruleSchemaV2');
const { loadLocale, flatten } = require('../scripts/i18n-check');

const en = flatten(loadLocale(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js')));
const translate = (key) => en[key];

const PROJECTS = [
    { _id: 'p1', taskStatusData: [{ key: 1, name: 'To do', type: 'default_active' }, { key: 2, name: 'Doing', type: 'active' }, { key: 3, name: 'Shipped', type: 'close' }] },
    { _id: 'p2', taskStatusData: [{ convertStatus: { key: 7, name: 'Open', type: 'default_active' } }, { convertStatus: { key: 9, name: 'Complete', type: 'close' } }] },
];
const PEOPLE = ['64b000000000000000000001', '64b000000000000000000002'];

const isFill = (node) => node !== null && typeof node === 'object' && !Array.isArray(node) && typeof node.fill === 'string';

const conditionNodes = (node) => {
    if (!node || !node.op) return [];
    return node.op === 'and' || node.op === 'or' ? node.args.flatMap(conditionNodes) : [node];
};

const fillsIn = (node, found = []) => {
    if (Array.isArray(node)) node.forEach((n) => fillsIn(n, found));
    else if (isFill(node)) found.push(node);
    else if (node !== null && typeof node === 'object') Object.values(node).forEach((n) => fillsIn(n, found));
    return found;
};

/* The builder leaves the people for the person to pick; these stand in for that pick. */
const withPeople = (rule) => ({
    ...rule,
    steps: rule.steps.map((s) => (s.action === 'assign' && !s.config.userIds.length
        ? { ...s, config: { ...s.config, userIds: s.config.roundRobin ? PEOPLE : PEOPLE.slice(0, 1) } }
        : s)),
});

describe('automation rule templates', () => {
    it('offers a gallery worth browsing, one id per template', () => {
        expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
        const ids = TEMPLATES.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(TEMPLATES.map((t) => t.category)).size).toBe(CATEGORIES.length);
    });

    it('names every category in en.js', () => {
        CATEGORIES.forEach((c) => expect(typeof en[`AutomationTemplates.category_${c}`]).toBe('string'));
    });

    describe.each(TEMPLATES.map((t) => [t.id, t]))('%s', (_id, template) => {
        const trigger = registry.TRIGGERS.find((t) => t.key === template.rule.trigger.event);

        it('sits in a known category with a name and description in en.js', () => {
            expect(CATEGORIES).toContain(template.category);
            expect(typeof en[template.nameKey]).toBe('string');
            expect(typeof en[template.descriptionKey]).toBe('string');
        });

        it('starts from an event trigger the bus publishes', () => {
            expect(trigger).toBeTruthy();
            expect(template.rule.trigger.type).toBe('event');
        });

        it('reads only condition fields and operators the registry offers for that trigger', () => {
            const fields = registry.manifest().conditionFieldsByEntity[trigger.entity] || [];
            conditionNodes(template.rule.conditions).forEach((node) => {
                const field = fields.find((f) => f.field === node.field);
                expect(field).toBeTruthy();
                expect(field.ops).toContain(node.op);
                if (field.options && !isFill(node.value)) expect(field.options).toContain(node.value);
            });
        });

        it('uses only actions in the registry', () => {
            template.rule.steps.forEach((step) => expect(registry.hasAction(step.action)).toBe(true));
        });

        it('holds placeholders only of kinds the builder fills, and only where they belong', () => {
            fillsIn(template.rule).forEach((node) => {
                expect(FILL_KINDS).toContain(node.fill);
                if (node.fill === 'text') expect(typeof en[node.key]).toBe('string');
            });
            conditionNodes(template.rule.conditions).filter((n) => isFill(n.value)).forEach((n) => {
                expect(n.value.fill).toBe('status');
                expect(n.field).toBe('statusRef');
            });
        });

        it.each([['one project', 'p1'], ['every project', '']])('saves once filled for %s', (_label, projectId) => {
            const rule = withPeople(fillTemplate(template, { projects: PROJECTS, projectId, translate }));
            expect(fillsIn(rule)).toEqual([]);
            const result = validateRuleV2(rule);
            expect(result.errors).toEqual([]);
            expect(result.valid).toBe(true);
        });
    });

    it('holds a status condition as a statusRef placeholder, never a fixed key', () => {
        const statusNodes = TEMPLATES.flatMap((t) => conditionNodes(t.rule.conditions)).filter((n) => n.field === 'statusRef');
        expect(statusNodes.length).toBeGreaterThan(0);
        statusNodes.forEach((n) => expect(isFill(n.value)).toBe(true));
    });
});

describe('the recipes that needed the due date and subtask triggers and the notify action', () => {
    const byId = (id) => TEMPLATES.find((t) => t.id === id);
    const filled = (id, projectId = 'p1') => fillTemplate(byId(id), { projects: PROJECTS, projectId, translate });

    it('raises the priority when a due date passes', () => {
        const rule = filled('overdue_priority');
        expect(byId('overdue_priority').category).toBe('dates');
        expect(rule.trigger).toEqual({ type: 'event', event: 'task.due_date_passed' });
        expect(rule.steps).toEqual([{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }]);
    });

    it('moves the parent to the chosen project\'s done status when all its subtasks are done', () => {
        expect(byId('subtasks_done_close_parent').category).toBe('subtasks');
        expect(filled('subtasks_done_close_parent').trigger.event).toBe('task.subtasks_all_done');
        expect(filled('subtasks_done_close_parent', 'p1').steps[0]).toMatchObject({ action: 'set_status', config: { status: 'Shipped' } });
        expect(filled('subtasks_done_close_parent', 'p2').steps[0].config.status).toBe('Complete');
    });

    it('names a status in the reader\'s language when no project has one of that type', () => {
        const rule = fillTemplate(byId('subtasks_done_close_parent'), { projects: [], projectId: '', translate });
        expect(rule.steps[0].config.status).toBe(en['AutomationTemplates.status_done']);
    });

    it('notifies the creator when a task is done', () => {
        const rule = filled('done_notify_creator');
        expect(byId('done_notify_creator').category).toBe('status');
        expect(rule.trigger.event).toBe('task.status_changed');
        expect(rule.steps[0]).toMatchObject({ action: 'notify', config: { recipients: ['task_creator'], message: en['AutomationTemplates.done_notify_creator_text'] } });
    });

    it('keeps the recipes that stood in for them', () => {
        ['due_date_moved_priority', 'parent_done_comment', 'done_back_to_creator'].forEach((id) => expect(byId(id)).toBeDefined());
    });
});

describe('filling a template', () => {
    const doneTemplate = () => TEMPLATES.find((t) => conditionNodes(t.rule.conditions).some((n) => n.field === 'statusRef' && n.value.type === 'close'));

    it('fills a status placeholder from the chosen project\'s own status of that type', () => {
        const rule = fillTemplate(doneTemplate(), { projects: PROJECTS, projectId: 'p1', translate });
        const node = conditionNodes(rule.conditions).find((n) => n.field === 'statusRef');
        expect(node.value).toEqual(['p1:3']);
        expect(node.label).toBe('Shipped');
        expect(rule.scope).toEqual({ allProjects: false, projectIds: ['p1'] });
    });

    it('carries every project\'s key when the rule covers every project', () => {
        const rule = fillTemplate(doneTemplate(), { projects: PROJECTS, projectId: '', translate });
        const node = conditionNodes(rule.conditions).find((n) => n.field === 'statusRef');
        expect(node.value).toEqual(['p1:3', 'p2:9']);
        expect(rule.scope).toEqual({ allProjects: true, projectIds: [] });
    });

    it('falls back to the status type when no project has a status to name, rather than dropping the condition', () => {
        const rule = fillTemplate(doneTemplate(), { projects: [], projectId: '', translate });
        const node = conditionNodes(rule.conditions).find((n) => n.field === 'statusRef' || n.field === 'statusType');
        expect(node).toEqual({ op: 'changedTo', field: 'statusType', value: 'close' });
    });

    it('writes text in the reader\'s language and leaves people for the person to pick', () => {
        TEMPLATES.forEach((template) => {
            const rule = fillTemplate(template, { projects: PROJECTS, projectId: 'p1', translate: (key) => `[${key}]` });
            rule.steps.forEach((step) => {
                Object.values(step.config).filter((v) => typeof v === 'string' && v.startsWith('[')).forEach((v) => expect(v).toMatch(/^\[AutomationTemplates\./));
                if (step.action === 'assign') expect(Array.isArray(step.config.userIds)).toBe(true);
            });
        });
    });

    it('never changes the template it filled', () => {
        const before = JSON.stringify(TEMPLATES);
        TEMPLATES.forEach((template) => fillTemplate(template, { projects: PROJECTS, projectId: 'p1', translate }));
        expect(JSON.stringify(TEMPLATES)).toBe(before);
    });
});
