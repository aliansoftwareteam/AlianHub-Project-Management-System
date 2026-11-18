import { describe, expect, it } from 'vitest';
import {
    QUALITY_WINDOWS, DEFAULT_QUALITY_WINDOW, FEATURE_LABELS, KIND_LABELS, likedPercent, trendBars,
} from '@/views/Ai/qualityView';

describe('quality windows and labels', () => {
    it('the default window is one of the windows offered', () => {
        expect(QUALITY_WINDOWS).toContain(DEFAULT_QUALITY_WINDOW);
        expect([...QUALITY_WINDOWS]).toEqual([...QUALITY_WINDOWS].sort((a, b) => a - b));
    });

    it('no feature or kind is listed twice', () => {
        expect(new Set(FEATURE_LABELS).size).toBe(FEATURE_LABELS.length);
        expect(new Set(KIND_LABELS).size).toBe(KIND_LABELS.length);
    });

    it('the lists cannot be changed by accident', () => {
        expect(Object.isFrozen(QUALITY_WINDOWS)).toBe(true);
        expect(Object.isFrozen(FEATURE_LABELS)).toBe(true);
        expect(Object.isFrozen(KIND_LABELS)).toBe(true);
    });
});

describe('likedPercent', () => {
    it('is the share of thumbs up, rounded', () => {
        expect(likedPercent({ up: 3, down: 1 })).toBe(75);
        expect(likedPercent({ up: 1, down: 2 })).toBe(33);
        expect(likedPercent({ up: 2, down: 1 })).toBe(67);
        expect(likedPercent({ up: 5, down: 0 })).toBe(100);
        expect(likedPercent({ up: 0, down: 4 })).toBe(0);
    });

    it('with no ratings at all there is no percent, which is not the same as 0%', () => {
        expect(likedPercent({ up: 0, down: 0 })).toBeNull();
        expect(likedPercent({})).toBeNull();
        expect(likedPercent()).toBeNull();
    });

    it('a missing side counts as zero', () => {
        expect(likedPercent({ up: 4 })).toBe(100);
        expect(likedPercent({ down: 4 })).toBe(0);
    });
});

describe('trendBars', () => {
    it('no days gives no bars', () => {
        expect(trendBars([])).toEqual([]);
        expect(trendBars()).toEqual([]);
    });

    it('the busiest day fills the height, thumbs down on the baseline and thumbs up above it', () => {
        const [bar] = trendBars([{ day: '2025-03-01', up: 3, down: 1 }], 100, 40);
        expect(bar.day).toBe('2025-03-01');
        expect(bar.down).toEqual({ y: 30, height: 10 });
        expect(bar.up).toEqual({ y: 0, height: 30 });
    });

    it('a quieter day is scaled to the busiest one', () => {
        const bars = trendBars([{ day: 'a', up: 4, down: 0 }, { day: 'b', up: 1, down: 0 }], 100, 40);
        expect(bars[0].up.height).toBe(40);
        expect(bars[1].up.height).toBe(10);
    });

    it('bars share the width, each 70% of its slot and centred in it', () => {
        const bars = trendBars([{ day: 'a', up: 1 }, { day: 'b', up: 1 }], 100, 40);
        expect(bars[0].width).toBeCloseTo(35);
        expect(bars[0].x).toBeCloseTo(7.5);
        expect(bars[1].x).toBeCloseTo(57.5);
    });

    it('a day with no ratings is a flat bar on the baseline, and an all-quiet series does not divide by zero', () => {
        const bars = trendBars([{ day: 'a' }, { day: 'b' }], 100, 40);
        bars.forEach((bar) => {
            expect(bar.up.height).toBe(0);
            expect(bar.down.height).toBe(0);
            expect(bar.down.y).toBe(40);
            expect(Number.isFinite(bar.up.y)).toBe(true);
        });
    });

    it('a very narrow chart still draws bars at least 1 wide', () => {
        expect(trendBars(Array.from({ length: 100 }, (_, i) => ({ day: String(i), up: 1 })), 10, 10)[0].width).toBe(1);
    });
});
