import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fs from 'fs';
import path from 'path';

const { apiRequest, apiRequestWithoutCompnay, push, replace, route, me } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    push: vi.fn(() => Promise.resolve()),
    replace: vi.fn(() => Promise.resolve()),
    route: { name: 'AiConnect', meta: {}, params: { cid: 'c1' }, query: {}, fullPath: '/' },
    me: { value: {} }
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace, hasRoute: () => true }), useRoute: () => route }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => me.value }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import ConnectYourAi from '@/views/Ai/ConnectYourAi.vue';
import ConnectAiHint from '@/components/molecules/AiUnavailable/ConnectAiHint.vue';
import AiModelNotice from '@/components/molecules/AiUnavailable/AiModelNotice.vue';
import AutomationAiDraft from '@/views/Automations/AutomationAiDraft.vue';
import aiRoutes from '@/router/ai';
import { CONNECT_AI_ROUTE, CONNECT_AI_WELCOME_ROUTE, connectAiWelcomePath } from '@/router/ai/connect';
import { aiConnection, connectStateFor, loadAiConnection, resetAiConnection, CONNECT_STATE } from '@/composable/aiConnection';
import { applyAiAvailability, canUseAi, aiUsable, resetAiAvailability } from '@/composable/aiAvailability';
import { useOnboardingChecklist, ADMIN_STEPS, MEMBER_STEPS, WORKSPACE_STEPS } from '@/composable/useOnboardingChecklist';
import { resetOnboardingRecord } from '@/composable/onboardingState';
import { AI_CONNECTION, USER_ONBOARDING } from '@/config/env';

const SRC = path.resolve(__dirname, '../../src');
const source = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');

const LinkStub = defineComponent({
    name: 'RouterLink',
    props: { to: { type: [Object, String], default: '' } },
    setup: (props, { slots }) => () => h('a', { 'data-to': typeof props.to === 'string' ? props.to : props.to.name, 'data-query': JSON.stringify(props.to.query || {}) }, slots.default && slots.default())
});

const STATUS = { connected: false, lastSeenAt: null, via: null, apps: true, tokens: true, address: 'https://hub.example.com/mcp', tools: { data: true, manage: true, work: true } };
const answer = (data) => Promise.resolve({ data: { status: true, data } });

const openPage = async (status = {}, { welcome = false } = {}) => {
    route.name = welcome ? CONNECT_AI_WELCOME_ROUTE : CONNECT_AI_ROUTE;
    route.meta = welcome ? { welcome: true, hideHeader: true } : {};
    apiRequest.mockImplementation(() => answer({ ...STATUS, ...status }));
    const wrapper = mount(ConnectYourAi, { global: { components: { RouterLink: LinkStub } } });
    await flushPromises();
    return wrapper;
};

const find = (wrapper, name) => wrapper.find(`[data-test="${name}"]`);

beforeEach(() => {
    vi.useRealTimers();
    resetAiConnection();
    resetAiAvailability();
    resetOnboardingRecord();
    me.value = { _id: 'user-1', homeChecklist: {} };
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: {} } });
    push.mockClear();
    replace.mockClear();
});

describe('the state of the step', () => {
    it('is connected, skipped, not connected or not available, in that order of weight', () => {
        expect(connectStateFor({ connected: true, apps: true, tokens: true }, true)).toBe(CONNECT_STATE.CONNECTED);
        expect(connectStateFor({ connected: false, apps: true, tokens: true }, true)).toBe(CONNECT_STATE.SKIPPED);
        expect(connectStateFor({ connected: false, apps: false, tokens: true }, false)).toBe(CONNECT_STATE.NOT_CONNECTED);
        expect(connectStateFor({ connected: false, apps: false, tokens: false }, false)).toBe(CONNECT_STATE.NOT_AVAILABLE);
    });

    it('reads the person\'s own connection from the server and keeps the last answer when a read fails', async () => {
        apiRequest.mockImplementationOnce(() => answer({ ...STATUS, connected: true, via: 'token' }));
        await loadAiConnection('c1');
        expect(apiRequest).toHaveBeenCalledWith('get', AI_CONNECTION);
        expect(aiConnection).toMatchObject({ loaded: true, connected: true, via: 'token', companyId: 'c1' });

        apiRequest.mockImplementationOnce(() => Promise.reject(new Error('offline')));
        await loadAiConnection('c1');
        expect(aiConnection.connected).toBe(true);
    });
});

describe('the Connect your AI page', () => {
    it('gives the address for Claude and ChatGPT and the token path, with nothing secret on it', async () => {
        const wrapper = await openPage();
        expect(find(wrapper, 'connect-ai-sign').text()).toContain('ConnectAi.sign_waiting');
        expect(find(wrapper, 'connect-ai-way-claude').text()).toContain('https://hub.example.com/mcp');
        expect(find(wrapper, 'connect-ai-way-chatgpt').text()).toContain('https://hub.example.com/mcp');
        expect(find(wrapper, 'connect-ai-way-claude').text()).toContain('ConnectAi.claude_allow');
        const tokenLink = find(wrapper, 'connect-ai-token-link');
        expect(tokenLink.attributes('data-to')).toBe('AiAccounts');
        expect(tokenLink.attributes('data-query')).toBe('{"tab":"link"}');
        expect(wrapper.html()).not.toMatch(/Bearer|ahp_/);
        expect(find(wrapper, 'connect-ai-first').exists()).toBe(false);
        expect(find(wrapper, 'connect-ai-limit').text()).toContain('ConnectAi.limit');
    });

    it('marks the waiting line with a waiting icon, not an empty gap, and the connected one with the green dot', async () => {
        const waiting = find(await openPage(), 'connect-ai-sign');
        expect(waiting.findComponent({ name: 'ShellIcon' }).vm.$attrs.name).toBe('clock');
        expect(waiting.find('.ah-dot').exists()).toBe(false);

        const connected = find(await openPage({ connected: true, lastSeenAt: '2026-10-01T09:00:00.000Z', via: 'app' }), 'connect-ai-sign');
        expect(connected.find('.ah-dot--ok').exists()).toBe(true);
        expect(connected.findComponent({ name: 'ShellIcon' }).exists()).toBe(false);
    });

    it('says connected and offers the first sentence once the person\'s AI has called', async () => {
        const wrapper = await openPage({ connected: true, lastSeenAt: '2026-10-01T09:00:00.000Z', via: 'app' });
        const sign = find(wrapper, 'connect-ai-sign');
        expect(sign.classes()).toContain('is-connected');
        expect(sign.text()).toContain('ConnectAi.sign_connected');
        expect(find(wrapper, 'connect-ai-first').text()).toContain('ConnectAi.first_sentence');
    });

    it('turns to connected by itself when the first call arrives', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const wrapper = await openPage();
        expect(find(wrapper, 'connect-ai-sign').classes()).not.toContain('is-connected');

        apiRequest.mockImplementation(() => answer({ ...STATUS, connected: true, lastSeenAt: '2026-10-01T09:00:00.000Z', via: 'app' }));
        await vi.advanceTimersByTimeAsync(5000);
        await flushPromises();
        expect(find(wrapper, 'connect-ai-sign').classes()).toContain('is-connected');

        const calls = apiRequest.mock.calls.length;
        await vi.advanceTimersByTimeAsync(20000);
        expect(apiRequest.mock.calls.length).toBe(calls);
        wrapper.unmount();
    });

    it('stops asking once the page is closed', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const wrapper = await openPage();
        const calls = apiRequest.mock.calls.length;
        wrapper.unmount();
        await vi.advanceTimersByTimeAsync(20000);
        expect(apiRequest.mock.calls.length).toBe(calls);
    });

    it('with connecting an app switched off, says what an admin switches on and offers the token instead of a dead button', async () => {
        const wrapper = await openPage({ apps: false, address: '' });
        for (const way of ['connect-ai-way-claude', 'connect-ai-way-chatgpt']) {
            expect(find(wrapper, way).text()).toContain('ConnectAi.apps_off');
            expect(find(wrapper, way).text()).toContain('MCP_OAUTH');
            expect(find(wrapper, way).find('button').exists()).toBe(false);
        }
        expect(find(wrapper, 'connect-ai-token-link').exists()).toBe(true);
    });

    it('with tokens refused, sends nobody to the token page', async () => {
        const wrapper = await openPage({ tokens: false });
        expect(find(wrapper, 'connect-ai-token-link').exists()).toBe(false);
        expect(find(wrapper, 'connect-ai-way-token').text()).toContain('ConnectAi.tokens_off');
    });

    it.each([
        ['data', 'MCP_TOOLS_DATA'],
        ['manage', 'MCP_TOOLS_MANAGE'],
        ['work', 'MCP_TOOLS_WORK']
    ])('names the %s tools as switched off when their setting is off', async (key, setting) => {
        const wrapper = await openPage({ tools: { ...STATUS.tools, [key]: false } });
        const off = wrapper.findAll('[data-test="connect-ai-tool-off"]');
        expect(off).toHaveLength(1);
        expect(off[0].text()).toContain(`ConnectAi.tools_${key}`);
        expect(off[0].text()).toContain(setting);
        expect(find(wrapper, 'connect-ai-tools-admin').exists()).toBe(true);
    });

    it('says nothing about switched-off tools when every tool is on', async () => {
        const wrapper = await openPage();
        expect(wrapper.findAll('[data-test="connect-ai-tool-off"]')).toHaveLength(0);
        expect(find(wrapper, 'connect-ai-tools-admin').exists()).toBe(false);
    });

    it('marks the server key as an optional extra, and only for the person who can add one', async () => {
        applyAiAvailability({ state: 'unconfigured', loaded: true, canConfigureInstance: true });
        const owner = await openPage();
        expect(find(owner, 'connect-ai-server-key').text()).toContain('ConnectAi.server_key_optional');
        expect(find(owner, 'connect-ai-server-key').find('a').attributes('data-to')).toBe('InstanceSettings');

        applyAiAvailability({ state: 'unconfigured', loaded: true, canConfigureInstance: false });
        expect(find(await openPage(), 'connect-ai-server-key').exists()).toBe(false);
    });
});

describe('the step at the end of sign-up', () => {
    it('has a page of its own with no rail, and the same page inside the AI section', () => {
        const welcome = aiRoutes.find((entry) => entry.name === CONNECT_AI_WELCOME_ROUTE);
        const page = aiRoutes.find((entry) => entry.name === CONNECT_AI_ROUTE);
        expect(welcome.meta).toMatchObject({ requiresAuth: true, hideHeader: true, welcome: true });
        expect(welcome.path).toBe('/:cid/welcome/connect-ai');
        expect(connectAiWelcomePath('c1')).toBe('/c1/welcome/connect-ai');
        expect(page.meta).toMatchObject({ requiresAuth: true });
        expect(page.meta.hideHeader).toBeUndefined();
    });

    it.each([
        'views/Company/CreateCompany.vue',
        'views/Authentication/Invitation/Invitation.vue',
        'views/Setup/SetupWizard.vue'
    ])('%s ends on it', (file) => {
        expect(source(file)).toContain('connectAiWelcomePath(');
    });

    it('skips in one click: the choice is saved on the person and Home opens', async () => {
        const wrapper = await openPage({}, { welcome: true });
        await find(wrapper, 'connect-ai-skip').trigger('click');
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', USER_ONBOARDING, { connectAiSkipped: true });
        expect(replace).toHaveBeenCalledWith({ name: 'Home', params: { cid: 'company-1' } });
    });

    it('offers the team set-up only while the dispatcher is on', async () => {
        const off = await openPage({}, { welcome: true });
        expect(find(off, 'connect-ai-blueprint').exists()).toBe(false);
        off.unmount();
        route.name = CONNECT_AI_WELCOME_ROUTE;
        route.meta = { welcome: true, hideHeader: true };
        apiRequest.mockImplementation((type, url) => answer(String(url).endsWith('/team-packs') ? { on: true, packs: [], companyBlueprints: [] } : STATUS));
        const on = mount(ConnectYourAi, { global: { components: { RouterLink: LinkStub } } });
        await flushPromises();
        expect(find(on, 'connect-ai-blueprint').exists()).toBe(true);
    });

    it('offers Skip for now whatever this install has switched on', async () => {
        const wrapper = await openPage({ apps: false, tokens: false, address: '' }, { welcome: true });
        expect(find(wrapper, 'connect-ai-skip').exists()).toBe(true);
    });

    it('goes on to Home without recording a skip once connected', async () => {
        const wrapper = await openPage({ connected: true, lastSeenAt: '2026-10-01T09:00:00.000Z', via: 'token' }, { welcome: true });
        expect(find(wrapper, 'connect-ai-skip').exists()).toBe(false);
        await find(wrapper, 'connect-ai-continue').trigger('click');
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
        expect(replace).toHaveBeenCalledWith({ name: 'Home', params: { cid: 'company-1' } });
    });

    it('has no skip or continue on the page opened later', async () => {
        const wrapper = await openPage();
        expect(find(wrapper, 'connect-ai-skip').exists()).toBe(false);
        expect(find(wrapper, 'connect-ai-continue').exists()).toBe(false);
    });
});

describe('the step on the setup card', () => {
    const ROLE = { owner: 1, member: 3 };
    const store = (roleType) => createStore({
        modules: {
            projectData: { namespaced: true, getters: { projects: () => ({ data: [] }) } },
            settings: { namespaced: true, getters: { companyUsers: () => [{ userId: 'user-1' }], companyUserDetail: () => ({ roleType }) } }
        }
    });
    const checklist = async (roleType, status = {}) => {
        apiRequest.mockImplementation(() => answer({ ...STATUS, ...status }));
        let api;
        const Host = defineComponent({ setup() { api = useOnboardingChecklist(); return () => h('div'); } });
        mount(Host, { global: { plugins: [store(roleType)] } });
        await flushPromises();
        return api;
    };
    const stepOf = (api) => api.steps.value.find((step) => step.key === 'connect_ai');

    it('comes first for an owner and for a member, and is the person\'s own step', () => {
        expect(ADMIN_STEPS[0]).toBe('connect_ai');
        expect(MEMBER_STEPS[0]).toBe('connect_ai');
        expect(WORKSPACE_STEPS).not.toContain('connect_ai');
    });

    it.each(['owner', 'member'])('is open for a new %s, with a way to skip it', async (role) => {
        const api = await checklist(ROLE[role]);
        expect(stepOf(api)).toMatchObject({ done: false, skipped: false, label: 'Home.step_connect_ai', cta: 'Home.connect_ai', alt: { key: 'skip_connect_ai', label: 'Home.skip_for_now' } });
        expect(api.steps.value[0].key).toBe('connect_ai');
    });

    it('is done once the person\'s AI has called', async () => {
        const api = await checklist(ROLE.member, { connected: true, lastSeenAt: '2026-10-01T09:00:00.000Z', via: 'token' });
        expect(stepOf(api)).toMatchObject({ done: true, skipped: false });
    });

    it('opens the page from the card', async () => {
        const api = await checklist(ROLE.member);
        api.onAction('connect_ai');
        expect(push).toHaveBeenCalledWith({ name: CONNECT_AI_ROUTE, params: { cid: 'company-1' } });
    });

    it('skipped from the card: saved on the person, no longer the next step, still open to do', async () => {
        const api = await checklist(ROLE.member);
        api.onAction('skip_connect_ai');
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', USER_ONBOARDING, { connectAiSkipped: true });
        expect(stepOf(api)).toMatchObject({ done: false, skipped: true, note: 'Home.step_skipped' });
    });

    it('does not keep the card open on its own once skipped', async () => {
        me.value = { _id: 'user-1', homeChecklist: { connectAiSkipped: true, openedMyWork: true, viewedNotifications: true, viewedShortcuts: true } };
        const api = await checklist(ROLE.member);
        expect(api.complete.value).toBe(true);
        expect(api.show.value).toBe(false);
    });

    it('does not ask the server once the card is closed for good', async () => {
        me.value = { _id: 'user-1', homeChecklist: { dismissed: true } };
        await checklist(ROLE.member);
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('the setup card with a skipped step', () => {
    it('moves on to the next step, counts the skipped one as not done and keeps it clickable', async () => {
        const { default: SetupChecklist } = await import('@/components/molecules/Home/SetupChecklist.vue');
        const wrapper = mount(SetupChecklist, {
            props: {
                steps: [
                    { key: 'connect_ai', label: 'Home.step_connect_ai', cta: 'Home.connect_ai', done: false, skipped: true, note: 'Home.step_skipped' },
                    { key: 'my_work', label: 'Home.step_my_work', cta: 'Home.open_my_work', done: false }
                ]
            },
            global: { stubs: { ShellIcon: true } }
        });
        expect(wrapper.find('.hc-setup__cta').text()).toBe('Home.open_my_work');
        expect(wrapper.find('.hc-setup__ring').text()).toBe('0/2');
        const skipped = wrapper.findAll('.hc-setup__step')[0];
        expect(skipped.classes()).toContain('is-skipped');
        expect(skipped.text()).toContain('Home.step_skipped');
        await skipped.find('button').trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['connect_ai']);
    });
});

describe('in-app AI with no server key', () => {
    const noKey = (extra = {}) => applyAiAvailability({ state: 'unconfigured', loaded: true, planAllowsAi: true, ...extra });
    const mountWithLinks = (component, options = {}) => mount(component, { ...options, global: { components: { RouterLink: LinkStub }, ...(options.global || {}) } });

    /* Every entry point that asks a model on a click. Each is drawn only while canUseAi (or aiUsable) holds. */
    const HIDDEN = [
        'components/atom/Description/Description.vue',
        'components/atom/CommentInput/CommentInput.vue',
        'components/atom/AiFieldMark/AiFieldMark.vue',
        'components/molecules/CheckList/CheckList.vue',
        'components/molecules/Pages/PageDocument.vue',
        'components/molecules/Pages/PageBlockEditor.vue',
        'components/molecules/TaskDetailTab/TaskDetailTab.vue',
        'components/organisms/SubTasks/SubTasks.vue',
        'components/organisms/SprinstList/SprintsList.vue',
        'components/organisms/TaskDetailOverlay/TaskAiRow.vue',
        'components/organisms/TaskDetailOverlay/TaskDetailPanel.vue',
        'components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue',
        'components/organisms/MainChat/MainChatComposer.vue',
        'components/organisms/MainChat/MainChatHeader.vue',
        'components/organisms/CreateProject/CreateProjectSidebar.vue',
        'views/Projects/components/ProjectEmptyState.vue',
        'views/Projects/components/ProjectFiltersToolbar.vue',
        'views/Projects/components/columns/AiFieldColumnHead.vue',
        'views/Projects/ProjectsListing/ProjectsListPage.vue',
        'views/Projects/Projects.vue',
        'views/Projects/TableView/AiColumnHead.vue',
        'views/Projects/ListView/ListBulkBar.vue',
        'views/Pages/PageEditorView.vue',
        'views/Goals/GoalSummary.vue'
    ];

    it('answers no to every "may I use AI" question, so those entry points are not drawn', () => {
        noKey();
        expect(canUseAi()).toBe(false);
        expect(canUseAi({ project: { apps: ['AI'] }, permitted: true })).toBe(false);
        expect(aiUsable.value).toBe(false);
    });

    it.each(HIDDEN)('%s asks before drawing its AI control', (file) => {
        expect(source(file)).toMatch(/canUseAi(For)?\(|aiUsable\.value/);
    });

    it('the hint is a link to the page, shown only while no model is set up', () => {
        noKey();
        const shown = mountWithLinks(ConnectAiHint);
        expect(shown.find('a').attributes('data-to')).toBe(CONNECT_AI_ROUTE);
        expect(shown.text()).toContain('ConnectAi.hint');

        applyAiAvailability({ state: 'on' });
        expect(mountWithLinks(ConnectAiHint).find('a').exists()).toBe(false);
        applyAiAvailability({ state: 'off_workspace' });
        expect(mountWithLinks(ConnectAiHint).find('a').exists()).toBe(false);
    });

    it.each(['AiAsk', 'AiHub', 'AiInbox', 'AiPipeline', 'AiRelease'])('the %s screen says Connect your AI to a member, who had no next step before', (name) => {
        noKey({ canConfigureInstance: false });
        route.name = name;
        const notice = mountWithLinks(AiModelNotice);
        expect(notice.find('[data-test="connect-ai-hint"]').attributes('data-to')).toBe(CONNECT_AI_ROUTE);
    });

    it('"Automate with AI" says Connect your AI instead of only refusing', () => {
        noKey();
        const draft = mountWithLinks(AutomationAiDraft, { props: { sentence: 'when a task is done, tell me', failed: true } });
        expect(draft.find('[data-test="ai-draft-off"]').exists()).toBe(true);
        expect(draft.find('[data-test="connect-ai-hint"]').exists()).toBe(true);
        expect(draft.find('[data-test="ai-draft"]').exists()).toBe(false);
    });

    it.each([
        'views/Ai/AgentCatalogue.vue',
        'views/Ai/AskMemoryImport.vue'
    ])('%s carries the hint beside its own words', (file) => {
        expect(source(file)).toContain('<ConnectAiHint');
    });

    it('the Ask card on a dashboard says Connect your AI', () => {
        expect(source('components/organisms/AskAQuestionCard/AskAQuestionCard.vue')).toContain('ConnectAi.card_no_model');
    });
});
