/* Task 047, AI-6: what the daily look finds in a project. Every finding is a rule over stored rows; no model is asked. */
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(() => { throw new Error('a rule reads no database'); }) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const rules = require('../Modules/Agents/manager/rules');

const { RULE, STALE_WORKING_DAYS, QUIET_BLOCKER_WORKING_DAYS, HOURS_PER_DAY } = rules;

const WEEK = [1, 2, 3, 4, 5];
const NOW = new Date('2026-10-07T09:00:00Z');
const day = (ymd) => new Date(`${ymd}T00:00:00Z`);
const P = '6f0000000000000000000d01';
const LIST = '6f0000000000000000000e01';
const PRIYA = '6f0000000000000000000004';

let seq = 0;
const task = (over = {}) => {
    seq += 1;
    const n = String(seq).padStart(3, '0');
    return {
        _id: `6f0000000000000000000${n}`, TaskKey: `AP-${seq}`, TaskName: `Task ${seq}`, ProjectID: P, sprintId: LIST,
        statusType: 'active', status: { text: 'In Progress', type: 'active' }, AssigneeUserId: [PRIYA], totalEstimatedTime: 120,
        updatedAt: day('2026-10-06'), createdAt: day('2026-09-01'), relations: [], ...over,
    };
};
const waitsOn = (blocker) => [{ taskId: blocker._id, type: 'blocked_by' }];
const found = (tasks, extra = {}) => rules.findingsOf({ tasks, blockers: [], plans: [], pto: [], now: NOW, week: WEEK, ...extra });
const ofRule = (list, rule) => list.filter((finding) => finding.rule === rule);

beforeEach(() => { seq = 0; });

describe('working days', () => {
    it('counts the days a project works between a change and now, and leaves its rest days out', () => {
        expect(rules.workingDaysSince(day('2026-10-06'), NOW, WEEK)).toBe(1);
        expect(rules.workingDaysSince(day('2026-10-02'), NOW, WEEK)).toBe(3);
        expect(rules.workingDaysSince(day('2026-09-30'), NOW, WEEK)).toBe(5);
        expect(rules.workingDaysSince(day('2026-09-30'), NOW, [0, 1, 2, 3, 4, 5, 6])).toBe(7);
        expect(rules.workingDaysSince(NOW, NOW, WEEK)).toBe(0);
        expect(rules.workingDaysSince(null, NOW, WEEK)).toBe(0);
    });

    it('looks on a working day and rests on the others', () => {
        expect(rules.isWorkingDay(NOW, WEEK)).toBe(true);
        expect(rules.isWorkingDay(day('2026-10-10'), WEEK)).toBe(false);
        expect(rules.isWorkingDay(day('2026-10-10'), [6])).toBe(true);
    });
});

describe('a date is slipping', () => {
    it('finds a task past its due date, with the days', () => {
        const late = task({ DueDate: day('2026-10-04') });
        const [finding] = ofRule(found([late]), RULE.SLIPPING);
        expect(finding).toMatchObject({ key: `slipping:${late._id}:overdue`, taskId: late._id, taskIds: [late._id], facts: { taskKey: 'AP-1', daysLate: 3 } });
        expect(finding.fix).toBeUndefined();
    });

    it('leaves a task due today, a closed one and one with no date alone', () => {
        const list = [task({ DueDate: day('2026-10-07') }), task({ DueDate: day('2026-10-01'), statusType: 'close' }), task()];
        expect(ofRule(found(list), RULE.SLIPPING)).toEqual([]);
    });

    it('finds a task whose blocker now ends after it starts, and offers to move it by those days', () => {
        const blocker = task({ DueDate: day('2026-10-12') });
        const waiting = task({ startDate: day('2026-10-09'), DueDate: day('2026-10-14'), relations: waitsOn(blocker) });
        const [finding] = ofRule(found([blocker, waiting]), RULE.SLIPPING);
        expect(finding).toMatchObject({
            key: `slipping:${waiting._id}:waits:${blocker._id}`, taskId: waiting._id, taskIds: [waiting._id, blocker._id],
            facts: { taskKey: 'AP-2', blockerKey: 'AP-1', days: 3, daysLate: 0 },
            fix: { action: 'task.update', params: { taskId: waiting._id, fields: { startDate: day('2026-10-12'), DueDate: day('2026-10-17') } } },
        });
    });

    it('does not find one whose blocker ends in time, is closed or has no date', () => {
        const inTime = task({ DueDate: day('2026-10-08') });
        const closed = task({ DueDate: day('2026-10-20'), statusType: 'done' });
        const undated = task();
        const list = [inTime, closed, undated].map((blocker) => task({ startDate: day('2026-10-09'), DueDate: day('2026-10-14'), relations: waitsOn(blocker) }));
        expect(ofRule(found([inTime, closed, undated, ...list]), RULE.SLIPPING)).toEqual([]);
    });

    it('offers no ready change when the blocker sits in another list', () => {
        const blocker = task({ DueDate: day('2026-10-12'), sprintId: '6f0000000000000000000e09' });
        const waiting = task({ startDate: day('2026-10-09'), relations: waitsOn(blocker) });
        const [finding] = ofRule(found([waiting], { blockers: [blocker] }), RULE.SLIPPING);
        expect(finding.taskIds).toEqual([waiting._id, blocker._id]);
        expect(finding.fix).toBeUndefined();
    });
});

describe('a chain is blocked', () => {
    it('finds a task waiting on one that has not moved, and offers a comment on the blocker', () => {
        const blocker = task({ updatedAt: day('2026-10-01') });
        const waiting = task({ relations: waitsOn(blocker) });
        const [finding] = ofRule(found([blocker, waiting]), RULE.BLOCKED);
        expect(finding).toMatchObject({
            key: `blocked:${waiting._id}:${blocker._id}`, taskId: waiting._id, taskIds: [waiting._id, blocker._id],
            facts: { taskKey: 'AP-2', blockerKey: 'AP-1', quietDays: 4 },
            fix: { action: 'task.comment', params: { taskId: blocker._id } },
        });
        expect(finding.fix.params.body).toContain('AP-2');
        expect(finding.fix.params.body).toContain('4 working days');
    });

    it('does not find one whose blocker moved lately or is closed', () => {
        const moving = task({ updatedAt: day('2026-10-05') });
        const closed = task({ updatedAt: day('2026-09-01'), statusType: 'close' });
        const list = [task({ relations: waitsOn(moving) }), task({ relations: waitsOn(closed) })];
        expect(QUIET_BLOCKER_WORKING_DAYS).toBe(3);
        expect(ofRule(found([moving, closed, ...list]), RULE.BLOCKED)).toEqual([]);
    });

    it('a status named blocked with nothing it waits on is not a chain', () => {
        expect(ofRule(found([task({ status: { text: 'Blocked', type: 'active' } })]), RULE.BLOCKED)).toEqual([]);
    });
});

describe('no owner and no estimate', () => {
    it('finds an open task nobody holds', () => {
        const orphan = task({ AssigneeUserId: [] });
        expect(ofRule(found([orphan, task()]), RULE.NO_OWNER)).toMatchObject([{ key: `no_owner:${orphan._id}`, taskIds: [orphan._id] }]);
        expect(ofRule(found([task({ AssigneeUserId: [], statusType: 'close' })]), RULE.NO_OWNER)).toEqual([]);
    });

    it('finds an open task with neither hours nor points', () => {
        const bare = task({ totalEstimatedTime: 0, points: null });
        expect(ofRule(found([bare, task({ totalEstimatedTime: 0, points: 3 })]), RULE.NO_ESTIMATE)).toMatchObject([{ key: `no_estimate:${bare._id}` }]);
        expect(ofRule(found([task({ totalEstimatedTime: 0, statusType: 'done' })]), RULE.NO_ESTIMATE)).toEqual([]);
    });
});

describe('stale', () => {
    it('finds started work with no change for the set number of working days, and offers a comment', () => {
        const quiet = task({ updatedAt: day('2026-09-30') });
        const [finding] = ofRule(found([quiet]), RULE.STALE);
        expect(STALE_WORKING_DAYS).toBe(5);
        expect(finding).toMatchObject({ key: `stale:${quiet._id}`, facts: { quietDays: 5 }, fix: { action: 'task.comment', params: { taskId: quiet._id } } });
        expect(finding.fix.params.body).toContain('5 working days');
    });

    it('one working day short is not stale, and a weekend does not count towards it', () => {
        expect(ofRule(found([task({ updatedAt: day('2026-10-01') })]), RULE.STALE)).toEqual([]);
        expect(ofRule(found([task({ updatedAt: day('2026-10-01') })], { week: [0, 1, 2, 3, 4, 5, 6] }), RULE.STALE)).toHaveLength(1);
    });

    it('leaves work nobody has started, closed work and work already found slipping or blocked alone', () => {
        const blocker = task({ updatedAt: day('2026-09-01'), statusType: 'default_active' });
        const list = [
            blocker,
            task({ updatedAt: day('2026-09-01'), statusType: 'close' }),
            task({ updatedAt: day('2026-09-01'), DueDate: day('2026-10-01') }),
            task({ updatedAt: day('2026-09-01'), relations: waitsOn(blocker) }),
        ];
        expect(ofRule(found(list), RULE.STALE)).toEqual([]);
    });
});

describe('new and untriaged', () => {
    it('finds a task that came in by email or a form and still has no owner and no estimate, once', () => {
        const mail = task({ origin: { kind: 'email', ref: 'm1' }, AssigneeUserId: [], totalEstimatedTime: 0 });
        const form = task({ origin: { kind: 'form', ref: 'f1' }, AssigneeUserId: [], totalEstimatedTime: 0 });
        const all = found([mail, form]);
        expect(ofRule(all, RULE.UNTRIAGED)).toMatchObject([{ key: `untriaged:${mail._id}`, facts: { origin: 'email' } }, { key: `untriaged:${form._id}`, facts: { origin: 'form' } }]);
        expect(ofRule(all, RULE.NO_OWNER)).toEqual([]);
        expect(ofRule(all, RULE.NO_ESTIMATE)).toEqual([]);
    });

    it('does not find one a person made, or one that already has an owner or an estimate', () => {
        const list = [
            task({ AssigneeUserId: [], totalEstimatedTime: 0 }),
            task({ origin: { kind: 'email' }, totalEstimatedTime: 0 }),
            task({ origin: { kind: 'form' }, AssigneeUserId: [] }),
        ];
        expect(ofRule(found(list), RULE.UNTRIAGED)).toEqual([]);
    });
});

describe('a person is overloaded', () => {
    const plan = (taskId, ymd, minutes, UserId = PRIYA) => ({ TaskId: taskId, UserId, Date: day(ymd), EstimatedTime: minutes });

    it('finds a person whose planned hours this week are above what the week holds, and names one task', () => {
        const small = task({ DueDate: day('2026-10-08') });
        const big = task({ DueDate: day('2026-10-09') });
        const plans = [plan(small._id, '2026-10-05', 600), plan(big._id, '2026-10-06', 1200), plan(big._id, '2026-10-07', 720)];
        const [finding] = ofRule(found([small, big], { plans }), RULE.OVERLOADED);
        expect(HOURS_PER_DAY).toBe(8);
        expect(finding).toMatchObject({
            key: `overloaded:${PRIYA}:2026-10-05`, userId: PRIYA, taskId: big._id, taskIds: [small._id, big._id],
            facts: { plannedHours: 42, capacityHours: 40, taskKey: 'AP-2' },
        });
        expect(finding.fix).toBeUndefined();
    });

    it('does not find one at or under the week, and counts approved time off against it', () => {
        const one = task();
        const full = [plan(one._id, '2026-10-05', 2400)];
        expect(ofRule(found([one], { plans: full }), RULE.OVERLOADED)).toEqual([]);
        const away = [{ userId: PRIYA, status: 'approved', startDate: day('2026-10-08'), endDate: day('2026-10-09'), hoursPerDay: 8 }];
        expect(ofRule(found([one], { plans: full, pto: away }), RULE.OVERLOADED)).toMatchObject([{ facts: { plannedHours: 40, capacityHours: 24 } }]);
    });

    it('leaves out hours planned outside this week and on closed tasks', () => {
        const open = task();
        const closed = task({ statusType: 'close' });
        const plans = [plan(open._id, '2026-10-05', 2400), plan(open._id, '2026-10-12', 600), plan(closed._id, '2026-10-06', 600)];
        expect(ofRule(found([open, closed], { plans }), RULE.OVERLOADED)).toEqual([]);
    });
});

describe('the order', () => {
    it('puts the most urgent first: slipping by its days, then blocked, overloaded, untriaged, stale, no owner, no estimate', () => {
        const blocker = task({ updatedAt: day('2026-09-29'), statusType: 'default_active' });
        const list = [
            task({ totalEstimatedTime: 0 }),
            task({ AssigneeUserId: [] }),
            task({ updatedAt: day('2026-09-25') }),
            task({ origin: { kind: 'email' }, AssigneeUserId: [], totalEstimatedTime: 0 }),
            task({ relations: waitsOn(blocker) }),
            task({ DueDate: day('2026-10-05') }),
            task({ DueDate: day('2026-09-28') }),
            blocker,
        ];
        expect(found(list).map((finding) => `${finding.rule}:${finding.facts.taskKey}`)).toEqual([
            'slipping:AP-8', 'slipping:AP-7', 'blocked:AP-6', 'untriaged:AP-5', 'stale:AP-4', 'no_owner:AP-3', 'no_estimate:AP-2',
        ]);
    });
});
