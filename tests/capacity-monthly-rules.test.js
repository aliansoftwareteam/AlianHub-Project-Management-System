const M = require('../Modules/CapacityPlanning/helpers/monthlyRules');

describe('monthKeys / monthBounds', () => {
    test('lists months inclusive and caps the span', () => {
        expect(M.monthKeys('2026-09', '2026-12')).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
        expect(M.monthKeys('2026-12', '2026-09')).toEqual([]);
        expect(M.monthKeys('2026-01', '2028-01')).toHaveLength(M.MAX_MONTHS);
    });
    test('bounds cover the whole month', () => {
        const b = M.monthBounds('2026-02');
        expect(b.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
        expect(b.end.toISOString()).toBe('2026-02-28T23:59:59.999Z');
        expect(M.monthOf('2026-10-15T10:00:00Z')).toBe('2026-10');
    });
});

describe('summarizeTeams', () => {
    const months = ['2026-09', '2026-10'];
    const users = {
        ava: { name: 'Ava', months: { '2026-09': { availableHours: 160, ptoHours: 0, committedHours: 100, pipelineHours: 20, ptoDays: 0 }, '2026-10': { availableHours: 120, ptoHours: 40, committedHours: 150, pipelineHours: 0, ptoDays: 5 } } },
        ken: { name: 'Ken', months: { '2026-09': { availableHours: 160, ptoHours: 0, committedHours: 170, pipelineHours: 0, ptoDays: 0 }, '2026-10': { availableHours: 160, ptoHours: 0, committedHours: 176, pipelineHours: 0, ptoDays: 0 } } },
        loose: { name: 'Loose', months: { '2026-09': { availableHours: 160, ptoHours: 0, committedHours: 10, pipelineHours: 0, ptoDays: 0 }, '2026-10': { availableHours: 160, ptoHours: 0, committedHours: 10, pipelineHours: 0, ptoDays: 0 } } },
    };
    const teams = [{ teamId: 'eng', name: 'Engineering', memberIds: ['ava', 'ken'] }];
    test('rolls members into team-months and surfaces gaps largest first', () => {
        const s = M.summarizeTeams({ teams, users, months });
        const eng = s.teams.find((t) => t.teamId === 'eng');
        expect(eng.months['2026-09']).toMatchObject({ availableHours: 320, committedHours: 270, pipelineHours: 20, status: 'ok', gapHours: 0 });
        expect(eng.months['2026-10']).toMatchObject({ availableHours: 280, committedHours: 326, status: 'over', gapHours: 46 });
        expect(eng.months['2026-10'].notes).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'pto', name: 'Ava', days: 5 }),
            expect.objectContaining({ kind: 'over', name: 'Ken', pct: 110 }),
        ]));
        expect(s.gaps[0]).toMatchObject({ teamId: 'eng', month: '2026-10', gapHours: 46 });
    });
    test('members outside every team land in a synthetic unassigned row', () => {
        const s = M.summarizeTeams({ teams, users, months });
        const un = s.teams.find((t) => t.unassigned);
        expect(un.members).toBe(1);
        expect(un.months['2026-09'].committedHours).toBe(10);
    });
    test('cellStatus flags tight months at 90%', () => {
        expect(M.cellStatus({ availableHours: 100, committedHours: 90 })).toBe('tight');
        expect(M.cellStatus({ availableHours: 100, committedHours: 89 })).toBe('ok');
        expect(M.cellStatus({ availableHours: 0, committedHours: 1 })).toBe('over');
    });
});
