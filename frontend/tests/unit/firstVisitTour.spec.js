import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import fs from 'fs';
import path from 'path';

const { apiRequestWithoutCompnay, me, route } = vi.hoisted(() => ({
    apiRequestWithoutCompnay: vi.fn(),
    me: { value: {} },
    route: { current: null }
}));

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRoute: () => route.current }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => me.value }) }));

import TourComponet from '@/components/organisms/Tour/TourComponet.vue';
import { TOUR, STOPS, mayAutoStart, placePopover } from '@/components/organisms/Tour/tourSteps';
import { SHORTCUTS } from '@/composable/shortcuts';
import { resetOnboardingRecord } from '@/composable/onboardingState';
import { shellState, openPanel } from '@/components/organisms/Shell/shellState';
import { USER_ONBOARDING } from '@/config/env';

const SRC = path.join(__dirname, '../../src');
const START_DELAY_MS = 600;
const popover = () => document.querySelector('[data-test="first-tour"] [role="dialog"]');
const press = (selector) => document.querySelector(`[data-test="${selector}"]`).click();

let wrapper;
const mountTour = () => {
    wrapper = mount(TourComponet, { global: { provide: { $userId: { value: 'user-1' } } } });
    return wrapper;
};
const land = async () => {
    mountTour();
    vi.advanceTimersByTime(START_DELAY_MS);
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="before">Before</button>';
    localStorage.clear();
    resetOnboardingRecord();
    shellState.tourAsked = false;
    me.value = { _id: 'user-1', tourStatus: {}, homeChecklist: {} };
    route.current = reactive({ name: 'Home', fullPath: '/c1', meta: {}, query: {} });
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true } });
});

afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('the stops', () => {
    it('are four at most, each naming one thing and one key from the shortcut registry', () => {
        expect(STOPS.length).toBeLessThanOrEqual(4);
        expect(STOPS.map((s) => s.key)).toEqual(['rail', 'tree', 'views', 'panel']);
        for (const stop of STOPS) {
            expect(stop.els.length).toBeGreaterThan(0);
            expect(SHORTCUTS.map((s) => s.id)).toContain(stop.shortcut);
        }
    });

    it('walks forward and back, shows the key of each stop, and ends on Done', async () => {
        await land();
        expect(popover().textContent).toContain('Auth.tour_first_rail_title');
        expect(popover().querySelector('kbd').textContent).toMatch(/K$/);
        expect(document.querySelector('[data-test="tour-back"]')).toBeNull();
        for (const key of ['tree', 'views', 'panel']) {
            press('tour-next');
            await flushPromises();
            expect(popover().textContent).toContain(`Auth.tour_first_${key}_title`);
        }
        press('tour-back');
        await flushPromises();
        expect(popover().textContent).toContain('Auth.tour_first_views_title');
        press('tour-next');
        await flushPromises();
        expect(document.querySelector('[data-test="tour-next"]').textContent).toContain('Auth.tour_done');
        press('tour-next');
        await flushPromises();
        expect(popover()).toBeNull();
    });
});

describe('once per person', () => {
    it('starts on a first visit and writes that to the user record', async () => {
        await land();
        expect(popover()).not.toBeNull();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', USER_ONBOARDING, { tourOffered: TOUR });
    });

    it('does not start again on another device once the record says it was offered', async () => {
        me.value = { ...me.value, homeChecklist: { toursOffered: [TOUR] } };
        await land();
        expect(popover()).toBeNull();
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });

    it('does not start again in the same session after it was closed', async () => {
        await land();
        press('tour-skip');
        await flushPromises();
        route.current.name = 'Projects';
        await nextTick();
        vi.advanceTimersByTime(START_DELAY_MS);
        await flushPromises();
        expect(popover()).toBeNull();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['finished the old shell tour', () => { me.value = { ...me.value, tourStatus: { isShellTour: true } }; }],
        ['closed the setup card', () => { me.value = { ...me.value, homeChecklist: { dismissed: true } }; }],
        ['carries the key the e2e skipFirstRun helper sets', () => localStorage.setItem('ah.tour.skipped.shell', '1')]
    ])('leaves alone someone who %s', async (_name, arrange) => {
        arrange();
        await land();
        expect(popover()).toBeNull();
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });

    it('allows a start only when nothing rules it out', () => {
        const clear = { seen: false, skipped: false, legacyDone: false, dismissed: false, blocked: false };
        expect(mayAutoStart(clear)).toBe(true);
        for (const key of Object.keys(clear)) expect(mayAutoStart({ ...clear, [key]: true })).toBe(false);
    });
});

describe('it stays out of the way', () => {
    it('does not start while a dialog is open, and is not counted as offered', async () => {
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"></div>');
        await land();
        expect(popover()).toBeNull();
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });

    it('does not start under a dialog that opened while it was waiting', async () => {
        mountTour();
        document.body.insertAdjacentHTML('beforeend', '<div class="ah-detail"></div>');
        vi.advanceTimersByTime(START_DELAY_MS);
        await flushPromises();
        expect(popover()).toBeNull();
    });

    it('does not take the focus from someone who is typing', async () => {
        document.body.insertAdjacentHTML('beforeend', '<input id="typing" type="text" />');
        document.getElementById('typing').focus();
        await land();
        expect(popover()).toBeNull();
        expect(document.activeElement.id).toBe('typing');
    });

    it('is not modal, puts no layer over the page and lets clicks through its ring', async () => {
        await land();
        expect(popover().getAttribute('aria-modal')).toBe('false');
        expect(document.querySelector('.driver-overlay')).toBeNull();
        const css = fs.readFileSync(path.join(SRC, 'components/organisms/Tour/style.css'), 'utf8');
        expect(css).toMatch(/\.ah-coach__ring \{[^}]*pointer-events: none/);
        expect(css).not.toMatch(/inset: 0/);
        expect(css.split('@media (prefers-reduced-motion: no-preference)')[0]).not.toMatch(/transition|animation/);
    });

    it('closes on Escape and gives focus back', async () => {
        const before = document.getElementById('before');
        before.focus();
        await land();
        expect(document.activeElement).toBe(document.querySelector('[data-test="tour-next"]'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flushPromises();
        expect(popover()).toBeNull();
        expect(document.activeElement).toBe(before);
    });

    const VIEW = { width: 1280, height: 800 };
    const PHONE = { width: 390, height: 844 };
    const SIZE = { width: 320, height: 190 };
    const overlaps = (spot, size, box) => spot.left < box.right && spot.left + size.width > box.left && spot.top < box.bottom && spot.top + size.height > box.top;

    it.each([
        ['the rail', VIEW, { left: 0, top: 0, right: 56, bottom: 800 }, 'right'],
        ['the project tree', VIEW, { left: 56, top: 120, right: 296, bottom: 620 }, 'right'],
        ['the view tabs', VIEW, { left: 296, top: 48, right: 1280, bottom: 84 }, 'bottom'],
        ['the task panel', VIEW, { left: 720, top: 0, right: 1280, bottom: 800 }, 'left'],
        ['the phone tab bar', PHONE, { left: 0, top: 788, right: 390, bottom: 844 }, 'right'],
        ['the phone view tabs', PHONE, { left: 0, top: 96, right: 390, bottom: 136 }, 'bottom']
    ])('never covers %s and stays on screen', (_name, viewport, box, side) => {
        const size = { ...SIZE, width: Math.min(SIZE.width, viewport.width - 24) };
        const spot = placePopover(box, size, viewport, side);
        expect(overlaps(spot, size, box)).toBe(false);
        expect(spot.left).toBeGreaterThanOrEqual(0);
        expect(spot.top).toBeGreaterThanOrEqual(0);
        expect(spot.left + size.width).toBeLessThanOrEqual(viewport.width);
        expect(spot.top + size.height).toBeLessThanOrEqual(viewport.height);
    });

    it('docks in a corner when the thing it describes is not on screen', () => {
        expect(placePopover(null, SIZE, VIEW, 'left')).toEqual({ left: 1280 - 320 - 12, top: 800 - 190 - 12, side: 'none' });
    });
});

describe('offered again', () => {
    it('starts from the "Take the tour" menu item, even for someone who has seen it', async () => {
        me.value = { ...me.value, homeChecklist: { toursOffered: [TOUR] } };
        await land();
        expect(popover()).toBeNull();
        openPanel('tourAsked');
        await flushPromises();
        expect(popover()).not.toBeNull();
        expect(shellState.tourAsked).toBe(false);
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });

    it('is the tour item of the More menu', () => {
        const nav = fs.readFileSync(path.join(SRC, 'components/organisms/Shell/navItems.js'), 'utf8');
        expect(nav).toMatch(/key: "tour", label: "Home\.take_tour", icon: "tour", panel: "tourAsked"/);
    });
});
