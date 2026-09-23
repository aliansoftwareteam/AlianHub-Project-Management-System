import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, route, router, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { params: { id: 'a1' }, query: {} },
    router: { replace: vi.fn(), push: vi.fn() },
    toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import AgentSettings from '@/views/Ai/AgentSettings.vue';
import { changedFields, formFromAgent } from '@/views/Ai/agentSavePatch';
import { diffSnapshots } from '@/views/Ai/revisionDiff';

const OWNER = 1;
// Created before the rate limit was offered: the record has no rateLimitPerDay, and the form shows 40.
const agent = { _id: 'a1', name: 'Reviewer', autonomy: 1, spendCapUsd: 30, model: '', projectIds: [], skills: [{ key: 'qa', name: 'QA', enabled: true }, { key: 'triage', name: 'Triage', enabled: true }] };

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const serve = () => apiRequest.mockImplementation((type, url) => {
    if (type !== 'get') return ok({});
    if (url === '/api/v2/agents') return ok([agent]);
    if (url === '/api/v2/agents/registry') return ok({ actions: [], never: [], autonomy: [{ level: 0 }, { level: 1 }, { level: 2 }] });
    return ok([]);
});

const puts = () => apiRequest.mock.calls.filter(([type]) => type === 'put');

const mounted = [];
const mountSettings = async () => {
    const wrapper = mount(AgentSettings, {
        global: {
            plugins: [createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: OWNER }) } } } })],
            provide: { $userId: ref('u1'), $companyId: ref('company-1') },
            stubs: { RouterLink: RouterLinkStub, ShellIcon: true, AgentRevisionHistory: true, AiSidebar: true }
        }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    Object.values(toast).forEach((fn) => fn.mockReset());
    serve();
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

describe('saving agent settings', () => {
    it('sends only the skills when the only change is a skill toggle', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('#sk-triage').setValue(false);
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        expect(puts()).toHaveLength(1);
        const [, url, body] = puts()[0];
        expect(url).toBe('/api/v2/agents/a1');
        expect(Object.keys(body).sort()).toEqual(['_id', 'skills']);
        expect(body.skills).toEqual([{ key: 'qa', name: 'QA', enabled: true }, { key: 'triage', name: 'Triage', enabled: false }]);
    });

    it('produces a revision diff that names only skills', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('#sk-triage').setValue(false);
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        const set = { ...puts()[0][2] };
        delete set._id;
        const before = { ...agent };
        delete before._id;
        const after = { ...before, ...set };
        expect(diffSnapshots(before, after).map((d) => d.field)).toEqual(['skills']);
    });

    it('does not call the server when nothing changed', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        expect(puts()).toHaveLength(0);
        expect(toast.info).toHaveBeenCalledWith('Ai.nothing_changed', expect.anything());
    });

    it('still sends a field the user did change', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('#rate').setValue(12);
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        expect(puts()[0][2]).toEqual({ _id: 'a1', rateLimitPerDay: 12 });
    });
});

describe('changedFields', () => {
    it('treats the display default of an unset field as unchanged', () => {
        const shown = formFromAgent({});
        expect(changedFields(shown, { ...shown })).toEqual({});
        expect(changedFields(shown, { ...shown, projectIds: ['p1'] })).toEqual({ projectIds: ['p1'] });
    });
});
