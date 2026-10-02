import { describe, expect, it } from 'vitest';
import {
    inferAssignee,
    inferDue,
    placeOfVisits,
    preferredSprint,
    readCreated,
    rememberCreated
} from '@/components/organisms/QuickCreateTask/placeInference';

const memory = () => {
    const store = new Map();
    return { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
};
const MINUTE = 60 * 1000;

describe('the place read from recent visits', () => {
    it('is the newest project or list the person had open', () => {
        const visits = [
            { type: 'task', id: 't', projectId: 'p0', route: { projectId: 'p0', sprintId: 's0', taskId: 't' } },
            { type: 'sprint', id: 's2', projectId: 'p1', route: { projectId: 'p1', sprintId: 's2' } },
            { type: 'project', id: 'p3', projectId: 'p3', route: { projectId: 'p3', sprintId: 's9' } }
        ];
        expect(placeOfVisits(visits)).toEqual({ projectId: 'p1', sprintId: 's2' });
    });

    it('is empty when there is nothing usable', () => {
        expect(placeOfVisits([])).toBeNull();
        expect(placeOfVisits(undefined)).toBeNull();
        expect(placeOfVisits([{ type: 'doc', id: 'd', route: { pageId: 'd' } }])).toBeNull();
    });
});

describe('the last task made', () => {
    it('is kept per company and person', () => {
        const storage = memory();
        rememberCreated('c1', 'u1', { projectId: 'p1', sprintId: 's1', assigneeId: 'u2', due: '2026-10-09' }, storage, 1000);
        expect(readCreated('c1', 'u1', storage)).toEqual({ projectId: 'p1', sprintId: 's1', assigneeId: 'u2', due: '2026-10-09', at: 1000 });
        expect(readCreated('c1', 'u2', storage)).toBeNull();
        expect(readCreated('c2', 'u1', storage)).toBeNull();
    });

    it('reads as nothing when storage is missing or broken', () => {
        expect(readCreated('c1', 'u1', null)).toBeNull();
        expect(readCreated('c1', 'u1', { getItem: () => '{not json' })).toBeNull();
        expect(() => rememberCreated('c1', 'u1', { projectId: 'p1' }, { setItem() { throw new Error('full'); } })).not.toThrow();
    });
});

describe('the list', () => {
    const created = { projectId: 'p1', sprintId: 's-made' };
    const visit = { projectId: 'p1', sprintId: 's-seen' };

    it('is the one asked for, then the one on screen, then the one last seen, then the one last made', () => {
        expect(preferredSprint({ requestedId: 'a', routeSprintId: 'b', projectId: 'p1', visit, created })).toBe('a');
        expect(preferredSprint({ routeSprintId: 'b', projectId: 'p1', visit, created })).toBe('b');
        expect(preferredSprint({ projectId: 'p1', visit, created })).toBe('s-seen');
        expect(preferredSprint({ projectId: 'p1', visit: null, created })).toBe('s-made');
    });

    it('never comes from another project', () => {
        expect(preferredSprint({ projectId: 'p2', visit, created })).toBe('');
    });
});

describe('the assignee', () => {
    const created = { projectId: 'p1', assigneeId: 'u2' };

    it('is who the last task in this project went to, while they can still be picked', () => {
        expect(inferAssignee({ created, projectId: 'p1', memberIds: ['u1', 'u2'], me: 'u1' })).toBe('u2');
        expect(inferAssignee({ created, projectId: 'p1', memberIds: ['u1'], me: 'u1' })).toBe('u1');
    });

    it('keeps "nobody" when the last task had no assignee', () => {
        expect(inferAssignee({ created: { projectId: 'p1', assigneeId: '' }, projectId: 'p1', memberIds: ['u1'], me: 'u1' })).toBe('');
    });

    it('is the person themselves for a project they have not made a task in', () => {
        expect(inferAssignee({ created, projectId: 'p2', memberIds: ['u1', 'u2'], me: 'u1' })).toBe('u1');
        expect(inferAssignee({ created: null, projectId: 'p1', memberIds: ['u1'], me: 'u1' })).toBe('u1');
        expect(inferAssignee({ created: null, projectId: 'p1', memberIds: ['u2'], me: 'u1' })).toBe('');
    });
});

describe('the due date', () => {
    const now = 1_000_000_000_000;
    const base = { projectId: 'p1', due: '2026-10-09', at: now - 5 * MINUTE };

    it('carries over from a task made a few minutes ago in the same project', () => {
        expect(inferDue({ created: base, projectId: 'p1', today: '2026-10-02', now })).toBe('2026-10-09');
    });

    it('does not carry over when old, past, empty or from another project', () => {
        expect(inferDue({ created: { ...base, at: now - 45 * MINUTE }, projectId: 'p1', today: '2026-10-02', now })).toBe('');
        expect(inferDue({ created: base, projectId: 'p1', today: '2026-10-10', now })).toBe('');
        expect(inferDue({ created: { ...base, due: '' }, projectId: 'p1', today: '2026-10-02', now })).toBe('');
        expect(inferDue({ created: base, projectId: 'p2', today: '2026-10-02', now })).toBe('');
        expect(inferDue({ created: null, projectId: 'p1', today: '2026-10-02', now })).toBe('');
    });
});
