const { validateRuleV2, describeV2 } = require('../Modules/Automations/helpers/ruleSchemaV2');

const valid = () => ({
    name: 'Escalate closed stories',
    trigger: { type: 'event', event: 'task.status_changed' },
    scope: { allProjects: true },
    conditions: { op: 'changedTo', field: 'statusType', value: 'close' },
    steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }],
});

describe('v2 rule validation', () => {
    it('accepts a well-formed rule and normalises it', () => {
        const r = validateRuleV2(valid());
        expect(r.valid).toBe(true);
        expect(r.value.version).toBe(2);
        expect(r.value.scope).toEqual({ allProjects: true, projectIds: [] });
        expect(r.value.limits.maxRunsPerHour).toBe(500);
        expect(r.value.reactToAutomation).toBe(false);
    });

    it('reports field-level errors so the builder can mark the slot', () => {
        const r = validateRuleV2({ ...valid(), name: '', steps: [{ id: 's1', type: 'action', action: 'set_priority', config: {} }] });
        expect(r.valid).toBe(false);
        expect(r.errors).toContain('name: required');
        expect(r.errors).toContain('steps[0].config.priority: required by "set_priority"');
    });

    it('rejects an unknown action rather than saving a rule that can never run', () => {
        const r = validateRuleV2({ ...valid(), steps: [{ id: 's1', type: 'action', action: 'delete_everything', config: {} }] });
        expect(r.valid).toBe(false);
        expect(r.errors[0]).toMatch(/unknown action "delete_everything"/);
    });

    it('rejects an unknown trigger', () => {
        const r = validateRuleV2({ ...valid(), trigger: { type: 'event', event: 'task.exploded' } });
        expect(r.valid).toBe(false);
        expect(r.errors).toContain('trigger.event: unknown event "task.exploded"');
    });

    it('catches a "changed" condition on a trigger with no before/after', () => {
        const r = validateRuleV2({
            ...valid(),
            trigger: { type: 'event', event: 'task.created' },
            conditions: { op: 'changedTo', field: 'statusType', value: 'close' },
        });
        expect(r.valid).toBe(false);
        expect(r.errors.some((e) => /never match/.test(e))).toBe(true);
    });

    it('requires at least one step — a rule that does nothing is a bug, not a draft', () => {
        expect(validateRuleV2({ ...valid(), steps: [] }).errors).toContain('steps: at least one action is required');
    });

    it('rejects duplicate step ids, which would corrupt $sN references', () => {
        const r = validateRuleV2({ ...valid(), steps: [
            { id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } },
            { id: 's1', type: 'action', action: 'set_priority', config: { priority: 'LOW' } },
        ] });
        expect(r.errors).toContain('steps: step ids must be unique');
    });

    it('validates enum config against the action schema', () => {
        const r = validateRuleV2({ ...valid(), steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'URGENT' } }] });
        expect(r.errors.some((e) => e.includes('must be one of'))).toBe(true);
    });

    it('scopes to specific projects when asked', () => {
        const r = validateRuleV2({ ...valid(), scope: { allProjects: false, projectIds: ['507f1f77bcf86cd799439011'] } });
        expect(r.value.scope).toEqual({ allProjects: false, projectIds: ['507f1f77bcf86cd799439011'] });
    });

    it('describes a rule as the same sentence the builder shows', () => {
        expect(describeV2(valid())).toBe('Task status changes → Change priority');
    });
});
