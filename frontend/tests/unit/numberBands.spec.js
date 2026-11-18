import { describe, expect, it } from 'vitest';
import { numberOf, bandEdges, numberBands, inBand } from '@/views/Projects/composables/numberBands';

describe('numberOf', () => {
    it('reads a number or text holding a number', () => {
        expect(numberOf(12)).toBe(12);
        expect(numberOf(0)).toBe(0);
        expect(numberOf(-3.5)).toBe(-3.5);
        expect(numberOf(' 42 ')).toBe(42);
        expect(numberOf('1e3')).toBe(1000);
    });

    it('an empty box, blank text, words and non-finite numbers are not numbers', () => {
        expect(numberOf('')).toBeNull();
        expect(numberOf('   ')).toBeNull();
        expect(numberOf('abc')).toBeNull();
        expect(numberOf('12px')).toBeNull();
        expect(numberOf(NaN)).toBeNull();
        expect(numberOf(Infinity)).toBeNull();
        expect(numberOf('Infinity')).toBeNull();
    });

    it('null, undefined, a list, an object and a boolean are not numbers', () => {
        expect(numberOf(null)).toBeNull();
        expect(numberOf(undefined)).toBeNull();
        expect(numberOf([5])).toBeNull();
        expect(numberOf({})).toBeNull();
        expect(numberOf(true)).toBeNull();
    });
});

describe('bandEdges', () => {
    it('cuts 0 to 100 into five bands of 20', () => {
        expect(bandEdges(0, 100)).toEqual([20, 40, 60, 80]);
    });

    it('whole numbers stay whole: 1 to 10 steps by 2', () => {
        expect(bandEdges(1, 10)).toEqual([3, 5, 7, 9]);
    });

    it('a small whole range gives fewer bands rather than repeated edges', () => {
        expect(bandEdges(1, 3)).toEqual([2]);
        expect(bandEdges(0, 1)).toEqual([]);
    });

    it('decimals are cut evenly and rounded to two places', () => {
        expect(bandEdges(0, 1.5)).toEqual([0.3, 0.6, 0.9, 1.2]);
        expect(bandEdges(0.5, 1)).toEqual([0.6, 0.7, 0.8, 0.9]);
    });

    it('negative ranges work', () => {
        expect(bandEdges(-50, 50)).toEqual([-30, -10, 10, 30]);
    });

    it('no range at all gives no edges', () => {
        expect(bandEdges(5, 5)).toEqual([]);
        expect(bandEdges(10, 2)).toEqual([]);
        expect(bandEdges(NaN, 3)).toEqual([]);
        expect(bandEdges(undefined, undefined)).toEqual([]);
    });
});

describe('numberBands', () => {
    it('five bands that open at both ends, so no value is left without a group', () => {
        expect(numberBands([0, 100])).toEqual([
            { from: null, to: 20 },
            { from: 20, to: 40 },
            { from: 40, to: 60 },
            { from: 60, to: 80 },
            { from: 80, to: null },
        ]);
    });

    it('with no range, or one value, there is a single band that holds everything', () => {
        expect(numberBands(null)).toEqual([{ from: null, to: null }]);
        expect(numberBands(undefined)).toEqual([{ from: null, to: null }]);
        expect(numberBands([7, 7])).toEqual([{ from: null, to: null }]);
    });

    it('a two-band split has one edge', () => {
        expect(numberBands([1, 3])).toEqual([{ from: null, to: 2 }, { from: 2, to: null }]);
    });
});

describe('inBand', () => {
    const bands = numberBands([0, 100]);
    const bandOf = (n) => bands.findIndex((band) => inBand(n, band));

    it('a value on an edge belongs to the band that starts there', () => {
        expect(bandOf(20)).toBe(1);
        expect(bandOf(19.99)).toBe(0);
        expect(bandOf(80)).toBe(4);
    });

    it('values outside the range the bands were cut from still land in the first or last band', () => {
        expect(bandOf(-1000)).toBe(0);
        expect(bandOf(1e9)).toBe(4);
    });

    it('every number lands in exactly one band', () => {
        [-5, 0, 20, 33, 59.9, 60, 99, 100, 250].forEach((n) => {
            expect(bands.filter((band) => inBand(n, band))).toHaveLength(1);
        });
    });

    it('a task with no number is in no band', () => {
        expect(bands.some((band) => inBand(null, band))).toBe(false);
        expect(inBand(null, { from: null, to: null })).toBe(false);
    });
});
