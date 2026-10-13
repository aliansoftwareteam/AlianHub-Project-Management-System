import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, echo, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import AssignmentRulesCard from '@/views/Projects/ProjectDetail/AssignmentRulesCard.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const CANDIDATES = [
    { id: 'u-priya', name: 'Priya' },
    { id: 'u-sam', name: 'Sam' },
    { id: 'u-olive', name: 'Olive' }
];

const RULES = {
    projectId: 'p1',
    entries: [{ userId: 'u-priya', when: 'Frontend bugs' }],
    fallbackUserId: 'u-sam',
    onCreate: true,
    onChange: false,
    mode: 'suggest'
};

const answerWith = ({ rules = RULES, ai = { state: 'on' }, drafts = [] } = {}) => (type, url, body) => {
    if (type === 'get') return ok({ rules, ai });
    if (type === 'put') return ok({ ...rules, ...body });
    if (type === 'post' && String(url).endsWith('/draft')) return ok({ drafts });
    return ok({});
};

const mountCard = async ({ canEdit = true, answer = answerWith() } = {}) => {
    apiRequest.mockImplementation(answer);
    const wrapper = mount(AssignmentRulesCard, {
        props: { projectId: 'p1', candidates: CANDIDATES, canEdit },
        global: { mocks: { $t: echo } }
    });
    await flushPromises();
    return wrapper;
};

const putBody = () => apiRequest.mock.calls.find(([type]) => type === 'put')?.[2];

describe('AssignmentRulesCard', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); toast.error.mockReset(); });

    it('loads the project rules and shows one row per person with the when sentence', async () => {
        const wrapper = await mountCard();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/assignment-rules/project/p1', undefined);
        const rows = wrapper.findAll('[data-test="rule-row"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].text()).toContain('Priya');
        expect(rows[0].find('[data-test="rule-when"]').element.value).toBe('Frontend bugs');
        expect(wrapper.find('[data-test="fallback"]').element.value).toBe('u-sam');
        expect(wrapper.find('[data-test="on-create"]').element.checked).toBe(true);
        expect(wrapper.find('[data-test="on-change"]').element.checked).toBe(false);
        expect(wrapper.find('[data-test="mode-suggest"]').element.checked).toBe(true);
        expect(wrapper.find('[data-test="ai-note"]').exists()).toBe(false);
    });

    it('adds a person, takes a sentence, switches to apply and saves the whole rule set', async () => {
        const wrapper = await mountCard();
        const add = wrapper.find('[data-test="add-person"]');
        expect(add.findAll('option').map((o) => o.element.value)).not.toContain('u-priya');
        await add.setValue('u-olive');
        await wrapper.find('[data-test="add-person-btn"]').trigger('click');
        const rows = wrapper.findAll('[data-test="rule-row"]');
        expect(rows).toHaveLength(2);
        await rows[1].find('[data-test="rule-when"]').setValue('Contracts and invoices');
        await wrapper.find('[data-test="mode-apply"]').setValue(true);
        await wrapper.find('[data-test="on-change"]').setValue(true);
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v2/assignment-rules/project/p1', expect.any(Object));
        expect(putBody()).toEqual({
            entries: [{ userId: 'u-priya', when: 'Frontend bugs' }, { userId: 'u-olive', when: 'Contracts and invoices' }],
            fallbackUserId: 'u-sam',
            onCreate: true,
            onChange: true,
            mode: 'apply'
        });
        expect(toast.success).toHaveBeenCalledWith('AssignmentRules.saved', expect.any(Object));
    });

    it('removes a person and clears the fallback to no assignee', async () => {
        const wrapper = await mountCard();
        await wrapper.find('[data-test="rule-remove"]').trigger('click');
        await wrapper.find('[data-test="fallback"]').setValue('');
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(putBody()).toMatchObject({ entries: [], fallbackUserId: null });
    });

    it('drafts sentences for review and only fills them in when asked, without saving', async () => {
        const wrapper = await mountCard({ answer: answerWith({ drafts: [{ userId: 'u-priya', when: 'UI and layout bugs' }] }) });
        await wrapper.find('[data-test="suggest"]').trigger('click');
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/assignment-rules/project/p1/draft', { userIds: ['u-priya'] });
        const preview = wrapper.find('[data-test="drafts"]');
        expect(preview.exists()).toBe(true);
        expect(preview.findAll('[data-test="draft-row"]')[0].text()).toContain('UI and layout bugs');
        expect(wrapper.find('[data-test="rule-when"]').element.value).toBe('Frontend bugs');

        await wrapper.find('[data-test="use-drafts"]').trigger('click');
        expect(wrapper.find('[data-test="rule-when"]').element.value).toBe('UI and layout bugs');
        expect(wrapper.find('[data-test="drafts"]').exists()).toBe(false);
        expect(apiRequest.mock.calls.some(([type]) => type === 'put')).toBe(false);
    });

    it('discards drafts and keeps the saved sentences', async () => {
        const wrapper = await mountCard({ answer: answerWith({ drafts: [{ userId: 'u-priya', when: 'UI and layout bugs' }] }) });
        await wrapper.find('[data-test="suggest"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="discard-drafts"]').trigger('click');
        expect(wrapper.find('[data-test="drafts"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="rule-when"]').element.value).toBe('Frontend bugs');
    });

    it('is read only without edit permission', async () => {
        const wrapper = await mountCard({ canEdit: false });
        expect(wrapper.find('[data-test="save"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="suggest"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="add-person"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="rule-when"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-test="fallback"]').attributes('disabled')).toBeDefined();
    });

    it('says when AI is off and nothing will be decided', async () => {
        const wrapper = await mountCard({ answer: answerWith({ ai: { state: 'off_workspace' } }) });
        expect(wrapper.find('[data-test="ai-note"]').text()).toBe('AssignmentRules.ai_unavailable');
        expect(wrapper.find('[data-test="suggest"]').attributes('disabled')).toBeDefined();
    });

    it('starts empty with create autofill on and suggest mode when the project has no rules', async () => {
        const wrapper = await mountCard({ answer: answerWith({ rules: null }) });
        expect(wrapper.findAll('[data-test="rule-row"]')).toHaveLength(0);
        expect(wrapper.find('[data-test="on-create"]').element.checked).toBe(true);
        expect(wrapper.find('[data-test="mode-suggest"]').element.checked).toBe(true);
        expect(wrapper.find('[data-test="fallback"]').element.value).toBe('');
    });

    it('shows the server refusal when a save is refused', async () => {
        const refusal = Object.assign(new Error('Request failed'), { response: { status: 400, data: { status: false, statusText: 'Otto cannot open this project.' } } });
        const wrapper = await mountCard({ answer: (type, url, body) => (type === 'put' ? Promise.reject(refusal) : answerWith()(type, url, body)) });
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toBe('Otto cannot open this project.');
    });
});
