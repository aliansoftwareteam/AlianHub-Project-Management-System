/* Task 046 M3, slice G3: what the Goals page works out for itself. Progress is never among it: the
   numbers on screen are the server's. */
import { describe, expect, it } from 'vitest';
import {
    addTargetRequest, afterHandover, checkGoal, checkTarget, editTargetRequest, errorKey, fieldOf, groupGoals, isReached, kindOf, periodBucket, rangeOf, reachedCount,
    refusalKey, refusedSources, sourceCount, sourcesRequest, todayOf, withoutSources
} from '@/views/Goals/goalRequest';
import en from '@/locales/en';

const TODAY = '2026-10-15';
const ids = (n) => Array.from({ length: n }, (_, index) => `id-${index}`);
const goal = (name, periodStart, periodEnd, over = {}) => ({ _id: name, name, periodStart, periodEnd, progressPct: 0, targets: [], ...over });

describe('the period a goal is listed under', () => {
    it.each([
        ['runs across today', '2026-10-01', '2026-12-31', 'current'],
        ['starts today', TODAY, '2026-12-31', 'current'],
        ['ends today', '2026-07-01', TODAY, 'current'],
        ['has started and has no end', '2026-01-01', '', 'current'],
        ['has only an end, still ahead', '', '2026-12-31', 'current'],
        ['starts later', '2027-01-01', '2027-03-31', 'upcoming'],
        ['starts later with no end', '2027-01-01', '', 'upcoming'],
        ['has ended', '2026-07-01', '2026-09-30', 'past'],
        ['has only an end, behind', '', '2026-09-30', 'past'],
        ['has no dates', '', '', 'none']
    ])('a goal that %s is %s', (_, start, end, bucket) => {
        expect(periodBucket(goal('g', start, end), TODAY)).toBe(bucket);
    });

    it('is worked out from the day where the person is, not the day in UTC', () => {
        expect(todayOf(new Date(2026, 9, 15, 0, 30))).toBe('2026-10-15');
        expect(todayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    });
});

describe('the groups', () => {
    const goals = [
        goal('Alpha', '2026-10-01', '2026-12-31', { progressPct: 10 }),
        goal('Beta', '', '', { progressPct: 0 }),
        goal('Gamma', '2026-10-01', '2026-12-31', { progressPct: 80 }),
        goal('Delta', '2026-01-01', '2026-03-31', { progressPct: 100 }),
        goal('Omega', '2026-09-01', '', { progressPct: 80 })
    ];

    it('come in the order current, upcoming, past, no dates, and an empty one is left out', () => {
        expect(groupGoals(goals, TODAY).map((group) => [group.id, group.goals.map((entry) => entry.name)])).toEqual([
            ['current', ['Alpha', 'Gamma', 'Omega']],
            ['past', ['Delta']],
            ['none', ['Beta']]
        ]);
    });

    it('keep the server\'s order by name, or put the furthest along first', () => {
        const [current] = groupGoals(goals, TODAY, 'progress');
        expect(current.goals.map((entry) => entry.name)).toEqual(['Gamma', 'Omega', 'Alpha']);
    });
});

describe('a target', () => {
    it('counts as reached from the server\'s own mark or its percentage', () => {
        expect(isReached({ reachedAt: '2026-10-01T00:00:00.000Z', progressPct: 100 })).toBe(true);
        expect(isReached({ reachedAt: null, progressPct: 100 })).toBe(true);
        expect(isReached({ reachedAt: null, progressPct: 99 })).toBe(false);
        expect(reachedCount({ targets: [{ progressPct: 100 }, { progressPct: 30 }, { reachedAt: 'x' }] })).toBe(2);
        expect(reachedCount({})).toBe(0);
    });

    it('is drawn by what kind it is, and a kind this build does not know is only read', () => {
        expect(['number', 'currency', 'boolean', 'tasks', 'formula', undefined].map((kind) => kindOf({ kind }))).toEqual(['measured', 'measured', 'flag', 'counted', 'other', 'other']);
    });

    it('reads downwards when its target is below its start', () => {
        expect(rangeOf({ kind: 'number', start: 0, target: 10 })).toBe('up');
        expect(rangeOf({ kind: 'number', start: 40, target: 10 })).toBe('down');
    });
});

describe('what a form checks before it asks the server', () => {
    it('a goal needs a name of 1 to 120 characters, and an end that is not before its start', () => {
        expect(checkGoal({ name: 'Grow revenue' })).toEqual({});
        expect(checkGoal({ name: '   ' })).toEqual({ name: 'Goals.error_name' });
        expect(checkGoal({ name: 'x'.repeat(121) })).toEqual({ name: 'Goals.error_name' });
        expect(checkGoal({ description: 'x'.repeat(2001) })).toEqual({ description: 'Goals.error_description' });
        expect(checkGoal({ name: 'Ok', periodStart: '2026-12-31', periodEnd: '2026-10-01' })).toEqual({ periodEnd: 'Goals.error_periodEnd' });
        expect(checkGoal({ name: 'Ok', periodStart: '2026-10-01', periodEnd: '' })).toEqual({});
    });

    it('a measured target needs a name, a target that is a number and differs from its start, and a weight from 1 to 100', () => {
        const form = { kind: 'number', name: 'New customers', start: '0', target: '10', current: '', unit: 'customers', weight: '1' };
        expect(checkTarget(form)).toEqual({});
        expect(checkTarget({ ...form, name: '' })).toEqual({ name: 'Goals.error_name' });
        expect(checkTarget({ ...form, target: '' })).toEqual({ target: 'Goals.error_target_required' });
        expect(checkTarget({ ...form, target: 'ten' })).toEqual({ target: 'Goals.error_number' });
        expect(checkTarget({ ...form, start: '10' })).toEqual({ target: 'Goals.error_target' });
        expect(checkTarget({ ...form, start: '', target: '0' })).toEqual({ target: 'Goals.error_target' });
        expect(checkTarget({ ...form, weight: '0' })).toEqual({ weight: 'Goals.error_weight' });
        expect(checkTarget({ ...form, weight: '1.5' })).toEqual({ weight: 'Goals.error_weight' });
        expect(checkTarget({ ...form, weight: '101' })).toEqual({ weight: 'Goals.error_weight' });
        expect(checkTarget({ ...form, unit: 'x'.repeat(21) })).toEqual({ unit: 'Goals.error_unit' });
        expect(checkTarget({ ...form, kind: 'currency', currencyCode: '' })).toEqual({ currencyCode: 'Goals.error_currencyCode' });
    });

    it('a true-or-false target needs only a name and a weight', () => {
        expect(checkTarget({ kind: 'boolean', name: 'Launched', weight: '1', target: '' })).toEqual({});
    });

    it('a target counted from tasks may link nothing, and at most 20 lists and 100 tasks', () => {
        const form = { kind: 'tasks', name: 'Release tasks', weight: '1' };
        expect(checkTarget(form)).toEqual({});
        expect(checkTarget({ ...form, sources: { sprintIds: ids(20), taskIds: ids(100) } })).toEqual({});
        expect(checkTarget({ ...form, sources: { sprintIds: ids(21), taskIds: [] } })).toEqual({ sources: 'Goals.sources_lists_full' });
        expect(checkTarget({ ...form, sources: { sprintIds: [], taskIds: ids(101) } })).toEqual({ sources: 'Goals.sources_tasks_full' });
    });
});

describe('the lists and tasks a target is counted from', () => {
    const stored = { id: 't1', kind: 'tasks', name: 'Release tasks', weight: 1, sources: { sprintIds: ['a', 'b'], taskIds: ['x'] } };

    it('go with a new target as a whole set, each named once', () => {
        expect(addTargetRequest('g1', { kind: 'tasks', name: ' Release  tasks ', weight: '', sources: { sprintIds: ['a', 'a', 'b'], taskIds: ['x'] }, target: '9', unit: 'km' }).body)
            .toEqual({ kind: 'tasks', name: 'Release tasks', weight: 1, sources: { sprintIds: ['a', 'b'], taskIds: ['x'] } });
        expect(addTargetRequest('g1', { kind: 'tasks', name: 'Later', weight: '2' }).body).toEqual({ kind: 'tasks', name: 'Later', weight: 2, sources: { sprintIds: [], taskIds: [] } });
    });

    it('are sent again only when the set differs, and then whole', () => {
        expect(editTargetRequest('g1', stored, { name: 'Release tasks', weight: '1', sources: { sprintIds: ['b', 'a'], taskIds: ['x'] } }).body).toEqual({});
        expect(editTargetRequest('g1', stored, { name: 'Release tasks', weight: '3', sources: { sprintIds: ['a'], taskIds: ['x', 'y'] } }).body)
            .toEqual({ weight: 3, sources: { sprintIds: ['a'], taskIds: ['x', 'y'] } });
        expect(sourcesRequest('g1', stored, { sprintIds: ['a'] })).toEqual({ method: 'patch', path: '/api/v2/goals/g1/targets/t1', body: { sources: { sprintIds: ['a'], taskIds: [] } } });
    });

    it('can be taken out, a set at a time', () => {
        expect(withoutSources(stored.sources, { sprintIds: ['b'] })).toEqual({ sprintIds: ['a'], taskIds: ['x'] });
        expect(withoutSources(stored.sources, { sprintIds: ['a', 'b'], taskIds: ['x', 'z'] })).toEqual({ sprintIds: [], taskIds: [] });
        expect(withoutSources(undefined, undefined)).toEqual({ sprintIds: [], taskIds: [] });
        expect(sourceCount(stored.sources)).toBe(3);
        expect(sourceCount(undefined)).toBe(0);
    });
});

describe('what the server refuses', () => {
    it('is said in the page\'s own words, by the field it names', () => {
        expect(errorKey('periodEnd')).toBe('Goals.error_periodEnd');
        expect(errorKey('targets.1.currencyCode')).toBe('Goals.error_currencyCode');
        expect(errorKey('sharedWith')).toBe('Goals.error_sharedWith');
        expect(errorKey('something new')).toBe('Goals.error_generic');
        expect(errorKey(undefined)).toBe('Goals.error_generic');
        expect(errorKey('sources.sprintIds')).toBe('Goals.error_sources');
        expect(fieldOf('sources.taskIds.4')).toBe('sources');
        expect(fieldOf('targets.1.kind')).toBe('kind');
    });

    it.each([
        ['source_not_found', 'sources.sprintIds.1'],
        ['source_not_shared', 'sources.taskIds.0'],
        ['sources_would_drop', 'visibility'],
        ['counted_from_tasks', 'current']
    ])('has a message of its own when the server gives the reason: %s', (code, field) => {
        expect(refusalKey({ code, field })).toBe(`Goals.error_${code}`);
        expect(en.Goals[`error_${code}`]).toEqual(expect.any(String));
    });

    it('falls back to the field when the reason is one the page does not know', () => {
        expect(refusalKey({ code: 'brand_new', field: 'weight' })).toBe('Goals.error_weight');
        expect(refusalKey({ field: 'sharedWith' })).toBe('Goals.error_sharedWith');
    });

    it('names the sources at fault: the ones it lists, or the one at the place it points to in what was sent', () => {
        const sent = { sprintIds: ['a', 'b'], taskIds: ['x', 'y'] };
        expect(refusedSources({ code: 'source_not_shared', field: 'sources.sprintIds.0', sources: { sprintIds: ['b'], taskIds: ['y'] } }, sent)).toEqual({ sprintIds: ['b'], taskIds: ['y'] });
        expect(refusedSources({ code: 'source_not_found', field: 'sources.sprintIds.1' }, sent)).toEqual({ sprintIds: ['b'], taskIds: [] });
        expect(refusedSources({ code: 'source_not_found', field: 'targets.0.sources.taskIds.0' }, sent)).toEqual({ sprintIds: [], taskIds: ['x'] });
        expect(refusedSources({ field: 'sources.sprintIds' }, sent)).toEqual({ sprintIds: [], taskIds: [] });
        expect(refusedSources({ field: 'name' }, sent)).toEqual({ sprintIds: [], taskIds: [] });
    });
});

describe('handing a goal to someone else', () => {
    const ME = 'me';
    it('takes a private goal out of sight', () => {
        expect(afterHandover({ visibility: 'private', sharedWith: [] }, { myId: ME, privileged: true })).toEqual({ sees: false, edits: false });
    });
    it('keeps a goal shared with people in sight only for someone named on it', () => {
        expect(afterHandover({ visibility: 'people', sharedWith: ['sam'] }, { myId: ME, privileged: false })).toEqual({ sees: false, edits: false });
        expect(afterHandover({ visibility: 'people', sharedWith: ['sam', ME] }, { myId: ME, privileged: false })).toEqual({ sees: true, edits: false });
    });
    it('leaves a workspace goal in sight, and editable only by an owner or admin', () => {
        expect(afterHandover({ visibility: 'workspace', sharedWith: [] }, { myId: ME, privileged: false })).toEqual({ sees: true, edits: false });
        expect(afterHandover({ visibility: 'workspace', sharedWith: [] }, { myId: ME, privileged: true })).toEqual({ sees: true, edits: true });
    });
});
