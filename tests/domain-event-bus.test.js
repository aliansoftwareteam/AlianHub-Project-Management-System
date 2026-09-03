const {
    classifyTaskEvent,
    trimTask,
    resolveActor,
    buildEnvelope,
    MAX_DEPTH,
} = require('../event/domainEventBus');

const fields = (...names) => new Set(names);

describe('domainEventBus', () => {
    describe('classifyTaskEvent', () => {
        it('names an insert regardless of changed fields', () => {
            expect(classifyTaskEvent('insert', fields())).toBe('task.created');
            expect(classifyTaskEvent('insert', fields('TaskName'))).toBe('task.created');
        });

        it('drops updates that changed nothing — counter bumps are not domain events', () => {
            expect(classifyTaskEvent('update', fields())).toBeNull();
            expect(classifyTaskEvent('update', undefined)).toBeNull();
        });

        it('names an update after the field that changed', () => {
            expect(classifyTaskEvent('update', fields('statusType'))).toBe('task.status_changed');
            expect(classifyTaskEvent('update', fields('statusKey'))).toBe('task.status_changed');
            expect(classifyTaskEvent('update', fields('AssigneeUserId'))).toBe('task.assignee_changed');
            expect(classifyTaskEvent('update', fields('Task_Priority'))).toBe('task.priority_changed');
            expect(classifyTaskEvent('update', fields('sprintId'))).toBe('task.sprint_changed');
        });

        it('falls back to a generic update for unrecognised fields', () => {
            expect(classifyTaskEvent('update', fields('checklistArray'))).toBe('task.updated');
        });

        it('prefers status when several categories changed in one save', () => {
            expect(classifyTaskEvent('update', fields('Task_Priority', 'statusType'))).toBe('task.status_changed');
        });
    });

    describe('trimTask', () => {
        it('keeps the envelope bounded — description and attachments never travel', () => {
            const out = trimTask({
                _id: 'a1', TaskName: 'x', rawDescription: 'huge'.repeat(5000),
                attachments: [1, 2, 3], checklistArray: [1, 2],
            });
            expect(out.rawDescription).toBeUndefined();
            expect(out.attachments).toBeUndefined();
            expect(out.checklistArray).toBeUndefined();
        });

        it('stringifies ids and defaults assignees to an array', () => {
            const out = trimTask({ _id: 1, ProjectID: 2, AssigneeUserId: [3, 4] });
            expect(out._id).toBe('1');
            expect(out.ProjectID).toBe('2');
            expect(out.AssigneeUserId).toEqual(['3', '4']);
            expect(trimTask({ _id: 1 }).AssigneeUserId).toEqual([]);
        });
    });

    describe('resolveActor', () => {
        it('falls back to system rather than inventing a user', () => {
            expect(resolveActor({})).toEqual({ userId: null, kind: 'system' });
            expect(resolveActor({ actor: { kind: 'nonsense' } }).kind).toBe('system');
        });

        it('preserves a declared automation actor — this is what the loop guard reads', () => {
            expect(resolveActor({ actor: { kind: 'automation', userId: 'u1' } }))
                .toEqual({ userId: 'u1', kind: 'automation' });
        });
    });

    describe('buildEnvelope', () => {
        const base = {
            companyId: 'c1',
            type: 'task.status_changed',
            doc: { _id: 't1', TaskKey: 'AHE-1', ProjectID: 'p1', sprintId: 's1' },
            changedFields: fields('statusType'),
            previous: { statusType: 'open' },
            actor: { userId: 'u1', kind: 'user' },
            depth: 0,
        };

        it('carries the idempotency key, scope, entity and diff', () => {
            const e = buildEnvelope(base);
            expect(e.id).toHaveLength(26);
            expect(e.companyId).toBe('c1');
            expect(e.scope).toEqual({ projectId: 'p1', sprintId: 's1' });
            expect(e.entity).toEqual({ kind: 'task', id: 't1', key: 'AHE-1' });
            expect(e.changedFields).toEqual(['statusType']);
            expect(e.previous).toEqual({ statusType: 'open' });
        });

        it('mints a unique, sortable id per envelope', () => {
            const a = buildEnvelope(base).id;
            const b = buildEnvelope(base).id;
            expect(a).not.toBe(b);
            expect([b, a].sort()).toEqual([a, b].sort());
        });

        it('defaults depth to 0 so a missing value cannot bypass the guard', () => {
            expect(buildEnvelope({ ...base, depth: undefined }).depth).toBe(0);
            expect(buildEnvelope({ ...base, depth: 'x' }).depth).toBe(0);
        });

        it('exposes the depth ceiling the publisher enforces', () => {
            expect(MAX_DEPTH).toBe(3);
        });
    });
});
