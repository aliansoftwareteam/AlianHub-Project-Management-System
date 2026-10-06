/**
 * Scrum Sprint Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for the pure rules in Modules/Sprints/scrumRules.js — the shared
 * source of truth for the lifecycle controller and the cadence cron. No DB or
 * network needed.
 *
 * A sprint box is a LOCAL calendar range, so DST is the interesting case. Node
 * fixes its timezone before this file is loaded, and the dev machine and CI are
 * both on zones with no DST at all — so setting process.env.TZ here would look
 * like a DST test while never crossing a transition. The one case that needs a
 * real transition runs in a child process with TZ set instead.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const {
    normaliseCadence,
    computeWindow,
    nextSprintName,
    deriveState,
    splitByDone,
    summariseCommitment,
    findLifecycleWrite,
    DEFAULT_LENGTH_DAYS,
    MIN_LENGTH_DAYS,
    MAX_LENGTH_DAYS,
    LIFECYCLE_FIELDS,
} = require('../Modules/Sprints/scrumRules');

/* Run computeWindow under a timezone that actually observes DST, whatever the
   host is set to. Returns the child's findings for the assertions below. */
function measureUnderDstTimezone() {
    const rulesPath = path.resolve(__dirname, '../Modules/Sprints/scrumRules');
    const script = `
        const { computeWindow } = require(${JSON.stringify(rulesPath)});
        const acrossFallBack = computeWindow({ lengthDays: 14 }, new Date(2026, 9, 19));
        const EXPECTED_SPAN = 6;
        let worstSpan = EXPECTED_SPAN;
        let allEndLate = true;
        for (let day = 0; day < 365; day += 1) {
            const w = computeWindow({ lengthDays: 7 }, new Date(2026, 0, 1 + day));
            const span = Math.round((new Date(w.endDate.getFullYear(), w.endDate.getMonth(), w.endDate.getDate())
                - new Date(w.startDate.getFullYear(), w.startDate.getMonth(), w.startDate.getDate())) / 86400000);
            if (Math.abs(span - EXPECTED_SPAN) > Math.abs(worstSpan - EXPECTED_SPAN)) worstSpan = span;
            if (w.endDate.getHours() !== 23 || w.endDate.getMinutes() !== 59) allEndLate = false;
        }
        process.stdout.write(JSON.stringify({
            observesDst: new Date(2026, 0, 15).getTimezoneOffset() !== new Date(2026, 6, 15).getTimezoneOffset(),
            crossedTransition: acrossFallBack.startDate.getTimezoneOffset() !== acrossFallBack.endDate.getTimezoneOffset(),
            endMonth: acrossFallBack.endDate.getMonth(),
            endDay: acrossFallBack.endDate.getDate(),
            endHours: acrossFallBack.endDate.getHours(),
            endMinutes: acrossFallBack.endDate.getMinutes(),
            worstSpan,
            allEndLate,
        }));
    `;
    return JSON.parse(execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, TZ: 'Europe/London' },
        encoding: 'utf8',
    }));
}

describe('🏃 SCRUM - Cadence normalisation', () => {

    test('a valid rule passes through', () => {
        expect(normaliseCadence({
            enabled: true, lengthDays: 14, startWeekday: 1,
            autoClose: true, autoCreateNext: true, rolloverTarget: 'backlog',
        })).toEqual({
            enabled: true, lengthDays: 14, startWeekday: 1,
            autoClose: true, autoCreateNext: true, rolloverTarget: 'backlog',
        });
    });

    test('booleans must be exactly true — truthy junk stays off', () => {
        const rule = normaliseCadence({ enabled: 'yes', autoClose: 1, autoCreateNext: 'on' });
        expect(rule.enabled).toBe(false);
        expect(rule.autoClose).toBe(false);
        expect(rule.autoCreateNext).toBe(false);
    });

    test('missing or junk lengthDays falls back to the default', () => {
        expect(normaliseCadence({}).lengthDays).toBe(DEFAULT_LENGTH_DAYS);
        expect(normaliseCadence({ lengthDays: 'two weeks' }).lengthDays).toBe(DEFAULT_LENGTH_DAYS);
        expect(normaliseCadence({ lengthDays: null }).lengthDays).toBe(DEFAULT_LENGTH_DAYS);
    });

    test('lengthDays clamps to the allowed range', () => {
        expect(normaliseCadence({ lengthDays: 0 }).lengthDays).toBe(MIN_LENGTH_DAYS);
        expect(normaliseCadence({ lengthDays: -5 }).lengthDays).toBe(MIN_LENGTH_DAYS);
        expect(normaliseCadence({ lengthDays: 9999 }).lengthDays).toBe(MAX_LENGTH_DAYS);
        expect(normaliseCadence({ lengthDays: 13.6 }).lengthDays).toBe(14);
    });

    test('an out-of-range or non-integer startWeekday means "no fixed weekday"', () => {
        expect(normaliseCadence({ startWeekday: 7 }).startWeekday).toBeNull();
        expect(normaliseCadence({ startWeekday: -1 }).startWeekday).toBeNull();
        expect(normaliseCadence({ startWeekday: 2.5 }).startWeekday).toBeNull();
        expect(normaliseCadence({ startWeekday: 'monday' }).startWeekday).toBeNull();
        expect(normaliseCadence({ startWeekday: 0 }).startWeekday).toBe(0);
    });

    test('an unknown rollover target falls back to next', () => {
        expect(normaliseCadence({ rolloverTarget: 'somewhere' }).rolloverTarget).toBe('next');
        expect(normaliseCadence({}).rolloverTarget).toBe('next');
        expect(normaliseCadence({ rolloverTarget: 'backlog' }).rolloverTarget).toBe('backlog');
    });

    test('a null or non-object input still produces a usable rule', () => {
        expect(normaliseCadence(null).lengthDays).toBe(DEFAULT_LENGTH_DAYS);
        expect(normaliseCadence('nonsense').enabled).toBe(false);
    });
});

describe('🏃 SCRUM - Sprint window', () => {

    test('a one-week box runs from local midnight to local end of day', () => {
        // Monday 3 August 2026.
        const { startDate, endDate } = computeWindow({ lengthDays: 7 }, new Date(2026, 7, 3, 14, 32));
        expect([startDate.getFullYear(), startDate.getMonth(), startDate.getDate()]).toEqual([2026, 7, 3]);
        expect([startDate.getHours(), startDate.getMinutes(), startDate.getSeconds()]).toEqual([0, 0, 0]);
        expect([endDate.getFullYear(), endDate.getMonth(), endDate.getDate()]).toEqual([2026, 7, 9]);
        expect([endDate.getHours(), endDate.getMinutes(), endDate.getSeconds(), endDate.getMilliseconds()])
            .toEqual([23, 59, 59, 999]);
    });

    test('startWeekday rolls the start forward to that weekday', () => {
        // Wednesday 5 August 2026 with a Monday cadence → Monday 10 August.
        const { startDate } = computeWindow({ lengthDays: 5, startWeekday: 1 }, new Date(2026, 7, 5));
        expect(startDate.getDay()).toBe(1);
        expect(startDate.getDate()).toBe(10);
    });

    test('a date already on the start weekday is not pushed a week out', () => {
        const { startDate } = computeWindow({ lengthDays: 5, startWeekday: 1 }, new Date(2026, 7, 3, 9));
        expect(startDate.getDate()).toBe(3);
    });

    test('the shortest box starts and ends on the same day', () => {
        const { startDate, endDate } = computeWindow({ lengthDays: 1 }, new Date(2026, 7, 3));
        expect(startDate.getDate()).toBe(endDate.getDate());
        expect(endDate.getHours()).toBe(23);
    });

    test('an unusable start date returns null rather than an Invalid Date window', () => {
        expect(computeWindow({}, 'not a date')).toBeNull();
        expect(computeWindow({}, null)).toBeNull();
        expect(computeWindow({}, undefined)).toBeNull();
    });

    test('a box spanning a DST transition still ends at local 23:59 on the right day', () => {
        // Europe/London falls back on Sunday 25 October 2026, so a 14-day box
        // opened on Monday 19 October crosses it. The clock GAINS an hour, so
        // millisecond arithmetic (start + 13 * 86400000) lands at 23:00 on
        // Saturday the 31st and a trailing end-of-day rounds it to the 31st —
        // a whole day short. Calendar arithmetic reports Sunday 1 November.
        //
        // The spring-forward is deliberately NOT the case under test: there the
        // hour is lost rather than gained, end-of-day absorbs it, and both
        // implementations agree — a test that cannot fail.
        const seen = measureUnderDstTimezone();
        expect(seen.observesDst).toBe(true);
        expect(seen.crossedTransition).toBe(true);
        expect([seen.endMonth, seen.endDay]).toEqual([10, 1]);
        expect([seen.endHours, seen.endMinutes]).toEqual([23, 59]);
    });

    test('a whole year of boxes holds its length across both DST transitions', () => {
        const seen = measureUnderDstTimezone();
        expect(seen.worstSpan).toBe(6);
        expect(seen.allEndLate).toBe(true);
    });

    test('every start date in a year yields exactly lengthDays calendar days', () => {
        const lengthDays = 7;
        for (let day = 0; day < 365; day += 1) {
            const from = new Date(2026, 0, 1 + day);
            const { startDate, endDate } = computeWindow({ lengthDays }, from);
            const spanned = Math.round(
                (new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
                    - new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()))
                / 86400000,
            );
            expect(spanned).toBe(lengthDays - 1);
            expect(endDate.getHours()).toBe(23);
        }
    });
});

describe('🏃 SCRUM - Next sprint name', () => {

    test('a trailing number is bumped', () => {
        expect(nextSprintName('Sprint 12')).toBe('Sprint 13');
        expect(nextSprintName('Week 34')).toBe('Week 35');
        expect(nextSprintName('Sprint 9')).toBe('Sprint 10');
    });

    test('zero padding is preserved', () => {
        expect(nextSprintName('Sprint 09')).toBe('Sprint 10');
        expect(nextSprintName('Sprint 001')).toBe('Sprint 002');
    });

    test('trailing whitespace does not defeat the match', () => {
        expect(nextSprintName('Sprint 4   ')).toBe('Sprint 5');
    });

    test('a name that ends in a year is not bumped into the wrong year', () => {
        // The real naming convention in this workspace.
        expect(nextSprintName('AHE - 24 - 28 Aug 2026')).toBe('AHE - 24 - 28 Aug 2026 (next)');
    });

    test('a name with no trailing number is marked rather than guessed at', () => {
        expect(nextSprintName('Hardening')).toBe('Hardening (next)');
        expect(nextSprintName('Sprint 2 - Project List')).toBe('Sprint 2 - Project List (next)');
    });

    test('an empty or missing name still produces something usable', () => {
        expect(nextSprintName('')).toBe('Sprint 1');
        expect(nextSprintName(null)).toBe('Sprint 1');
        expect(nextSprintName(undefined)).toBe('Sprint 1');
        expect(nextSprintName('   ')).toBe('Sprint 1');
    });
});

describe('🏃 SCRUM - Derived state', () => {
    const now = new Date(2026, 7, 24, 12, 0, 0);

    test('a plain list is not a sprint at all', () => {
        expect(deriveState({ name: 'Backlog of ideas' }, now)).toBe('none');
        expect(deriveState({ isScrum: false, state: 'active' }, now)).toBe('none');
        expect(deriveState(null, now)).toBe('none');
    });

    test('opted in but not started yet reads as planned', () => {
        expect(deriveState({ isScrum: true, state: 'planned' }, now)).toBe('planned');
        // The schema default is '' — a sprint that was opted in but never
        // stamped must not fall through to some other state.
        expect(deriveState({ isScrum: true, state: '' }, now)).toBe('planned');
        expect(deriveState({ isScrum: true }, now)).toBe('planned');
    });

    test('an active sprint inside its window is active', () => {
        expect(deriveState({ isScrum: true, state: 'active', endDate: new Date(2026, 7, 28) }, now)).toBe('active');
    });

    test('an active sprint past its end date is overdue, not closed', () => {
        expect(deriveState({ isScrum: true, state: 'active', endDate: new Date(2026, 7, 21) }, now)).toBe('overdue');
    });

    test('an active sprint with no end date cannot be overdue', () => {
        expect(deriveState({ isScrum: true, state: 'active' }, now)).toBe('active');
        expect(deriveState({ isScrum: true, state: 'active', endDate: 'whenever' }, now)).toBe('active');
    });

    test('closed stays closed regardless of dates', () => {
        expect(deriveState({ isScrum: true, state: 'closed', endDate: new Date(2027, 0, 1) }, now)).toBe('closed');
    });
});

describe('🏃 SCRUM - Splitting done from not done', () => {

    test('close is done, everything else is not', () => {
        const { done, notDone } = splitByDone([
            { _id: 'a', statusType: 'close' },
            { _id: 'b', statusType: 'open' },
            { _id: 'c', statusType: 'in_progress' },
            { _id: 'd' },
        ]);
        expect(done.map((t) => t._id)).toEqual(['a']);
        expect(notDone.map((t) => t._id)).toEqual(['b', 'c', 'd']);
    });

    test('holes in the list are dropped, not counted as unfinished work', () => {
        const { done, notDone } = splitByDone([null, undefined, { _id: 'a', statusType: 'close' }]);
        expect(done).toHaveLength(1);
        expect(notDone).toHaveLength(0);
    });

    test('a non-array is not a crash', () => {
        expect(splitByDone(null)).toEqual({ done: [], notDone: [] });
        expect(splitByDone(undefined)).toEqual({ done: [], notDone: [] });
    });
});

describe('🏃 SCRUM - Commitment snapshot', () => {

    test('totals points, estimate minutes and the task ids', () => {
        expect(summariseCommitment([
            { _id: 1, points: 3, totalEstimatedTime: 120 },
            { _id: 2, points: 5, totalEstimatedTime: 60 },
        ])).toEqual({ tasks: 2, points: 8, minutes: 180, taskIds: ['1', '2'] });
    });

    test('unpointed and unestimated tasks count toward the task total only', () => {
        const snap = summariseCommitment([
            { _id: 1, points: null },
            { _id: 2, points: 3, totalEstimatedTime: 60 },
            { _id: 3, totalEstimatedTime: 'soon' },
        ]);
        expect(snap).toEqual({ tasks: 3, points: 3, minutes: 60, taskIds: ['1', '2', '3'] });
    });

    test('an empty sprint has a snapshot, not a missing one', () => {
        expect(summariseCommitment([])).toEqual({ tasks: 0, points: 0, minutes: 0, taskIds: [] });
        expect(summariseCommitment(null)).toEqual({ tasks: 0, points: 0, minutes: 0, taskIds: [] });
    });
});

describe('🏃 SCRUM - Lifecycle field guard', () => {

    test('the shapes the sprint UI sends today all pass', () => {
        // Every legitimate updateObject reaching PATCH /api/v1/sprint/:id.
        const shipping = [
            { $set: { deletedStatusKey: 2 } },
            { $set: { folderId: 'f1', folderName: 'Bucket' } },
            { $set: { private: true }, $addToSet: { AssigneeUserId: 'u1' } },
            { $set: { AssigneeUserId: [], private: false } },
            { $addToSet: { watchers: 'u1' } },
            { $pull: { watchers: 'u1' } },
            { $set: { name: 'General', sendMessage: true }, $unset: { url: '', iconName: '', prefix: '' } },
            { $set: { type: 'icon', prefix: 'fa', iconName: 'star' }, $unset: { url: '' } },
            { $inc: { tasks: 1 } },
            { $inc: { tasks: -1 } },
            { $inc: { archiveTaskCount: 3, tasks: -3 } },
            { favouriteTasks: { userId: 'u1' } },
        ];
        shipping.forEach((update) => expect(findLifecycleWrite(update)).toBeNull());
    });

    test('every lifecycle field is caught under an operator', () => {
        LIFECYCLE_FIELDS.forEach((field) => {
            expect(findLifecycleWrite({ $set: { [field]: 'x' } })).toBe(field);
        });
    });

    test('the plain (operator-less) form is caught too', () => {
        expect(findLifecycleWrite({ state: 'closed' })).toBe('state');
    });

    test('a dotted path into a lifecycle object is caught', () => {
        expect(findLifecycleWrite({ $set: { 'commitment.points': 999 } })).toBe('commitment');
        expect(findLifecycleWrite({ $unset: { 'closeReport.at': '' } })).toBe('closeReport');
    });

    test('an aggregation-pipeline update cannot smuggle one through', () => {
        expect(findLifecycleWrite([{ $set: { state: 'closed' } }])).toBe('state');
        expect(findLifecycleWrite([{ $set: { tasks: 1 } }, { $set: { endDate: new Date() } }])).toBe('endDate');
    });

    test('a lifecycle field mixed in with legitimate ones is still caught', () => {
        expect(findLifecycleWrite({ $set: { name: 'Sprint 4', state: 'active' } })).toBe('state');
    });

    test('junk input is not a crash', () => {
        expect(findLifecycleWrite(null)).toBeNull();
        expect(findLifecycleWrite('closed')).toBeNull();
        expect(findLifecycleWrite({ $set: null })).toBeNull();
    });
});
