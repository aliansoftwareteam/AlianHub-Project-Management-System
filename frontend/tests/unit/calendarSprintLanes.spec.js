/* The Calendar's sprint strip gives every sprint that overlaps another its own lane, so two sprints with the
   same dates are stacked, not drawn on top of each other. The real component; only HTTP is a stand-in. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { ref } from 'vue';
import en from '@/locales/en';

vi.mock('@/services', async () => ({ apiRequest: (await import('../fakeTaskServer')).apiRequest }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));

import '@/services';
import Store from '@/store/index';
import CalendarViewComponent from '@/views/Projects/ProjectCalendarView/CalendarViewComponent.vue';
import { resetServer } from '../fakeTaskServer';
import { PROJECT, SPRINT, seedStore, threeLevels } from '../threeLevelTasks';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const dayOfThisMonth = (day) => {
    const date = new Date();
    date.setDate(day);
    date.setHours(12, 0, 0, 0);
    return date.getTime();
};

const sprint = (id, name, from, to) => ({ id, name, private: false, startDate: dayOfThisMonth(from), endDate: dayOfThisMonth(to) });

let wrapper;

async function openCalendar(sprintsObj) {
    wrapper = mount(CalendarViewComponent, {
        props: { sprint: { id: SPRINT, _id: SPRINT, name: 'List' }, projectData: { ...PROJECT, sprintsObj } },
        global: {
            plugins: [Store],
            mocks: { $t: (...args) => i18n.global.t(...args) },
            provide: { $companyId: ref('c1'), $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY'), searchedTask: ref(false), toggleTaskDetail: vi.fn() },
            stubs: { SpinnerComp: true, RouterLink: true }
        }
    });
    await flushPromises();
    await flushPromises();
}

const bands = () => wrapper.findAll('.cv__band');
const laneOf = (band) => Number(band.attributes('style').match(/--lane:\s*(\d+)/)[1]);
const stripLanes = () => Number(wrapper.get('.cv__bands').attributes('style').match(/--lanes:\s*(\d+)/)[1]);

beforeEach(() => {
    resetServer(threeLevels());
    seedStore(Store);
    Store.state.projectData.mongoUpdatedTask = {};
});
afterEach(() => wrapper?.unmount());

describe('the sprint strip of the calendar', () => {
    it('stacks two sprints with the same dates in their own lanes and grows the strip to hold both', async () => {
        await openCalendar({
            a: sprint('a', '[QA bench] Sprint 9', 5, 18),
            b: sprint('b', '[QA bench2] Sprint 9', 5, 18),
        });
        expect(bands()).toHaveLength(2);
        expect(bands().map(laneOf).sort()).toEqual([0, 1]);
        expect(stripLanes()).toBe(2);
    });

    it('keeps sprints that do not overlap on one lane', async () => {
        await openCalendar({ a: sprint('a', 'First', 1, 7), b: sprint('b', 'Second', 9, 15) });
        expect(bands().map(laneOf)).toEqual([0, 0]);
        expect(stripLanes()).toBe(1);
    });

    it('is not hidden on a phone and truncates a long label with an ellipsis', () => {
        const css = readFileSync(resolve(__dirname, '../../src/views/Projects/ProjectCalendarView/style.css'), 'utf8');
        expect(css).not.toMatch(/\.cv__bands\s*\{\s*display:\s*none/);
        expect(css).toMatch(/\.cv__band\s*\{[^}]*text-overflow:\s*ellipsis/);
    });
});
