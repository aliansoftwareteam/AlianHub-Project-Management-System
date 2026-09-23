import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import SkillEditor from '@/views/Ai/SkillEditor.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

/* The shape GET /api/v2/agents/models?configured=true returns (catalogue.allowlist rows). */
const MODELS = [
    { model: 'gpt-4.1', provider: 'openai', priced: true, tier: 'high', configured: true, inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
    { model: 'gpt-4.1-mini', provider: 'openai', priced: true, tier: 'low', configured: true, inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 },
];

const skill = (extra = {}) => ({
    key: 'task.summary',
    name: 'Task summary',
    inputs: [],
    gather: [{ reader: 'task', as: 'task', params: {} }],
    prompt: { partials: [], instructions: 'Summarise.', template: '{{gather.task.brief}}', output: '{}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
    ...extra,
});

const catalogues = {
    inputs: [],
    readers: [{ key: 'task', params: {}, fields: ['key', 'title', 'brief'] }],
    actions: [{ key: 'task.comment', risk: 'low', required: ['body'] }],
    partials: [],
    risks: ['low', 'medium', 'high'],
    taskFields: ['TaskKey', 'TaskName'],
};

let saved;
let mounted = null;

const open = async (props = {}) => {
    mounted = mount(SkillEditor, {
        props: { skill: skill(), catalogues, ...props },
        global: { mocks: { $t: t } },
    });
    await flushPromises();
    return new DOMWrapper(document.body);
};

beforeEach(() => {
    saved = [];
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get' && url.startsWith('/api/v2/agents/models')) return Promise.resolve({ data: { status: true, data: { models: MODELS } } });
        if ((method === 'post' || method === 'put') && url.startsWith('/api/v2/agents/skills')) {
            saved.push(body);
            return Promise.resolve({ data: { status: true, data: body } });
        }
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
    apiRequestWithoutCompnay.mockRejectedValue(new Error('not expected'));
});

afterEach(() => {
    if (mounted) mounted.unmount();
    mounted = null;
});

describe('Skill editor: model pin options', () => {
    it('labels each option with the model name and binds the model string', async () => {
        const wrapper = await open();
        const options = wrapper.findAll('#sk-model option').slice(1);
        expect(options).toHaveLength(MODELS.length);
        options.forEach((option, i) => {
            expect(option.element.value).toBe(MODELS[i].model);
            expect(option.text()).toContain(MODELS[i].model);
            expect(option.text()).not.toContain('{');
            expect(option.element.value).not.toBe('[object Object]');
        });
    });

    it('keeps the inherit option first with an empty value', async () => {
        const wrapper = await open();
        const first = wrapper.find('#sk-model option');
        expect(first.element.value).toBe('');
        expect(first.text()).toBe(t('Ai.skill_model_inherit'));
    });

    it('sends the picked model name on save, never [object Object]', async () => {
        const wrapper = await open();
        await wrapper.find('#sk-model').setValue('gpt-4.1-mini');
        await wrapper.findAll('button.ah-btn--primary').at(-1).trigger('click');
        await flushPromises();
        expect(saved).toHaveLength(1);
        expect(saved[0].model).toBe('gpt-4.1-mini');
    });

    it('shows an existing pin as selected', async () => {
        const wrapper = await open({ skill: skill({ model: 'gpt-4.1' }) });
        expect(wrapper.find('#sk-model').element.value).toBe('gpt-4.1');
    });
});
