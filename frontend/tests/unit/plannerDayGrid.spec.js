import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ref } from 'vue';
import moment from 'moment';

vi.mock('vue-router', () => ({ useRouter: () => ({ hasRoute: () => false, push: vi.fn() }) }));
vi.mock('@/views/TaskDetail/TaskDetail.vue', () => ({ default: { name: 'TaskDetail', template: '<div />' } }));
vi.mock('@/components/molecules/Home/useMyWork', () => ({
    useMyWork: () => ({
        loaded: ref(true),
        mine: ref([]),
        openTasks: ref([]),
        projectOf: () => null,
        fetchOpen: () => Promise.resolve(),
        schedule: vi.fn(() => Promise.resolve()),
    }),
}));
vi.mock('@/components/molecules/Home/useAgenda', () => ({
    useAgenda: () => ({
        connected: ref(false),
        load: () => Promise.resolve(),
        addFocus: vi.fn(),
        removeFocus: vi.fn(),
        itemsFor: (date) => (moment(date).isoWeekday() === 1
            ? [{ id: 'early', kind: 'focus', title: 'Early focus', start: moment(date).hour(7).minute(0), end: moment(date).hour(8).minute(0) }]
            : []),
    }),
}));
vi.mock('@/components/molecules/Home/useTimer', () => ({ useTimer: () => ({ timer: { active: null }, elapsedMs: ref(0) }) }));

import Planner from '@/views/Planner/Planner.vue';

const HOUR_PX = 60;
let wrapper;
const gridWrap = () => wrapper.find('.planner__grid-wrap');

const mountPlanner = async () => {
    wrapper = mount(Planner, {
        attachTo: '#app',
        global: {
            provide: { $dateFormat: ref('DD/MM/YYYY') },
            stubs: { ContextSidebar: { template: '<aside><slot /></aside>' }, ShellIcon: true, 'router-link': { template: '<a><slot /></a>' } },
        },
    });
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 8, 28, 3, 30));
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    localStorage.clear();
});

describe('the planner day grid', () => {
    it('lays out the whole day, midnight to midnight', async () => {
        await mountPlanner();
        const hours = wrapper.findAll('.planner__hour').map((h) => h.text());
        expect(hours).toHaveLength(24);
        expect(hours[0]).toBe('00');
        expect(hours[23]).toBe('23');
        expect(wrapper.find('.planner__col').attributes('style')).toContain(`height: ${24 * HOUR_PX}px`);
    });

    it('opens scrolled to the start of the working hours', async () => {
        await mountPlanner();
        expect(gridWrap().element.scrollTop).toBe(9 * HOUR_PX);
    });

    it('scrolls to the new start when the working hours change', async () => {
        localStorage.setItem('ah.planner.start', '9');
        localStorage.setItem('ah.planner.end', '18');
        await mountPlanner();
        await wrapper.find('.planner__hours').trigger('click');
        await flushPromises();
        expect(gridWrap().element.scrollTop).toBe(8 * HOUR_PX);
    });

    it('places blocks and the now line on the full-day scale, outside working hours too', async () => {
        await mountPlanner();
        const block = wrapper.find('.planner__block--focus');
        expect(block.exists()).toBe(true);
        expect(block.attributes('style')).toContain(`top: ${7 * HOUR_PX + 2}px`);
        const now = wrapper.find('.planner__now');
        expect(now.exists()).toBe(true);
        expect(now.attributes('style')).toContain(`top: ${3.5 * HOUR_PX}px`);
    });

    it('shades the hours outside the working day', async () => {
        await mountPlanner();
        const [before, after] = wrapper.find('.planner__col').findAll('.planner__off');
        expect(before.attributes('style')).toContain(`height: ${9 * HOUR_PX}px`);
        expect(after.attributes('style')).toContain(`top: ${18 * HOUR_PX}px`);
    });

    it('lets the keyboard scroll the hours', async () => {
        await mountPlanner();
        expect(gridWrap().attributes('tabindex')).toBe('0');
        expect(gridWrap().attributes('role')).toBe('region');
        expect(gridWrap().attributes('aria-label')).toBe('Home.planner_grid');
    });
});

describe('the planner layout', () => {
    const css = readFileSync(resolve(__dirname, '../../src/views/Planner/style.css'), 'utf8');
    const firstRule = (selector) => css.match(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[2] || '';

    it('lets the grid take the height left under the toolbar', () => {
        expect(firstRule('.planner__grid-wrap')).toMatch(/flex:\s*1/);
        expect(firstRule('.planner__grid-wrap')).toMatch(/min-height:\s*0/);
    });

    it('leaves room above the first unscheduled card so its edge is not cut off', () => {
        expect(firstRule('.planner__tray-list')).toMatch(/padding(-top)?:\s*[1-9]/);
    });
});
