/* Task 045 slice 12: the workload grid's load and capacity in hours, points or task count. */
import { describe, test, expect } from 'vitest';
import { DEFAULT_UNIT_CAPACITY, cellLoad, chipSize, dailyCapacity, plannedLoad, roundAmount, unitCapacity } from '@/views/Projects/WorkloadView/workloadUnits';

describe('workload units', () => {
    test('hours read the estimate or logged minutes, points and count read the load', () => {
        const day = { estimated: 120, logged: 30, load: 5 };
        expect(cellLoad('hours', 'estimate', day)).toBe(120);
        expect(cellLoad('hours', 'logged', day)).toBe(30);
        expect(cellLoad('points', 'logged', day)).toBe(5);
        expect(cellLoad('count', 'estimate', day)).toBe(5);
        expect(plannedLoad('hours', day)).toBe(120);
        expect(plannedLoad('points', day)).toBe(5);
    });

    test('a chip is sized in the grid unit', () => {
        expect(chipSize('hours', { minutes: 90, amount: 3 })).toBe(90);
        expect(chipSize('points', { minutes: 90, amount: 3 })).toBe(3);
        expect(chipSize('count', {})).toBe(0);
    });

    test('capacity per working day in each unit', () => {
        expect(dailyCapacity({ unit: 'hours', hoursPerDay: 6 })).toBe(360);
        expect(dailyCapacity({ unit: 'points', rule: { value: 3, per: 'day' }, workDays: 5 })).toBe(3);
        expect(dailyCapacity({ unit: 'points', rule: { value: 12, per: 'week' }, workDays: 4 })).toBe(3);
        expect(dailyCapacity({ unit: 'count', workDays: 5 })).toBe(DEFAULT_UNIT_CAPACITY.count.value / 5);
    });

    test('a stored capacity is cleaned, with the defaults filling gaps', () => {
        expect(unitCapacity(undefined)).toEqual({ points: { value: 10, per: 'week' }, count: { value: 10, per: 'week' } });
        expect(unitCapacity({ points: { value: 4, per: 'day' }, count: { value: -2, per: 'day' } })).toEqual({ points: { value: 4, per: 'day' }, count: { value: 10, per: 'week' } });
    });

    test('amounts round to one decimal', () => {
        expect(roundAmount(2.345)).toBe(2.3);
        expect(roundAmount(undefined)).toBe(0);
    });
});
