import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const m = vi.hoisted(() => ({ apiRequest: vi.fn(), perm: vi.fn(), buildFilterQuery: vi.fn() }));

vi.mock('vuex', async (orig) => ({ ...(await orig()), useStore: () => ({ getters: { 'settings/teams': [] } }) }));
vi.mock('@/services', () => ({ apiRequest: m.apiRequest }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: m.perm }) }));
vi.mock('@/composable/commonFunction', () => ({
    getConvertedTimeString: (v) => `${v}h!`,
    buildFilterQuery: m.buildFilterQuery,
    getTimeRange: () => ({ start: 100, end: 200 }),
    teamIdToUserId: (q) => q,
}));

import TotalTaskCardComponent from '@/components/organisms/TotalTaskCardComponent/TotalTaskCardComponent.vue';

const card = (over = {}) => ({ measure: 3, calculation: 1, projectId: ['p1'], AssigneeUserId: ['u2'], taskLabel: 'Tasks', ...over });
const mountCard = async (cardData, extra = {}) => {
    const w = mount(TotalTaskCardComponent, {
        props: { cardUID: 'c', cardData, allProjectsArrayFilter: [{ _id: 'p1' }, { _id: 'p2' }], filterData: {}, ...extra },
        global: { provide: { $userId: ref('me') }, stubs: { SkelatonVue: { template: '<div class="skel" />' }, Skelaton: { template: '<div class="skel" />' } } },
    });
    await flushPromises();
    return w;
};
const lastCall = () => m.apiRequest.mock.calls.at(-1);

beforeEach(() => {
    m.apiRequest.mockReset().mockResolvedValue({ status: 200, data: [{ taskCount: 12 }] });
    m.perm.mockReset().mockReturnValue(2);
    m.buildFilterQuery.mockReset().mockReturnValue([]);
});

describe('TotalTaskCardComponent states', () => {
    it('shows a skeleton while loading, then the task count and its label', async () => {
        let done;
        m.apiRequest.mockReturnValue(new Promise((r) => { done = r; }));
        const w = await mountCard(card());
        expect(w.find('.skel').exists()).toBe(true);
        done({ status: 200, data: [{ taskCount: 12 }] });
        await flushPromises();
        expect(w.find('.skel').exists()).toBe(false);
        expect(w.text()).toContain('12');
        expect(w.text()).toContain('Tasks');
    });

    it('shows 0 when there are no matching tasks', async () => {
        m.apiRequest.mockResolvedValue({ status: 200, data: [] });
        expect((await mountCard(card())).text()).toContain('0');
    });

    it('shows 0 for a count card when the request fails', async () => {
        m.apiRequest.mockRejectedValue(new Error('x'));
        const w = await mountCard(card());
        expect(w.find('.skel').exists()).toBe(false);
        expect(w.text()).toContain('0');
    });

    it('shows 0h for a time card when the request fails', async () => {
        m.apiRequest.mockRejectedValue(new Error('x'));
        const w = await mountCard(card({ measure: 1 }));
        expect(w.text()).toContain('0h');
        expect(w.text()).not.toContain('Tasks');
    });

    // a non-200 reply sets the value but never clears the loading flag
    it.fails('shows 0 instead of a skeleton when the server answers non-200', async () => {
        m.apiRequest.mockResolvedValue({ status: 500, data: {} });
        const w = await mountCard(card());
        expect(w.find('.skel').exists()).toBe(false);
        expect(w.text()).toContain('0');
    });
});

describe('TotalTaskCardComponent time cards', () => {
    it('sums estimated time (measure 1) through the estimate endpoint', async () => {
        m.apiRequest.mockResolvedValue({ status: 200, data: [{ totalEstimatedTime: 5 }] });
        const w = await mountCard(card({ measure: 1, calculation: 1 }));
        expect(w.text()).toBe('5h!');
        expect(lastCall()[1]).not.toMatch(/find$/);
    });

    it('shows the median for calculation 3, even and odd', async () => {
        m.apiRequest.mockResolvedValue({ status: 200, data: [{ totalEstimatedTime: [9, 1, 5] }] });
        expect((await mountCard(card({ measure: 2, calculation: 3 }))).text()).toBe('5h!');
        m.apiRequest.mockResolvedValue({ status: 200, data: [{ totalEstimatedTime: [1, 3, 5, 9] }] });
        expect((await mountCard(card({ measure: 2, calculation: 3 }))).text()).toBe('4h!');
    });

    it('shows min - max for calculation 6', async () => {
        m.apiRequest.mockResolvedValue({ status: 200, data: [{ minEstimatedTime: 1, maxEstimatedTime: 8 }] });
        expect((await mountCard(card({ measure: 1, calculation: 6 }))).text()).toBe('1h! - 8h!');
    });
});

describe('TotalTaskCardComponent permissions and scope', () => {
    const userFilter = () => JSON.stringify(lastCall()[2]);

    it('a timesheet card limited to own data queries only the current user', async () => {
        m.perm.mockReturnValue(1);
        await mountCard(card({ measure: 2 }));
        expect(userFilter()).toContain('"Loggeduser":{"$in":["me"]}');
    });

    it('full permission queries the selected assignees', async () => {
        m.perm.mockReturnValue(2);
        await mountCard(card({ measure: 2 }));
        expect(userFilter()).toContain('"Loggeduser":{"$in":["u2"]}');
    });

    it('no permission queries nobody', async () => {
        m.perm.mockReturnValue(0);
        await mountCard(card({ measure: 1 }));
        expect(userFilter()).toContain('"UserId":{"$in":[]}');
    });

    it('exclude mode counts every accessible project except the excluded one', async () => {
        await mountCard(card({ projectMode: 'exclude', projectId: ['p1'] }));
        expect(userFilter()).toContain('"$in":["p2"]');
    });

    it('an empty project selection falls back to all accessible projects', async () => {
        await mountCard(card({ projectId: [] }));
        expect(userFilter()).toContain('"$in":["p1","p2"]');
    });
});

describe('TotalTaskCardComponent updates', () => {
    it('refetches and shows the new number when the card data changes', async () => {
        const w = await mountCard(card());
        m.apiRequest.mockResolvedValue({ status: 200, data: [{ taskCount: 99 }] });
        await w.setProps({ cardData: card({ taskLabel: 'Open' }) });
        await flushPromises();
        expect(w.text()).toContain('99');
        expect(w.text()).toContain('Open');
    });

    it('does not refetch when the new data is identical', async () => {
        const w = await mountCard(card());
        const n = m.apiRequest.mock.calls.length;
        await w.setProps({ cardData: card() });
        await flushPromises();
        expect(m.apiRequest.mock.calls.length).toBe(n);
    });
});

describe('TotalTaskCardComponent i18n', () => {
    it('template has no hard-coded visible text', () => {
        const src = readFileSync(resolve(__dirname, '../../src/components/organisms/TotalTaskCardComponent/TotalTaskCardComponent.vue'), 'utf8');
        const tpl = src.slice(0, src.indexOf('<script')).replace(/="[^"]*"/g, '');
        expect(tpl.match(/>[^<>{}]*[A-Za-z]{2,}[^<>{}]*</g) || []).toEqual([]);
    });
});
