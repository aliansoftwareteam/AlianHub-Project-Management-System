import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, toast, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));

import AgentRunDetail from '@/views/Ai/AgentRunDetail.vue';

const failure = {
    type: 'rate_limit', code: 'rate_limit_exceeded', provider: 'openai', model: 'gpt-4.1', status: 429,
    requestId: 'req_rl1', groupKey: 'openai:rate_limit:rate_limit_exceeded', message: 'The AI service is rate-limited.'
};
const failedRun = (over = {}) => ({ _id: 'r1', status: 'failed', startedBy: 'u1', decisions: [], failure, ...over });

const storeFor = () => createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 3 }) } } } });

const mountDetail = async (run) => {
    apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: { run, audit: [] } } }));
    const wrapper = mount(AgentRunDetail, { props: { runId: 'r1' }, global: { plugins: [storeFor()], provide: { $userId: ref('u1'), $companyId: ref('company-1') }, mocks: { $t: echo }, stubs: { RouterLink: RouterLinkStub } } });
    await flushPromises();
    return wrapper;
};

describe('AgentRunDetail failure', () => {
    const writeText = vi.fn();

    beforeEach(() => {
        apiRequest.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
        writeText.mockReset().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    it('shows the error type as a chip with code, provider and request id beneath it', async () => {
        const wrapper = await mountDetail(failedRun());
        const block = wrapper.find('[data-test="failure"]');
        expect(block.exists()).toBe(true);
        const chip = block.find('[data-test="failure-type"]');
        expect(chip.text()).toBe('Ai.failure_type_rate_limit');
        expect(chip.classes()).toContain('ah-chip--danger');
        expect(block.find('[data-test="failure-code"]').text()).toBe('rate_limit_exceeded');
        expect(block.find('[data-test="failure-provider"]').text()).toContain('openai');
        expect(block.find('[data-test="failure-model"]').text()).toBe('gpt-4.1');
        expect(block.find('[data-test="failure-request-id"]').text()).toBe('req_rl1');
    });

    it('copies the request id', async () => {
        const wrapper = await mountDetail(failedRun());
        const copy = wrapper.find('[data-test="copy-request-id"]');
        expect(copy.attributes('aria-label')).toBe('Ai.failure_copy_request_id');
        await copy.trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('req_rl1');
        expect(toast.success).toHaveBeenCalledWith('Ai.failure_request_id_copied', { position: 'top-right' });
    });

    it('reports a clipboard refusal instead of failing silently', async () => {
        writeText.mockRejectedValue(new Error('denied'));
        const wrapper = await mountDetail(failedRun());
        await wrapper.find('[data-test="copy-request-id"]').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('denied', { position: 'top-right' });
    });

    it('labels a type outside the known set as unknown and hides what the failure lacks', async () => {
        const wrapper = await mountDetail(failedRun({ failure: { type: 'brand_new', code: 'weird', provider: 'deepseek', requestId: null } }));
        expect(wrapper.find('[data-test="failure-type"]').text()).toBe('Ai.failure_type_unknown');
        expect(wrapper.find('[data-test="failure-request-id"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="copy-request-id"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="failure-model"]').exists()).toBe(false);
    });

    it('renders nothing for a run without a provider failure', async () => {
        const wrapper = await mountDetail(failedRun({ failure: undefined }));
        expect(wrapper.find('[data-test="failure"]').exists()).toBe(false);
        const done = await mountDetail({ _id: 'r1', status: 'done', decisions: [] });
        expect(done.find('[data-test="failure"]').exists()).toBe(false);
    });
});
