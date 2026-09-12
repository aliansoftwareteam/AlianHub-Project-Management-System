import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/useAgents', () => ({
    useAgents: () => ({ waiting: { value: 0 }, running: { value: 0 }, spend: { value: { totalUsd: 0, agents: [] } }, pauseAll: vi.fn() }),
}));

import WorkflowBuilderPage from '@/views/Workflows/WorkflowBuilderPage.vue';
import AiSidebar from '@/views/Ai/AiSidebar.vue';
import { ownerOrAdminOnly } from '@/router/workflows';

const MANIFEST = {
    stepTypes: [
        {
            key: 'agent_run',
            label: 'Run an agent',
            config: { agentId: { type: 'agent', label: 'Agent', required: true }, budgetUsd: { type: 'number', label: 'Budget (USD)' } },
            output: {},
        },
        {
            key: 'human_approval',
            label: 'Ask a person',
            config: { prompt: { type: 'text', label: 'What is being asked' }, onReject: { type: 'select', label: 'If refused', options: ['skip', 'continue'] } },
            output: {},
        },
    ],
    bounds: { maxFanOut: 50, maxLoopIterations: 25 },
};

const SAVED = { _id: 'w1', name: 'Ship it', enabled: false, steps: [{ id: 's1', type: 'agent_run', config: {} }] };

const answer = (method, url) => {
    if (url.includes('/workflows/step-types')) return { data: { status: true, data: MANIFEST } };
    if (url.includes('/workflows/definitions')) return { data: { status: true, data: [SAVED] } };
    if (url.includes('/automations/registry')) return { data: { status: true, data: { actions: [] } } };
    return { data: { status: true, data: [] } };
};

const storeFor = (roleType) => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } },
        users: { namespaced: true, getters: { users: () => [] } },
    },
});

const open = async (roleType = 1) => {
    const wrapper = mount(WorkflowBuilderPage, { global: { plugins: [storeFor(roleType)] } });
    await flushPromises();
    return wrapper;
};

const build = async (roleType = 1) => {
    const wrapper = await open(roleType);
    await wrapper.findAll('button').find((button) => button.text().includes('WorkflowBuilder.new')).trigger('click');
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(async (method, url) => answer(method, url));
});

describe('the builder composes from the manifest the API serves', () => {
    it('offers exactly the step types the server registered, by their own labels', async () => {
        const wrapper = await build();
        const options = wrapper.find('[data-test="step-type"]').findAll('option');
        expect(options.map((option) => option.text())).toEqual(['Run an agent', 'Ask a person']);
        expect(options.map((option) => option.attributes('value'))).toEqual(['agent_run', 'human_approval']);
    });

    it('draws each step\'s slots from that step type\'s own contract', async () => {
        const wrapper = await build();
        expect(wrapper.text()).toContain('Agent');
        expect(wrapper.text()).toContain('Budget (USD)');

        await wrapper.find('[data-test="step-type"]').setValue('human_approval');
        await flushPromises();
        expect(wrapper.text()).toContain('What is being asked');
        expect(wrapper.text()).toContain('If refused');
        expect(wrapper.text()).not.toContain('Agent');
    });

    it('hardcodes no step type of its own', async () => {
        apiRequest.mockImplementation(async (method, url) => (url.includes('/workflows/step-types')
            ? { data: { status: true, data: { stepTypes: [{ key: 'invented', label: 'Invented later', config: {} }], bounds: {} } } }
            : answer(method, url)));
        const wrapper = await build();
        expect(wrapper.find('[data-test="step-type"]').findAll('option').map((option) => option.text())).toEqual(['Invented later']);
    });
});

describe('saving', () => {
    it('saves without asking for the workflow to be turned on, and says so', async () => {
        const wrapper = await build();
        expect(wrapper.text()).toContain('WorkflowBuilder.saved_off_note');
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        const post = apiRequest.mock.calls.find(([method, url]) => method === 'post' && url.includes('/workflows/definitions'));
        expect(post).toBeTruthy();
        expect(post[2]).not.toHaveProperty('enabled');
    });

    it('turning one on is its own act on the list', async () => {
        const wrapper = await open();
        await wrapper.find('.wb__toggle').trigger('click');
        await flushPromises();
        const patch = apiRequest.mock.calls.find(([method]) => method === 'patch');
        expect(patch[1]).toContain('/workflows/definitions/w1/enabled');
        expect(patch[2]).toEqual({ enabled: true });
    });

    it('shows the field the server named when a definition is refused', async () => {
        apiRequest.mockImplementation(async (method, url) => {
            if (method === 'post' && url.includes('/workflows/definitions')) {
                throw { response: { status: 400, data: { status: false, errors: ['steps[0].config.agentId: required by "agent_run"'] } } };
            }
            return answer(method, url);
        });
        const wrapper = await build();
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="errors"]').text()).toContain('steps[0].config.agentId');
    });
});

describe('the dry run', () => {
    it('asks the server to plan and shows what each step would do', async () => {
        apiRequest.mockImplementation(async (method, url) => {
            if (url.includes('/workflows/dry-run')) {
                return {
                    data: {
                        status: true,
                        data: {
                            valid: true,
                            errors: [],
                            input: { kind: 'task', found: true, name: 'Fix the importer' },
                            waves: [['s1']],
                            steps: [{ stepId: 's1', type: 'agent_run', label: 'Run an agent', wave: 1, effect: 'writes', refused: null, reads: [] }],
                            summary: { stepCount: 1, waveCount: 1, writeCount: 1, approvalCount: 0 },
                        },
                    },
                };
            }
            return answer(method, url);
        });
        const wrapper = await build();
        await wrapper.find('[data-test="dry-run"]').trigger('click');
        await flushPromises();

        expect(apiRequest.mock.calls.some(([method, url]) => method === 'post' && url.includes('/workflows/dry-run'))).toBe(true);
        const plan = wrapper.find('[data-test="plan"]');
        expect(plan.exists()).toBe(true);
        expect(plan.text()).toContain('Run an agent');
        expect(plan.text()).toContain('WorkflowBuilder.effect_writes');
        // Planning must not have saved or started anything.
        expect(apiRequest.mock.calls.some(([method, url]) => method === 'post' && url.includes('/workflows/definitions'))).toBe(false);
        expect(apiRequest.mock.calls.some(([, url]) => url.includes('/workflows/runs'))).toBe(false);
    });
});

describe('the engine being off', () => {
    it('shows the reason the API gave rather than a broken page', async () => {
        apiRequest.mockImplementation(async () => {
            throw { response: { status: 503, data: { status: false, statusText: 'The workflow engine is off. Set WORKFLOW_ENGINE=on to use workflows.' } } };
        });
        const wrapper = await open();
        expect(wrapper.find('[data-test="engine-off"]').text()).toContain('WORKFLOW_ENGINE=on');
        expect(wrapper.find('[data-test="save"]').exists()).toBe(false);
    });
});

describe('a member gets neither the entry nor the page', () => {
    it.each([[3, 'member'], [0, 'guest']])('sends a roleType %i (%s) home instead of into the builder', async (roleType) => {
        const store = storeFor(roleType);
        await expect(ownerOrAdminOnly({ params: { cid: 'c1' } }, store)).resolves.toEqual({ name: 'Home', params: { cid: 'c1' } });
    });

    it.each([[1, 'owner'], [2, 'admin']])('lets a roleType %i (%s) in', async (roleType) => {
        await expect(ownerOrAdminOnly({ params: { cid: 'c1' } }, storeFor(roleType))).resolves.toBe(true);
    });

    it('keeps the workflow entry out of the AI sidebar for a member', async () => {
        const items = async (roleType) => {
            const wrapper = mount(AiSidebar, {
                global: {
                    plugins: [storeFor(roleType)],
                    provide: { $companyId: 'c1', $userId: 'u1' },
                    stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } },
                },
            });
            await flushPromises();
            return wrapper.findAll('.ai-side__item').map((link) => link.text());
        };
        expect((await items(1)).join(' ')).toContain('WorkflowBuilder.nav');
        expect((await items(3)).join(' ')).not.toContain('WorkflowBuilder.nav');
    });

    it('asks the API for nothing at all when a member reaches the page anyway', async () => {
        const wrapper = await open(3);
        expect(apiRequest).not.toHaveBeenCalled();
        expect(wrapper.find('.wb__readonly').text()).toBe('WorkflowBuilder.manage_owner_admin');
        expect(wrapper.findAll('button').map((button) => button.text())).not.toContain('WorkflowBuilder.new');
    });
});
