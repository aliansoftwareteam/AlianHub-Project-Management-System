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
import { formFromAgent } from '@/views/Ai/agentSavePatch';
import serverLimit from '../../../Modules/Agents/dailyRunLimit.js';

const OWNER = 1;
let current;
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const serve = () => apiRequest.mockImplementation((type, url) => {
    if (type !== 'get') return ok({});
    if (url === '/api/v2/agents') return ok([current]);
    if (url === '/api/v2/agents/registry') return ok({ actions: [], never: [], autonomy: [{ level: 0 }, { level: 1 }, { level: 2 }] });
    return ok([]);
});

const mounted = [];
const mountSettings = async (agentOver) => {
    current = { _id: 'a1', name: 'Reviewer', autonomy: 1, spendCapUsd: 30, model: '', projectIds: [], skills: [], ...agentOver };
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
    serve();
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

describe('the daily run limit the settings page shows', () => {
    it('shows the default the server enforces when the agent has none stored', () => {
        expect(serverLimit.DEFAULT_RATE_LIMIT_PER_DAY).toBe(40);
        expect(formFromAgent({}).rateLimitPerDay).toBe(serverLimit.DEFAULT_RATE_LIMIT_PER_DAY);
        expect(formFromAgent({ rateLimitPerDay: null }).rateLimitPerDay).toBe(serverLimit.DEFAULT_RATE_LIMIT_PER_DAY);
    });

    it('shows a stored limit as stored, 0 included', () => {
        expect(formFromAgent({ rateLimitPerDay: 12 }).rateLimitPerDay).toBe(12);
        expect(formFromAgent({ rateLimitPerDay: 0 }).rateLimitPerDay).toBe(0);
    });

    it('fills the field with the default, and with 0 for an agent set to no daily limit', async () => {
        expect((await mountSettings({})).find('#rate').element.value).toBe(String(serverLimit.DEFAULT_RATE_LIMIT_PER_DAY));
        expect((await mountSettings({ rateLimitPerDay: 0 })).find('#rate').element.value).toBe('0');
    });

    it('lets 0 be entered and says what 0 means', async () => {
        const wrapper = await mountSettings({});
        expect(wrapper.find('#rate').attributes('min')).toBe('0');
        expect(wrapper.find('[data-test="rate-hint"]').text()).toBe('Ai.rate_limit_hint');
    });
});
