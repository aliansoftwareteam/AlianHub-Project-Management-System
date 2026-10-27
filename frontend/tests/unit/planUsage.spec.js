import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

const GB = 1024 ** 3;

const mocks = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    route: { name: 'Home' },
    getters: {},
    publicConfig: null,
}));

vi.mock('@/services', () => ({ apiRequest: mocks.apiRequest, apiRequestWithoutCompnay: mocks.apiRequestWithoutCompnay }));
vi.mock('@/config/publicConfig', async () => {
    const { reactive: make } = await import('vue');
    mocks.publicConfig = make({ loaded: true, hosting: { mode: 'managed', portalUrl: 'https://account.example.test/i/ins_1', lifecycle: 'active', graceUntil: null } });
    return { publicConfig: mocks.publicConfig, isManagedHosting: () => mocks.publicConfig.hosting.mode === 'managed' };
});
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace, push: mocks.push, hasRoute: () => true }), useRoute: () => ({ query: {}, params: {} }) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: mocks.getters }) }));
vi.mock('@/router', () => ({ default: { currentRoute: { value: mocks.route }, replace: mocks.replace } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'AuthShell', setup: (props, { slots }) => () => h('div', slots.default && slots.default()) } };
});

import * as env from '@/config/env';
import PlanUsage from '@/views/Settings/Plan/PlanUsage.vue';
import PlanBanner from '@/components/organisms/PlanBanner/PlanBanner.vue';
import Suspended from '@/views/Authentication/Suspended/Suspended.vue';
import { planState, formatPlanBytes, percentOf } from '@/composable/planUsage';
import { installPlanAnswers, lockOf, planRefusalText } from '@/services/planAnswers';

const usageOf = (over = {}) => ({
    managed: true,
    plan: 'pro',
    version: 7,
    portalUrl: 'https://account.example.test/i/ins_1',
    canManage: true,
    lifecycle: { state: 'active', message: '', graceUntil: null },
    seats: { used: 23, pending: 2, limit: 60, overLimit: false },
    guests: { used: 4, limit: 25, overLimit: false },
    storage: { bytes: 13.3 * GB, limit: 150 * GB, level: 0, byWorkspace: [{ companyId: 'c1', name: 'Acme', bytes: 13 * GB }, { companyId: 'c2', name: 'Acme Labs', bytes: 0.3 * GB }] },
    workspaces: { count: 2, limit: 3 },
    timeTracker: { enabled: true, used: 8, limit: 20 },
    maxFileBytes: 100 * 1024 * 1024,
    mail: { sentToday: 140, limit: 2000, capped: false, queued: 0 },
    ...over,
});

const answer = (data) => mocks.apiRequest.mockResolvedValue({ data: { status: true, data } });

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.assign(planState, { loading: false, loaded: false, failed: false, data: null });
    Object.assign(mocks.publicConfig.hosting, { mode: 'managed', lifecycle: 'active', graceUntil: null });
    mocks.getters['settings/companyUserDetail'] = { roleType: 1 };
    mocks.getters['settings/selectedCompany'] = { _id: 'company-1' };
    mocks.getters['settings/getSocketInstance'] = null;
    mocks.route.name = 'Home';
});

describe('the Plan & usage page', () => {
    it('shows every number of the plan, the split by workspace and the way to the portal', async () => {
        answer(usageOf());
        const wrapper = mount(PlanUsage);
        await flushPromises();
        expect(mocks.apiRequest).toHaveBeenCalledWith('get', env.PLAN_USAGE);
        for (const key of ['seats', 'guests', 'storage', 'workspaces', 'tracker', 'file', 'mail']) expect(wrapper.find(`[data-test="plan-${key}"]`).exists()).toBe(true);
        expect(wrapper.text()).toContain('Acme Labs');
        expect(wrapper.find('[role="progressbar"][aria-valuenow="38"]').exists()).toBe(true);
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        await wrapper.find('[data-test="plan-manage"]').trigger('click');
        expect(open).toHaveBeenCalledWith('https://account.example.test/i/ins_1', '_blank', 'noopener');
    });

    it('shows a member the numbers but no actions and no split by workspace', async () => {
        answer(usageOf({ canManage: false, storage: { bytes: GB, limit: 150 * GB, level: 0 } }));
        const wrapper = mount(PlanUsage);
        await flushPromises();
        expect(wrapper.find('[data-test="plan-manage"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="plan-add-more"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Plan.admins_only');
        expect(wrapper.text()).not.toContain('Acme Labs');
    });

    it('updates without a reload when the plan changes', async () => {
        answer(usageOf());
        const wrapper = mount(PlanUsage);
        await flushPromises();
        planState.data = usageOf({ seats: { used: 23, pending: 0, limit: 10, overLimit: true } });
        await flushPromises();
        expect(wrapper.find('[role="progressbar"][aria-valuenow="100"]').exists()).toBe(true);
        expect(wrapper.text()).toContain('Plan.seats_over');
    });

    it('says so on a self-hosted instance and asks nothing', async () => {
        mocks.publicConfig.hosting.mode = 'self';
        const wrapper = mount(PlanUsage);
        await flushPromises();
        expect(wrapper.find('[data-test="plan-self-hosted"]').exists()).toBe(true);
        expect(mocks.apiRequest).not.toHaveBeenCalled();
    });
});

describe('the plan banner', () => {
    const banner = async (data, lifecycle = 'active') => {
        mocks.publicConfig.hosting.lifecycle = lifecycle;
        answer(data);
        const wrapper = mount(PlanBanner);
        await flushPromises();
        return wrapper;
    };

    it('tells everyone a read-only workspace is read-only, and it cannot be put away', async () => {
        mocks.getters['settings/companyUserDetail'] = { roleType: 3 };
        const wrapper = await banner(usageOf(), 'read_only');
        expect(wrapper.find('[data-test="plan-banner-read_only"]').exists()).toBe(true);
        expect(wrapper.find('.pb__close').exists()).toBe(false);
    });

    it('shows owners the highest-priority message only', async () => {
        const wrapper = await banner(usageOf({ seats: { used: 12, pending: 0, limit: 10, overLimit: true }, storage: { bytes: 144 * GB, limit: 150 * GB, level: 95 } }), 'past_due');
        expect(wrapper.find('[data-test="plan-banner-past_due"]').exists()).toBe(true);
        await wrapper.find('.pb__close').trigger('click');
        expect(wrapper.find('[data-test="plan-banner-seats_over"]').exists()).toBe(true);
        await wrapper.find('.pb__close').trigger('click');
        expect(wrapper.find('[data-test="plan-banner-storage_95"]').exists()).toBe(true);
    });

    it('warns at 80% storage and keeps payment trouble from members', async () => {
        expect((await banner(usageOf({ storage: { bytes: 121 * GB, limit: 150 * GB, level: 80 } }))).find('[data-test="plan-banner-storage_80"]').exists()).toBe(true);
        mocks.getters['settings/companyUserDetail'] = { roleType: 3 };
        expect((await banner(usageOf({ storage: { bytes: 149 * GB, limit: 150 * GB, level: 95 } }), 'past_due')).find('.pb').exists()).toBe(false);
    });

    it('tells owners when the day\'s mail is used up', async () => {
        const wrapper = await banner(usageOf({ mail: { sentToday: 2000, limit: 2000, capped: true, queued: 4 } }));
        expect(wrapper.find('[data-test="plan-banner-mail_cap"]').exists()).toBe(true);
    });

    it('reloads the plan when the platform pushes a new one', async () => {
        const handlers = {};
        mocks.getters['settings/getSocketInstance'] = { on: (event, fn) => { handlers[event] = fn; }, off: vi.fn() };
        await banner(usageOf());
        mocks.apiRequest.mockClear();
        handlers.PLAN_UPDATED({ version: 8 });
        await flushPromises();
        expect(mocks.apiRequest).toHaveBeenCalledWith('get', env.PLAN_USAGE);
        handlers.INSTANCE_LIFECYCLE_CHANGED({ state: 'read_only' });
        expect(mocks.publicConfig.hosting.lifecycle).toBe('read_only');
    });
});

describe('the suspended notice', () => {
    it('says until when the data is kept and links the AlianHub account', () => {
        Object.assign(mocks.publicConfig.hosting, { lifecycle: 'suspended', graceUntil: '2026-12-02T00:00:00Z' });
        const wrapper = mount(Suspended);
        expect(wrapper.text()).toContain('Plan.locked.suspended_body');
        expect(wrapper.find('a[href="https://account.example.test/i/ins_1"]').exists()).toBe(true);
    });
});

describe('answers from the server', () => {
    const fakeInstance = () => {
        const handlers = {};
        installPlanAnswers({ interceptors: { response: { use: (ok, fail) => Object.assign(handlers, { ok, fail }) } } });
        return handlers;
    };

    it('says a plan refusal in the reader\'s words, with its numbers', async () => {
        const text = await planRefusalText({ status: false, code: 'seat_limit', limit: 10, used: 10 });
        expect(text).toContain('10');
        const handlers = fakeInstance();
        const response = await handlers.ok({ data: { status: false, code: 'workspace_limit', limit: 1, used: 1, statusText: 'English' } });
        expect(response.data.statusText).not.toBe('English');
        const fine = await handlers.ok({ data: { status: true } });
        expect(fine.data).toEqual({ status: true });
    });

    it('names the file an upload refusal is about', async () => {
        const file = new File(['x'], 'report.pdf');
        const data = new FormData();
        data.append('file', file);
        const handlers = fakeInstance();
        const error = { config: { data }, response: { status: 507, data: { status: false, code: 'storage_full', limit: 150 * GB, used: 150 * GB } } };
        await expect(handlers.fail(error)).rejects.toBe(error);
        expect(error.message).toContain('report.pdf');
        expect(error.message).toContain(formatPlanBytes(150 * GB));
    });

    it('sends a suspended answer to the suspended notice and reads a read-only one as a refusal', async () => {
        const handlers = fakeInstance();
        await expect(handlers.fail({ response: { status: 423, data: { code: 'suspended' } } })).rejects.toBeTruthy();
        expect(mocks.replace).toHaveBeenCalledWith({ name: 'Suspended' });
        mocks.replace.mockClear();
        const readOnly = { response: { status: 423, data: { code: 'read_only' } } };
        await expect(handlers.fail(readOnly)).rejects.toBe(readOnly);
        expect(mocks.replace).not.toHaveBeenCalled();
        expect(readOnly.response.data.status).toBe(false);
        expect(lockOf({ response: { status: 500 } })).toBeNull();
    });

    it('formats sizes the way the page shows them', () => {
        expect(formatPlanBytes(13.3 * GB)).toBe('13.3 GB');
        expect(percentOf(23, 60)).toBe(38);
        expect(percentOf(5, null)).toBe(0);
    });
});
