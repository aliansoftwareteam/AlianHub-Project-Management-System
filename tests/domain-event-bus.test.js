const {
    classifyTaskEvent,
    trimTask,
    resolveActor,
    buildEnvelope,
    supersedesPending,
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

    describe('supersedesPending', () => {
        const waiting = (doc, ...changed) => ({ doc, changed: new Set(changed) });

        it('merges the echo emits one write produces — same values, nothing superseded', () => {
            const doc = { Task_Priority: 'HIGH', statusType: 'open' };
            expect(supersedesPending(waiting(doc, 'Task_Priority'), doc, fields('Task_Priority'))).toBe(false);
        });

        it('merges an emit that touches a field the pending one never claimed', () => {
            const pendingDoc = { Task_Priority: 'HIGH', groupByPriorityIndex: 1 };
            const next = { Task_Priority: 'HIGH', groupByPriorityIndex: 2 };
            expect(supersedesPending(waiting(pendingDoc, 'Task_Priority'), next, fields('groupByPriorityIndex'))).toBe(false);
        });

        it('publishes the pending change when the same field moves again — three changes are three events', () => {
            const urgent = waiting({ Task_Priority: 'URGENT' }, 'Task_Priority');
            expect(supersedesPending(urgent, { Task_Priority: 'BANANA' }, fields('Task_Priority'))).toBe(true);
        });

        it('compares arrays and subdocuments by value, not by reference', () => {
            const entry = waiting({ AssigneeUserId: ['u1'], status: { text: 'To do' } }, 'AssigneeUserId', 'status');
            expect(supersedesPending(entry, { AssigneeUserId: ['u1'], status: { text: 'To do' } }, fields('AssigneeUserId'))).toBe(false);
            expect(supersedesPending(entry, { AssigneeUserId: ['u1', 'u2'], status: { text: 'To do' } }, fields('AssigneeUserId'))).toBe(true);
            expect(supersedesPending(entry, { AssigneeUserId: ['u1'], status: { text: 'Done' } }, fields('status'))).toBe(true);
        });

        it('treats a cleared field as a change rather than as an absent one', () => {
            const entry = waiting({ Task_Leader: 'u1' }, 'Task_Leader');
            expect(supersedesPending(entry, { Task_Leader: null }, fields('Task_Leader'))).toBe(true);
            expect(supersedesPending(waiting({}, 'Task_Leader'), { Task_Leader: undefined }, fields('Task_Leader'))).toBe(false);
        });

        it('has nothing to supersede when no emit is waiting', () => {
            expect(supersedesPending(undefined, { Task_Priority: 'HIGH' }, fields('Task_Priority'))).toBe(false);
        });
    });
});
