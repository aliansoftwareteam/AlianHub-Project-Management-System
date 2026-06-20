const R = require('../Modules/CustomReports/helpers/reportRules');

describe('validateConfig', () => {
    test('accepts a valid config and fills defaults', () => {
        const r = R.validateConfig({ dimension: 'status' });
        expect(r.valid).toBe(true);
        expect(r.value).toMatchObject({ source: 'tasks', dimension: 'status', metric: 'count', chartType: 'bar', filters: {} });
    });
    test('rejects an unknown dimension', () => {
        const r = R.validateConfig({ dimension: 'evilField' });
        expect(r.valid).toBe(false);
        expect(r.errors.join(' ')).toMatch(/dimension/);
    });
    test('coerces unknown metric / chartType to safe defaults', () => {
        const r = R.validateConfig({ dimension: 'project', metric: 'rm -rf', chartType: 'hack' });
        expect(r.value.metric).toBe('count');
        expect(r.value.chartType).toBe('bar');
    });
    test('drops non-allow-listed filter keys, keeps allowed ones', () => {
        const r = R.validateConfig({ dimension: 'status', filters: { project: 'p1', status: 'open', $where: 'evil', random: 'x' } });
        expect(r.value.filters).toEqual({ project: 'p1', status: 'open' });
    });
    test('drops empty filter values', () => {
        const r = R.validateConfig({ dimension: 'status', filters: { project: '', status: 'open' } });
        expect(r.value.filters).toEqual({ status: 'open' });
    });
});

describe('buildPipeline', () => {
    test('builds a safe match + group + sort + limit', () => {
        const cfg = R.validateConfig({ dimension: 'status', metric: 'points', filters: { project: 'p1' } }).value;
        const pipe = R.buildPipeline(cfg);
        expect(pipe[0].$match).toMatchObject({ ProjectID: 'p1', isParentTask: true });
        expect(pipe[1].$group._id).toBe('$statusType');
        expect(pipe[1].$group.value).toEqual({ $sum: '$points' });
        expect(pipe[2].$sort).toEqual({ value: -1 });
        expect(pipe[pipe.length - 1].$limit).toBeGreaterThan(0);
    });
    test('count metric groups with $sum:1 and maps dimension to the real field', () => {
        const cfg = R.validateConfig({ dimension: 'project', metric: 'count' }).value;
        const pipe = R.buildPipeline(cfg);
        expect(pipe[1].$group._id).toBe('$ProjectID');
        expect(pipe[1].$group.value).toEqual({ $sum: 1 });
    });
    test('only allow-listed filter fields reach $match', () => {
        const cfg = { dimension: 'status', metric: 'count', filters: { sprint: 's1' } };
        const pipe = R.buildPipeline(cfg);
        expect(pipe[0].$match.sprintId).toBe('s1');
    });
});
