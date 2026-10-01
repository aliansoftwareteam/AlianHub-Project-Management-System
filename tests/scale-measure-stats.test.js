const { median, percentile, summarise } = require('../scripts/scale/lib/stats');
const { BUDGETS, verdict, budgetText, markdownTable } = require('../scripts/scale/lib/report');

const upTo = (n) => Array.from({ length: n }, (_, i) => i + 1);

describe('median', () => {
    it('is the middle value of an odd number of runs', () => {
        expect(median([30, 10, 20])).toBe(20);
    });

    it('is the mean of the two middle values of an even number of runs', () => {
        expect(median([40, 10, 20, 30])).toBe(25);
    });

    it('is not pulled by one slow run', () => {
        expect(median([12, 11, 13, 12, 900])).toBe(12);
    });

    it('is the value itself for one run and nothing for none', () => {
        expect(median([7])).toBe(7);
        expect(median([])).toBeNull();
    });

    it('sorts numbers as numbers and leaves the input as it was', () => {
        const runs = [100, 9, 25];
        expect(median(runs)).toBe(25);
        expect(runs).toEqual([100, 9, 25]);
    });
});

describe('p95', () => {
    it('is the 19th of 20 sorted runs', () => {
        expect(percentile(upTo(20).reverse(), 95)).toBe(19);
    });

    it('is the 95th of 100 sorted runs', () => {
        expect(percentile(upTo(100), 95)).toBe(95);
    });

    it('is the slowest run when there are fewer than 20', () => {
        expect(percentile([5, 50, 10], 95)).toBe(50);
        expect(percentile([5], 95)).toBe(5);
    });

    it('is always a value that was measured, never an interpolation', () => {
        const runs = [10, 20, 30, 1000];
        expect(runs).toContain(percentile(runs, 95));
    });

    it('covers the other ranks: the 50th is the lower middle, the 100th the maximum', () => {
        expect(percentile(upTo(10), 50)).toBe(5);
        expect(percentile(upTo(10), 100)).toBe(10);
        expect(percentile([], 95)).toBeNull();
    });
});

describe('summarise', () => {
    it('reports runs, median, p95, minimum and maximum to a tenth', () => {
        expect(summarise([10.04, 20.26, 30.31, 40.49])).toEqual({ runs: 4, median: 25.3, p95: 40.5, min: 10, max: 40.5 });
    });

    it('ignores a run that produced no number', () => {
        expect(summarise([10, NaN, 30, undefined])).toMatchObject({ runs: 2, median: 20 });
    });

    it('is empty for no runs', () => {
        expect(summarise([])).toEqual({ runs: 0, median: null, p95: null, min: null, max: null });
    });
});

describe('budgets', () => {
    const metric = (key, value) => ({ key, median: value, p95: value, unit: BUDGETS[key] ? BUDGETS[key].unit : 'ms' });

    it('are met below a ceiling and missed at or above it, by how much', () => {
        expect(verdict(metric('api.listFirstPage', 299.9), 10000)).toBe('met');
        expect(verdict(metric('api.listFirstPage', 300), 10000)).toBe('missed by 0 ms');
        expect(verdict(metric('list.firstRows', 2140.5), 10000)).toBe('missed by 640.5 ms');
    });

    it('treat frames per second as a floor', () => {
        expect(verdict(metric('list.scrollFps', 50), 10000)).toBe('met');
        expect(verdict(metric('list.scrollFps', 41.5), 10000)).toBe('missed by 8.5 fps');
        expect(budgetText(metric('list.scrollFps', 50), 10000)).toBe('≥ 50 fps');
    });

    it('apply at 10,000 tasks only: 50,000 is measured without a budget', () => {
        expect(verdict(metric('api.listFirstPage', 5000), 50000)).toBe('measured, no budget yet');
        expect(budgetText(metric('api.listFirstPage', 5000), 50000)).toBe('');
    });

    it('say so when a metric has no budget or was not measured', () => {
        expect(verdict(metric('api.search', 80), 10000)).toBe('no budget');
        expect(verdict({ key: 'list.firstRows', median: null }, 10000)).toBe('not measured');
    });
});

describe('the markdown table', () => {
    const table = markdownTable({
        date: '2026-10-01',
        build: '14.36.0-beta.670',
        machine: 'Test machine, 8 cores',
        tasks: 10000,
        metrics: [
            { key: 'api.listFirstPage', label: 'API: List first page', unit: 'ms', runs: 20, median: 42.5, p95: 61, detail: '35 rows, 48 kB' },
            { key: 'list.firstRows', label: 'List: first rows visible', unit: 'ms', runs: 5, median: 2100, p95: 2300 },
            { key: 'page.domNodes', label: 'List: DOM nodes | after load', unit: 'nodes', runs: 1, median: 5210, p95: 5210 },
        ],
    }).split('\n');

    it('has a header, a separator and one row per metric, each with the same number of cells', () => {
        expect(table).toHaveLength(5);
        const cells = table.map((line) => line.replace(/\\\|/g, '').split('|').length);
        expect(new Set(cells).size).toBe(1);
    });

    it('carries the date, build, machine, data size, value, budget and verdict on every row', () => {
        expect(table[2]).toBe('| 2026-10-01 | 14.36.0-beta.670 | Test machine, 8 cores | 10000 | API: List first page | 42.5 ms | 61 ms | 20 | < 300 ms | met | 35 rows, 48 kB |');
        expect(table[3]).toContain('| 2100 ms | 2300 ms | 5 | < 1500 ms | missed by 600 ms |');
    });

    it('escapes a pipe inside a cell', () => {
        expect(table[4]).toContain('List: DOM nodes \\| after load');
    });
});
