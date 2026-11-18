import { describe, it, expect } from 'vitest';
import { dueDateBuckets, dueDateCondition, restoreGroupState, sprintToLoad } from '@/views/Projects/taskGroups';

const t = (key) => key;
const DAY = 24 * 60 * 60;

const at = (iso) => new Date(`${iso}T09:30:00`);
const names = (buckets) => buckets.map((bucket) => bucket.name);
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;

describe('dueDateBuckets', () => {
    it('gives the same six groups on a Sunday and on a Wednesday', () => {
        const sunday = names(dueDateBuckets(at('2026-09-13'), t));
        const wednesday = names(dueDateBuckets(at('2026-09-16'), t));

        expect(sunday).toEqual([
            'List.due_group_overdue',
            'List.due_group_today',
            'List.due_group_tomorrow',
            'List.due_group_this_week',
            'List.due_group_later',
            'List.due_group_none'
        ]);
        expect(wednesday).toEqual(sunday);
    });

    it('never grows a group per remaining weekday', () => {
        const everyDayOfTheWeek = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']
            .map((day) => dueDateBuckets(at(day), t).length);

        expect(Math.max(...everyDayOfTheWeek)).toBe(6);
        expect(Math.min(...everyDayOfTheWeek)).toBe(5);
    });

    it('drops "This week" only when no day is left in it', () => {
        expect(names(dueDateBuckets(at('2026-09-18'), t))).not.toContain('List.due_group_this_week');
        expect(names(dueDateBuckets(at('2026-09-19'), t))).not.toContain('List.due_group_this_week');
        expect(names(dueDateBuckets(at('2026-09-17'), t))).toContain('List.due_group_this_week');
    });

    it('routes every group name through the translator', () => {
        const keys = dueDateBuckets(at('2026-09-16'), t).map((bucket) => bucket.name);

        expect(keys.every((key) => key.startsWith('List.due_group_'))).toBe(true);
    });

    it('covers the horizon without overlap or gaps', () => {
        const today = startOfDay(at('2026-09-16'));
        const buckets = dueDateBuckets(at('2026-09-16'), t);
        const bucketFor = (seconds) => buckets.find((bucket) => {
            if (bucket.operation === 'lt') return seconds <= bucket.seconds;
            if (bucket.operation === 'gt') return seconds >= bucket.seconds;
            if (bucket.operation === 'range') return seconds >= bucket.seconds && seconds < bucket.endSeconds;
            return false;
        });

        const landings = [];
        for (let offset = -3; offset <= 30; offset += 1) {
            const matches = buckets.filter((bucket) => bucketFor(today + offset * DAY) === bucket);
            expect(matches).toHaveLength(1);
            landings.push(matches[0].value);
        }

        expect(landings.slice(0, 3)).toEqual(['OVERDUE', 'OVERDUE', 'OVERDUE']);
        expect(landings[3]).toBe('TODAY');
        expect(landings[4]).toBe('TOMORROW');
        expect(landings[5]).toBe('THIS_WEEK');
        expect(landings.at(-1)).toBe('NEXT');
    });

    it('keeps the "NEXT" and "NO_DUE_DATE" tokens the drag guards refuse to drop into', () => {
        const values = dueDateBuckets(at('2026-09-16'), t).map((bucket) => bucket.value);

        expect(values).toContain('NEXT');
        expect(values).toContain('NO_DUE_DATE');
    });

    it('keeps a distinct searchValue per group so the live task counter cannot collide', () => {
        const buckets = dueDateBuckets(at('2026-09-13'), t);
        const searchValues = buckets.map((bucket) => (bucket.value === 'NO_DUE_DATE' ? 0 : bucket.seconds));

        expect(new Set(searchValues).size).toBe(searchValues.length);
    });

    it('keeps the English names the task store matches due-date groups on', () => {
        const buckets = dueDateBuckets(at('2026-09-13'), t);

        expect(buckets.map((bucket) => bucket.matchName)).toContain('Overdue');
        expect(buckets.map((bucket) => bucket.matchName)).toContain('Next');
    });
});

describe('dueDateCondition', () => {
    it('sends real dates to mongo for every operation, not raw second counts', () => {
        const buckets = dueDateBuckets(at('2026-09-16'), t);
        const dated = buckets.filter((bucket) => bucket.operation !== 'non');

        dated.forEach((bucket) => {
            const bounds = dueDateCondition(bucket, 'DueDate').DueDate.dbDate;
            Object.values(bounds).forEach((bound) => {
                expect(bound).toBeInstanceOf(Date);
                expect(bound.getFullYear()).toBe(2026);
            });
        });
    });

    it('bounds a ranged group at both ends', () => {
        const today = dueDateBuckets(at('2026-09-16'), t).find((bucket) => bucket.value === 'TODAY');
        const { $gte, $lt } = dueDateCondition(today, 'DueDate').DueDate.dbDate;

        expect($lt.getTime() - $gte.getTime()).toBe(DAY * 1000);
    });

    it('matches tasks with no due date on null', () => {
        const none = dueDateBuckets(at('2026-09-16'), t).find((bucket) => bucket.value === 'NO_DUE_DATE');

        expect(dueDateCondition(none, 'DueDate')).toEqual({ DueDate: null });
    });
});

const sprint = (id, isExpanded, items) => ({ id, isExpanded, items });
const group = (key, name, isExpanded, tasksArray = []) => ({ key, name, isExpanded, tasksArray });

describe('restoreGroupState', () => {
    it('keeps a sprint the user collapsed collapsed when the groups are rebuilt', () => {
        const previous = [sprint('s1', false, [group('todo', 'Todo', true)]), sprint('s2', true, [group('todo', 'Todo', true)])];
        const rebuilt = [sprint('s1', true, [group('todo', 'Todo', true)]), sprint('s2', false, [group('todo', 'Todo', true)])];

        restoreGroupState(rebuilt, previous, 'kanbanIndex');

        expect(rebuilt.map((item) => item.isExpanded)).toEqual([false, true]);
    });

    it('keeps a status group the user collapsed collapsed', () => {
        const previous = [sprint('s1', true, [group('todo', 'Todo', false), group('done', 'Done', true)])];
        const rebuilt = [sprint('s1', true, [group('todo', 'Todo', true), group('done', 'Done', true)])];

        restoreGroupState(rebuilt, previous, 'kanbanIndex');

        expect(rebuilt[0].items.map((item) => item.isExpanded)).toEqual([false, true]);
    });

    it('collapses only the assignee group the user collapsed, though every group is named "Assignee"', () => {
        const previous = [sprint('s1', true, [
            group('0_0_Assignee', 'Assignee', true),
            group('0_1_Assignee', 'Assignee', false),
            group('0_2_Assignee', 'Assignee', true)
        ])];
        const rebuilt = [sprint('s1', true, [
            group('0_0_Assignee', 'Assignee', true),
            group('0_1_Assignee', 'Assignee', true),
            group('0_2_Assignee', 'Assignee', true)
        ])];

        restoreGroupState(rebuilt, previous, 'groupByAssigneeIndex');

        expect(rebuilt[0].items.map((item) => item.isExpanded)).toEqual([true, false, true]);
    });

    it('leaves a sprint the user has never seen alone', () => {
        const rebuilt = [sprint('s9', true, [group('todo', 'Todo', true)])];

        restoreGroupState(rebuilt, [sprint('s1', false, [])], 'kanbanIndex');

        expect(rebuilt[0].isExpanded).toBe(true);
    });

    it('numbers tasks that arrive without an order index', () => {
        const rebuilt = [sprint('s1', true, [group('todo', 'Todo', true, [{ id: 'a' }, { id: 'b' }])])];

        restoreGroupState(rebuilt, [sprint('s1', true, [group('todo', 'Todo', true, [])])], 'kanbanIndex');

        expect(rebuilt[0].items[0].tasksArray.map((task) => task.kanbanIndex)).toEqual([0, 1]);
    });

    it('survives a group whose tasks carry no subtask array', () => {
        const rebuilt = [sprint('s1', true, [group('todo', 'Todo', true, [{ id: 'a' }])])];
        const previous = [sprint('s1', true, [group('todo', 'Todo', true, [{ id: 'a', isExpanded: true }])])];

        expect(() => restoreGroupState(rebuilt, previous, 'kanbanIndex')).not.toThrow();
        expect(rebuilt[0].items[0].tasksArray[0].isExpanded).toBe(true);
    });
});

describe('sprintToLoad', () => {
    it('loads the sprint the user left open rather than reopening the first one', () => {
        const sprints = [sprint('s1', false, []), sprint('s2', true, []), sprint('s3', false, [])];

        expect(sprintToLoad(sprints, true).id).toBe('s2');
        expect(sprints[0].isExpanded).toBe(false);
    });

    it('opens the first sprint when the user has none open', () => {
        const sprints = [sprint('s1', false, []), sprint('s2', false, [])];

        expect(sprintToLoad(sprints, true).id).toBe('s1');
        expect(sprints[0].isExpanded).toBe(true);
    });

    it('does not open an archived first sprint', () => {
        const sprints = [{ ...sprint('s1', false, []), deletedStatusKey: 2 }];

        expect(sprintToLoad(sprints, true).id).toBe('s1');
        expect(sprints[0].isExpanded).toBe(false);
    });

    it('opens nothing when the caller is not fetching tasks', () => {
        const sprints = [sprint('s1', false, [])];

        expect(sprintToLoad(sprints, false).id).toBe('s1');
        expect(sprints[0].isExpanded).toBe(false);
    });
});
