import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { theme: 'light', agentsRunning: 0 }, applyTheme: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => ({ default: { name: 'SpinnerComp', render: () => null } }));
vi.mock('@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue', () => ({ default: { name: 'WasabiImage', render: () => null } }));
vi.mock('@/components/atom/CroppingTool/CroppingTool.vue', () => ({ default: { name: 'CroppingTool', render: () => null } }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: () => ({ Employee_FName: 'Ada', Employee_LName: 'Lovelace', Employee_Email: 'ada@example.com' }) }),
    languageTranslateHelper: () => ({ selectedLanguageCode: ref('en'), changeLanguage: vi.fn() })
}));

import { useAgentPreferences } from '@/views/Ai/useAgentPreferences';
import MySettings from '@/views/Settings/MySettings/MySettings.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const httpError = (status, statusText) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false, statusText } } });

const candidate = { id: 'user.preference:too_many_changes', key: 'too_many_changes', text: 'Prefers fewer changes per proposal', count: 3 };
const prefs = { tone: 'concise', reviewDepth: null, notify: true, candidates: [candidate] };

const answer = (type, url, body) => {
    if (url.endsWith('/agents/preferences')) return ok(type === 'put' ? { ...prefs, ...body, candidates: prefs.candidates } : prefs);
    if (url.includes('/agents/memory/')) return ok({});
    return ok([]);
};

describe('useAgentPreferences', () => {
    beforeEach(() => { apiRequest.mockReset(); apiRequest.mockImplementation(answer); });

    it('seeds the draft from the server and is clean until something changes', async () => {
        const p = useAgentPreferences({ userId: ref('u1') });
        await p.load();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/preferences', undefined);
        expect(p.loaded.value).toBe(true);
        expect(p.draft).toEqual({ tone: 'concise', reviewDepth: null, notify: true });
        expect(p.candidates.value).toEqual([candidate]);
        expect(p.dirty.value).toBe(false);

        p.draft.tone = 'detailed';
        expect(p.dirty.value).toBe(true);
        p.draft.tone = 'concise';
        expect(p.dirty.value).toBe(false);
        p.draft.notify = false;
        expect(p.dirty.value).toBe(true);
    });

    it('drops values the contract does not know', async () => {
        apiRequest.mockImplementation(() => ok({ tone: 'shouty', reviewDepth: 'every_change', notify: 'no' }));
        const p = useAgentPreferences({ userId: 'u1' });
        await p.load();
        expect(p.draft).toEqual({ tone: null, reviewDepth: 'every_change', notify: true });
    });

    it('saves the three fields and resets the baseline to the answer', async () => {
        const p = useAgentPreferences({ userId: 'u1' });
        await p.load();
        p.draft.reviewDepth = 'every_change';
        p.draft.notify = false;
        await p.save();
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/preferences', { tone: 'concise', reviewDepth: 'every_change', notify: false });
        expect(p.dirty.value).toBe(false);
        expect(p.busy.value).toBe(false);
        expect(p.draft.reviewDepth).toBe('every_change');
    });

    it('accepts a candidate as the user and drops it from the list; dismiss retires it', async () => {
        const p = useAgentPreferences({ userId: ref('u1') });
        await p.load();
        await p.accept(candidate);
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/memory/user.preference%3Atoo_many_changes', { scopeId: 'u1', status: 'active' });
        expect(p.candidates.value).toEqual([]);

        p.candidates.value = [candidate];
        await p.dismiss(candidate);
        expect(apiRequest).toHaveBeenLastCalledWith('put', '/api/v2/agents/memory/user.preference%3Atoo_many_changes', { scopeId: 'u1', status: 'retired' });
        expect(p.candidates.value).toEqual([]);
    });

    it('surfaces the refusal and keeps the candidate when the write fails', async () => {
        const p = useAgentPreferences({ userId: 'u1' });
        await p.load();
        apiRequest.mockImplementation((type, url) => (type === 'put' ? Promise.reject(httpError(403, 'Not your preference.')) : answer(type, url)));
        await expect(p.accept(candidate)).rejects.toThrow('Not your preference.');
        expect(p.candidates.value).toEqual([candidate]);
        expect(p.busy.value).toBe(false);

        apiRequest.mockImplementation(() => Promise.reject(httpError(500, '')));
        await p.load();
        expect(p.error.value).toBe('t:Settings.agents_load_failed');
    });
});

describe('MySettings AI agents card', () => {
    const store = createStore({
        modules: {
            settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 3 }), roles: () => [], designations: () => [] } },
            users: { namespaced: true, mutations: { mutateUsers: () => {} } }
        }
    });

    const mountPage = async () => {
        apiRequest.mockImplementation(answer);
        apiRequestWithoutCompnay.mockImplementation(() => ok([]));
        const wrapper = mount(MySettings, { global: { plugins: [store] } });
        await flushPromises();
        return wrapper.find('[data-test="agent-prefs"]');
    };

    beforeEach(() => { apiRequest.mockReset(); apiRequestWithoutCompnay.mockReset(); });

    it('renders the segmented controls, the switch and the candidates from the server', async () => {
        const card = await mountPage();
        expect(card.exists()).toBe(true);
        expect(card.find('[data-test="tone"] .is-active').attributes('data-value')).toBe('concise');
        expect(card.find('[data-test="review-depth"] .is-active').attributes('data-value')).toBe('null');
        expect(card.find('[data-test="notify"]').attributes('aria-checked')).toBe('true');
        expect(card.find('[data-test="agent-prefs-save"]').attributes('disabled')).toBeDefined();
        expect(card.findAll('[data-test="candidate"]')).toHaveLength(1);
        expect(card.find('[data-test="candidate"]').text()).toContain('Prefers fewer changes per proposal');
    });

    it('enables save once dirty and puts the three fields', async () => {
        const card = await mountPage();
        await card.find('[data-test="review-depth"] [data-value="every_change"]').trigger('click');
        await card.find('[data-test="notify"]').trigger('click');
        expect(card.find('[data-test="agent-prefs-save"]').attributes('disabled')).toBeUndefined();
        await card.find('[data-test="agent-prefs-save"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/preferences', { tone: 'concise', reviewDepth: 'every_change', notify: false });
        expect(card.find('[data-test="agent-prefs-save"]').attributes('disabled')).toBeDefined();
    });

    it('accepts a candidate as the signed-in user and removes the chip', async () => {
        const card = await mountPage();
        await card.find('[data-test="candidate-accept"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/agents/memory/user.preference%3Atoo_many_changes', { scopeId: 'user-1', status: 'active' });
        expect(card.findAll('[data-test="candidate"]')).toHaveLength(0);
    });
});
