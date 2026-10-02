import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';

const apiRequest = vi.fn();

vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/selectedCompany': { planFeature: { actitvityView: true } } } }), createStore: () => ({}) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'p1' } }) }));
vi.mock('@/composable/projects', () => ({ useProjects: () => ({ getDateAndTime: () => 'when' }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ timeFormat: 24, Employee_Name: 'Priya' }) }), useCustomComposable: () => ({}) }));
vi.mock('@/composable/index', () => ({ useGetterFunctions: () => ({ getUser: () => ({ timeFormat: 24, Employee_Name: 'Priya' }) }) }));
vi.mock('@/services', () => ({ apiRequest: (...args) => apiRequest(...args) }));

import ActivityContent from '@/components/molecules/ActivityLogContent/ActivityContent.vue';
import ActivityLog from '@/components/templates/ActivityLog/ActivityLog.vue';

const $t = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);
const provide = { $dateFormat: { value: 'DD/MM/YYYY' }, $defaultUserAvatar: 'avatar.png', $userId: { value: 'u1' } };

const AGENT_ROW = { _id: 'h1', Message: '<b>Claude, for Priya</b> has changed <b> Status</b> as <b>Done</b>.', UserId: 'u1', actorType: 'agent', agentName: 'Claude', actedFor: 'u1', createdAt: 1 };
const PERSON_ROW = { _id: 'h2', Message: '<b>Priya</b> has changed <b> Status</b> as <b>Done</b>.', UserId: 'u1', createdAt: 2 };

const mountRow = (data) => shallowMount(ActivityContent, { props: { data: { ...data, userData: {} } }, global: { provide, mocks: { $t } } });

const mountLog = (props) => mount(ActivityLog, {
    props: { dataObj: { _id: 't1', ProjectID: 'p1' }, fromProject: false, isMainSpinner: false, ...props },
    global: {
        provide, mocks: { $t },
        stubs: { SpinnerComp: true, Skelaton: true, UpgradePlan: true, ActivityContent: { props: ['data'], template: '<div class="row-stub">{{ data.Message }}</div>' } },
    },
});

const lastQuery = () => new URLSearchParams(String(apiRequest.mock.calls[apiRequest.mock.calls.length - 1][1]).split('?')[1]);
const option = (wrapper, name) => wrapper.find(`[data-test="activity-filter-${name}"]`);

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((method, url) => Promise.resolve({ data: new URLSearchParams(url.split('?')[1]).get('madeBy') === 'agent' ? [AGENT_ROW] : [AGENT_ROW, PERSON_ROW] }));
});

describe('the agent mark on an activity line', () => {
    it('marks a line an agent made, and names the agent to assistive tech and on hover', () => {
        const mark = mountRow(AGENT_ROW).find('[data-test="activity-agent-mark"]');
        expect(mark.exists()).toBe(true);
        expect(mark.text()).toBe('ActivityLog.agent_mark');
        expect(mark.attributes('title')).toBe('ActivityLog.agent_mark_title:{"agent":"Claude"}');
        expect(mark.classes()).toEqual(expect.arrayContaining(['ah-chip', 'ah-chip--agent']));
    });

    it('leaves a person\'s own line as it was', () => {
        const wrapper = mountRow(PERSON_ROW);
        expect(wrapper.find('[data-test="activity-agent-mark"]').exists()).toBe(false);
        expect(wrapper.findAll('.wrapperNameImage > span')[0].text()).toMatch(/^Priya has changed\s+Status as Done\.$/);
    });

    it('shows a stored agent name as text, never as markup', () => {
        const mark = mountRow({ ...AGENT_ROW, agentName: '<img src=x onerror=alert(1)>' }).find('[data-test="activity-agent-mark"]');
        expect(mark.element.querySelector('img')).toBeNull();
        expect(mark.attributes('title')).toContain('<img src=x');
    });
});

describe.each([['a task\'s activity', { fromProject: false }, 't1'], ['a project\'s activity log', { fromProject: true, dataObj: { _id: 'p1' } }, null]])('the "made by an agent" filter on %s', (_where, props, taskId) => {
    it('asks for everything first, with no filter in the request', async () => {
        const wrapper = mountLog(props);
        await flushPromises();
        expect(lastQuery().get('madeBy')).toBeNull();
        expect(lastQuery().get('taskId')).toBe(taskId);
        expect(wrapper.findAll('.row-stub')).toHaveLength(2);
        expect(option(wrapper, 'all').attributes('aria-pressed')).toBe('true');
        expect(option(wrapper, 'agent').attributes('aria-pressed')).toBe('false');
    });

    it('asks the server for agent lines only, from the first page, and back again', async () => {
        const wrapper = mountLog(props);
        await flushPromises();
        await option(wrapper, 'agent').trigger('click');
        await flushPromises();
        expect(lastQuery().get('madeBy')).toBe('agent');
        expect(lastQuery().get('skip')).toBe('0');
        expect(wrapper.findAll('.row-stub')).toHaveLength(1);
        expect(option(wrapper, 'agent').attributes('aria-pressed')).toBe('true');

        await option(wrapper, 'all').trigger('click');
        await flushPromises();
        expect(lastQuery().get('madeBy')).toBeNull();
        expect(wrapper.findAll('.row-stub')).toHaveLength(2);
    });

    it('says so when no agent has changed anything', async () => {
        apiRequest.mockImplementation(() => Promise.resolve({ data: [] }));
        const wrapper = mountLog(props);
        await flushPromises();
        expect(wrapper.text()).toContain('ProjectSlider.no_activity_log_found');
        await option(wrapper, 'agent').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('ActivityLog.no_agent_activity');
        expect(wrapper.text()).not.toContain('ProjectSlider.no_activity_log_found');
    });
});
