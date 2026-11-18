import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, apiRequestWithoutCompnay, route, router, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    route: { params: { id: 'a1' }, query: {} },
    router: { replace: vi.fn(), push: vi.fn() },
    toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import AgentSettings from '@/views/Ai/AgentSettings.vue';
import SkillEditor from '@/views/Ai/SkillEditor.vue';
import { notOffered, tickCount, ticksOf, withProvider, withTool } from '@/views/Ai/agentConnectorTicks';
import { formatValue } from '@/views/Ai/revisionDiff';
import en from '@/locales/en';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const OWNER = 1;
const MEMBER = 3;
const READ = 'fake.notes.list';
const WRITE = 'fake.notes.create';
const FAKE = { provider: 'fake', name: 'Fake', tools: [{ key: READ, kind: 'read', label: 'Connectors.tool.fakeNotesList', description: 'The latest notes.' }, { key: WRITE, kind: 'write', label: 'Connectors.tool.fakeNotesCreate', description: 'Adds a note.' }] };
const agent = { _id: 'a1', name: 'Notes', autonomy: 1, spendCapUsd: 30, projectIds: [], skills: [] };

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const serve = ({ providers = [FAKE], listed = [agent] } = {}) => apiRequest.mockImplementation((type, url) => {
    if (type !== 'get') return ok({});
    if (url === '/api/v2/agents') return ok(listed);
    if (url === '/api/v2/agents/connectors') return ok({ providers });
    if (url === '/api/v2/agents/registry') return ok({ actions: [], never: [], autonomy: [{ level: 0 }, { level: 1 }] });
    return ok([]);
});
const puts = () => apiRequest.mock.calls.filter(([type]) => type === 'put');

const mounted = [];
const mountSettings = async ({ roleType = OWNER } = {}) => {
    route.query = { tab: 'connectors' };
    const wrapper = mount(AgentSettings, {
        global: {
            plugins: [createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), rules: () => ({}) } }, projectData: { namespaced: true, getters: { projects: () => ({ data: [] }) } } } })],
            provide: { $userId: ref('u1'), $companyId: ref('company-1') },
            stubs: { RouterLink: RouterLinkStub, ShellIcon: true, AgentRevisionHistory: true, AgentSchedules: true, AiSidebar: true }
        }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { allowed: false } } });
    Object.values(toast).forEach((fn) => fn.mockReset());
    serve();
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

describe('the ticks an agent keeps', () => {
    it('are kept in one order, without repeats or empty apps', () => {
        expect(ticksOf([{ provider: 'slack', tools: ['b', 'a', 'a'] }, { provider: 'fake', tools: [] }, { provider: 'drive', tools: ['x'] }, null])).toEqual([
            { provider: 'drive', tools: ['x'] }, { provider: 'slack', tools: ['a', 'b'] }
        ]);
    });

    it('tick an app\'s reads when the app is ticked, never its writes, and clear all of it when unticked', () => {
        const on = withProvider([], FAKE, true);
        expect(on).toEqual([{ provider: 'fake', tools: [READ] }]);
        expect(withProvider(withTool(on, 'fake', WRITE, true), FAKE, false)).toEqual([]);
    });

    it('tick an app with only writes by its writes', () => {
        expect(withProvider([], { provider: 'poster', tools: [{ key: 'poster.post.create', kind: 'write' }] }, true)).toEqual([{ provider: 'poster', tools: ['poster.post.create'] }]);
    });

    it('add and take away one tool, and count what is ticked', () => {
        const both = withTool(withTool([], 'fake', WRITE, true), 'fake', READ, true);
        expect(both).toEqual([{ provider: 'fake', tools: [WRITE, READ] }]);
        expect(tickCount(both)).toBe(2);
        expect(withTool(both, 'fake', WRITE, false)).toEqual([{ provider: 'fake', tools: [READ] }]);
    });

    it('keep ticks on an app that is not offered now apart', () => {
        expect(notOffered([{ provider: 'fake', tools: [READ] }, { provider: 'slack', tools: ['slack.channel.read'] }], [FAKE])).toEqual([{ provider: 'slack', tools: ['slack.channel.read'] }]);
    });

    it('read as words in a revision', () => {
        expect(formatValue('connectors', [{ provider: 'fake', tools: [READ, WRITE] }])).toBe(`fake: ${READ}, ${WRITE}`);
        expect(formatValue('connectors', [], (key) => key)).toBe('Ai.revision_value_empty');
    });
});

describe('the Connectors tab of agent settings', () => {
    it('is not there while no app is offered and nothing is ticked', async () => {
        serve({ providers: [] });
        const wrapper = await mountSettings();
        expect(wrapper.findAll('[role="tab"]').map((tab) => tab.attributes('data-tab'))).not.toContain('connectors');
    });

    it('lists the offered apps with every tool, nothing ticked, and a write labelled as approved first', async () => {
        const wrapper = await mountSettings();
        expect(wrapper.find('[data-tab="connectors"]').attributes('aria-selected')).toBe('true');
        expect(wrapper.find(`[data-test="connector-tick-fake"]`).element.checked).toBe(false);
        expect(wrapper.find(`[data-test="connector-tool-${READ}"]`).element.checked).toBe(false);
        expect(wrapper.find(`[data-test="connector-write-${WRITE}"]`).text()).toBe('AgentConnectors.write_needs_approval');
        expect(wrapper.find(`[data-test="connector-write-${READ}"]`).exists()).toBe(false);
    });

    it('points at the tools the agent\'s skills read or propose', async () => {
        const reading = { ...agent, skills: [{ key: 'notes', name: 'Notes', enabled: true }] };
        apiRequest.mockImplementation((type, url) => {
            if (type === 'get' && url === '/api/v2/agents/skills') return ok([{ key: 'notes', name: 'Notes', reads: [READ, 'task'], emits: [] }]);
            if (type === 'get' && url === '/api/v2/agents') return ok([reading]);
            if (type === 'get' && url === '/api/v2/agents/connectors') return ok({ providers: [FAKE] });
            if (type === 'get' && url === '/api/v2/agents/registry') return ok({ actions: [], never: [], autonomy: [{ level: 0 }] });
            return type === 'get' ? ok([]) : ok({});
        });
        const wrapper = await mountSettings();
        expect(wrapper.find(`[data-test="connector-used-${READ}"]`).exists()).toBe(true);
        expect(wrapper.find(`[data-test="connector-used-${WRITE}"]`).exists()).toBe(false);
    });

    it('saves only the ticks the person changed', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('[data-test="connector-tick-fake"]').setValue(true);
        await wrapper.find(`[data-test="connector-tool-${WRITE}"]`).setValue(true);
        expect(wrapper.find('[data-test="dirty-connectors"]').exists()).toBe(true);
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        expect(puts()).toHaveLength(1);
        expect(puts()[0][2]).toEqual({ _id: 'a1', connectors: [{ provider: 'fake', tools: [WRITE, READ] }] });
    });

    it('shows a saved tick, and sends nothing when it is unticked and ticked again', async () => {
        serve({ listed: [{ ...agent, connectors: [{ provider: 'fake', tools: [READ] }] }] });
        const wrapper = await mountSettings();
        expect(wrapper.find(`[data-test="connector-tool-${READ}"]`).element.checked).toBe(true);
        expect(wrapper.find('[data-tab="connectors"]').text()).toContain('1');
        await wrapper.find(`[data-test="connector-tool-${READ}"]`).setValue(false);
        await wrapper.find(`[data-test="connector-tool-${READ}"]`).setValue(true);
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(puts()).toHaveLength(0);
    });

    it('keeps ticks on an app that is switched off, until someone clears them', async () => {
        serve({ providers: [], listed: [{ ...agent, connectors: [{ provider: 'slack', tools: ['slack.channel.read'] }] }] });
        const wrapper = await mountSettings();
        expect(wrapper.find('[data-test="connectors-none"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="connectors-not-offered"]').text()).toContain('slack');
        await wrapper.find('[data-test="connector-clear-slack"]').trigger('click');
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(puts()[0][2]).toEqual({ _id: 'a1', connectors: [] });
    });

    it('is read-only for a member who may not edit the agent', async () => {
        const wrapper = await mountSettings({ roleType: MEMBER });
        expect(wrapper.find('[data-test="connector-tick-fake"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find(`[data-test="connector-tool-${WRITE}"]`).attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-test="savebar"]').exists()).toBe(false);
    });
});

describe('a connected app in the skill editor', () => {
    const catalogues = {
        inputs: [],
        readers: [
            { key: 'task', params: {}, fields: ['title'] },
            { key: 'url', external: true, params: { host: { type: 'host', required: true } }, fields: ['text'] },
            { key: READ, connector: 'fake', connectorName: 'Fake', params: { limit: { type: 'integer', min: 1, max: 20, default: 5 }, connectionId: { type: 'string', maxLength: 64 } }, fields: ['text', 'chars', 'truncated', 'failed', 'reason'] }
        ],
        actions: [{ key: 'task.comment', risk: 'low', required: ['body'] }],
        partials: [], risks: ['low', 'medium', 'high'], taskFields: ['TaskName']
    };
    const skill = { key: 'team.notes', name: 'Notes', inputs: [], gather: [{ reader: READ, as: 'notes', params: { limit: 3 } }], prompt: { partials: [], instructions: 'x', template: '{{gather.notes.text}}', output: '{}' }, emit: [{ action: 'task.comment', params: { body: 'x' } }] };
    const openEditor = async () => {
        const wrapper = mount(SkillEditor, { props: { skill, catalogues }, attachTo: document.body, global: { stubs: { ShellIcon: true, Teleport: true } } });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    };

    it('is offered in its own group beside the reads from the web', async () => {
        const wrapper = await openEditor();
        const groups = wrapper.find('[data-test="gather-reader"]').findAll('optgroup').map((group) => group.attributes('label'));
        expect(groups).toEqual([en.Ai.skill_readers_workspace, en.Ai.skill_readers_outside, en.Ai.skill_readers_app.replace('{app}', 'Fake')]);
    });

    it('shows the read\'s own settings without the connection, and saves it as optional when asked', async () => {
        const wrapper = await openEditor();
        const step = wrapper.find('[data-test="connector-read"]');
        expect(step.exists()).toBe(true);
        expect(step.find('[data-test="connector-param-limit"]').element.value).toBe('3');
        expect(step.find('[data-test="connector-param-connectionId"]').exists()).toBe(false);
        await step.find('[data-test="connector-read-optional"]').setValue(true);
        await wrapper.findAll('.aw__foot .ah-btn--primary')[0].trigger('click');
        await flushPromises();
        const saved = apiRequest.mock.calls.find(([type]) => type === 'put' || type === 'post');
        expect(saved[2].gather[0]).toEqual({ reader: READ, as: 'notes', params: { limit: 3 }, optional: true });
    });
});
