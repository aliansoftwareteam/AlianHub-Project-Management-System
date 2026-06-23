const R = require('../Modules/Portfolio/helpers/portfolioRules');

const NOW = new Date('2026-06-20T00:00:00Z').getTime();
const past = new Date('2026-06-10T00:00:00Z');
const future = new Date('2026-07-10T00:00:00Z');

describe('isDone', () => {
    test('accepts close and done (any case)', () => {
        expect(R.isDone('close')).toBe(true);
        expect(R.isDone('done')).toBe(true);
        expect(R.isDone('Close')).toBe(true);
    });
    test('rejects open / unknown / empty', () => {
        expect(R.isDone('open')).toBe(false);
        expect(R.isDone('inprogress')).toBe(false);
        expect(R.isDone('')).toBe(false);
        expect(R.isDone(undefined)).toBe(false);
    });
});

describe('isOverdue', () => {
    test('open task past due is overdue', () => {
        expect(R.isOverdue({ statusType: 'open', DueDate: past }, NOW)).toBe(true);
    });
    test('done task is never overdue, even if past due', () => {
        expect(R.isOverdue({ statusType: 'close', DueDate: past }, NOW)).toBe(false);
    });
    test('future / missing due date is not overdue', () => {
        expect(R.isOverdue({ statusType: 'open', DueDate: future }, NOW)).toBe(false);
        expect(R.isOverdue({ statusType: 'open' }, NOW)).toBe(false);
    });
});

describe('summarizeProject', () => {
    test('computes totals, progress and health', () => {
        const tasks = [
            { statusType: 'close' },
            { statusType: 'close' },
            { statusType: 'open', DueDate: past },   // overdue
            { statusType: 'open', DueDate: future },  // open, on time
        ];
        const s = R.summarizeProject(tasks, NOW);
        expect(s.total).toBe(4);
        expect(s.done).toBe(2);
        expect(s.open).toBe(2);
        expect(s.overdue).toBe(1);
        expect(s.progressPct).toBe(50);
        expect(['on-track', 'at-risk', 'off-track']).toContain(s.health);
    });
    test('empty project is 0% on-track', () => {
        const s = R.summarizeProject([], NOW);
        expect(s).toMatchObject({ total: 0, done: 0, open: 0, overdue: 0, progressPct: 0, health: 'on-track' });
    });
});

describe('healthOf', () => {
    test('on-track when nothing overdue', () => {
        expect(R.healthOf(80, 0, 2)).toBe('on-track');
    });
    test('off-track when overdue and low progress', () => {
        expect(R.healthOf(20, 3, 5)).toBe('off-track');
    });
    test('at-risk when a little overdue but good progress', () => {
        expect(R.healthOf(90, 1, 20)).toBe('at-risk');
    });
});

describe('summarizeMilestones', () => {
    test('splits upcoming vs past-due by date', () => {
        const ms = [{ endDate: past }, { dueDate: future }, { endDate: future }, {}];
        const s = R.summarizeMilestones(ms, NOW);
        expect(s.total).toBe(4);
        expect(s.overdue).toBe(1);
        expect(s.upcoming).toBe(2); // the {} with no date is skipped
    });
});

describe('rollupPortfolio', () => {
    test('aggregates project summaries into portfolio totals', () => {
        const summaries = [
            { total: 4, done: 2, open: 2, overdue: 1, progressPct: 50, health: 'at-risk' },
            { total: 6, done: 6, open: 0, overdue: 0, progressPct: 100, health: 'on-track' },
        ];
        const t = R.rollupPortfolio(summaries);
        expect(t.projects).toBe(2);
        expect(t.totalTasks).toBe(10);
        expect(t.doneTasks).toBe(8);
        expect(t.overdueTasks).toBe(1);
        expect(t.progressPct).toBe(80);
        expect(t.onTrack).toBe(1);
        expect(t.atRisk).toBe(1);
    });
    test('no projects → zeros', () => {
        expect(R.rollupPortfolio([])).toMatchObject({ projects: 0, totalTasks: 0, progressPct: 0 });
    });
});
