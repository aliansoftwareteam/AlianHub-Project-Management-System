/* UIX-11 — below 1280 px the Home planner opened on every visit, over My Work and the setup card. */
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn(() => Promise.resolve()) }));

const PLANNER_KEY = 'ah.home.planner';
const initialWidth = window.innerWidth;

const setWidth = (width) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });

const openHome = async (width, remembered) => {
    vi.resetModules();
    setWidth(width);
    localStorage.clear();
    if (remembered !== undefined) localStorage.setItem(PLANNER_KEY, remembered);
    const { homeState } = await import('@/components/molecules/Home/homeState');
    return homeState;
};

afterEach(() => {
    setWidth(initialWidth);
    localStorage.clear();
});

describe('the planner on a first visit', () => {
    it.each([
        [390, false],
        [800, false],
        [1279, false],
        [1280, true],
        [1440, true]
    ])('at %i px starts open: %s', async (width, open) => {
        expect((await openHome(width)).plannerOpen).toBe(open);
    });
});

describe('a remembered choice wins over the width', () => {
    it.each([390, 800, 1280])('remembered open at %i px', async (width) => {
        expect((await openHome(width, '1')).plannerOpen).toBe(true);
    });

    it.each([390, 800, 1280])('remembered closed at %i px', async (width) => {
        expect((await openHome(width, '0')).plannerOpen).toBe(false);
    });

    it('opening it at 800 px keeps it open on the next visit', async () => {
        const homeState = await openHome(800);
        homeState.plannerOpen = true;
        await nextTick();
        expect(localStorage.getItem(PLANNER_KEY)).toBe('1');
        vi.resetModules();
        const { homeState: next } = await import('@/components/molecules/Home/homeState');
        expect(next.plannerOpen).toBe(true);
    });
});

describe('an open planner below 1280 px', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../src/views/Home/style.css'), 'utf8');
    const plannerRules = [...css.matchAll(/\.home__planner\s*\{([^}]*)\}/g)].map((match) => match[1]);

    it('sits beside the content instead of floating over the setup card', () => {
        expect(plannerRules.length).toBeGreaterThan(0);
        for (const rule of plannerRules) expect(rule).not.toMatch(/position:\s*(absolute|fixed)/);
    });

    it('lets the setup card stack as on a phone while the content is narrow', () => {
        expect(css).toMatch(/\.home:has\(\.home__planner\)\s+\.hc-setup\s*\{[^}]*flex-wrap:\s*wrap/);
    });
});
