const S = require('../Modules/TimeSheet/helpers/timelogSourceSplit');

describe('humanHoursFromEntries', () => {
    test('sums LogTimeDuration minutes into hours', () => {
        expect(S.humanHoursFromEntries([
            { LogTimeDuration: 90 },
            { LogTimeDuration: 30 },
        ])).toBe(2);
    });

    test('leaves agent-written rows out — they are charted by account, not as people', () => {
        expect(S.humanHoursFromEntries([
            { LogTimeDuration: 60 },
            { LogTimeDuration: 120, actorType: 'agent' },
        ])).toBe(1);
    });

    test('ignores rows with a missing, zero or unparseable duration', () => {
        expect(S.humanHoursFromEntries([
            { LogTimeDuration: 60 },
            { LogTimeDuration: 0 },
            { LogTimeDuration: -30 },
            { LogTimeDuration: 'x' },
            {},
            null,
        ])).toBe(1);
    });

    test('tolerates non-array input', () => {
        expect(S.humanHoursFromEntries(null)).toBe(0);
        expect(S.humanHoursFromEntries(undefined)).toBe(0);
    });
});

describe('agentHoursFromRuns', () => {
    test('groups elapsed run time by the account it went through', () => {
        expect(S.agentHoursFromRuns([
            { elapsedMs: 3600000, viaAccount: 'personal' },
            { elapsedMs: 1800000, viaAccount: 'personal' },
            { elapsedMs: 7200000, viaAccount: 'local' },
        ])).toEqual({ workspace: 0, personal: 1.5, local: 2 });
    });

    test('an unknown or missing account falls back to workspace', () => {
        expect(S.agentHoursFromRuns([
            { elapsedMs: 3600000 },
            { elapsedMs: 3600000, viaAccount: 'nonsense' },
        ])).toEqual({ workspace: 2, personal: 0, local: 0 });
    });

    test('ignores runs with no measurable elapsed time', () => {
        expect(S.agentHoursFromRuns([
            { elapsedMs: 0, viaAccount: 'local' },
            { viaAccount: 'local' },
            null,
        ])).toEqual({ workspace: 0, personal: 0, local: 0 });
    });
});

describe('buildHoursBySource', () => {
    test('people lead the bar and every bucket carries its share', () => {
        const { segments, total } = S.buildHoursBySource({
            peopleHours: 6,
            runs: [
                { elapsedMs: 3600000, viaAccount: 'workspace' },
                { elapsedMs: 3600000, viaAccount: 'personal' },
            ],
        });
        expect(total).toBe(8);
        expect(segments.map((s) => s.key)).toEqual(['people', 'agent-workspace', 'agent-personal']);
        expect(segments[0]).toEqual({ key: 'people', hours: 6, pct: 75 });
        expect(segments.reduce((sum, s) => sum + s.pct, 0)).toBe(100);
    });

    test('empty buckets are dropped so the legend never shows 0h', () => {
        const { segments } = S.buildHoursBySource({
            peopleHours: 0,
            runs: [{ elapsedMs: 3600000, viaAccount: 'local' }],
        });
        expect(segments.map((s) => s.key)).toEqual(['agent-local']);
    });

    test('nothing logged and nothing run means nothing to chart', () => {
        expect(S.buildHoursBySource({ peopleHours: 0, runs: [] })).toEqual({ segments: [], total: 0 });
        expect(S.buildHoursBySource()).toEqual({ segments: [], total: 0 });
    });

    test('a precomputed agent breakdown is used as given', () => {
        const { segments, total } = S.buildHoursBySource({
            peopleHours: 1,
            agentHours: { workspace: 1, personal: 0, local: 2 },
        });
        expect(total).toBe(4);
        expect(segments.map((s) => s.key)).toEqual(['people', 'agent-workspace', 'agent-local']);
    });
});
