import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));

import en from '@/locales/en';
import CompanyView from '@/views/Ai/CompanyView.vue';
import CompanyOrgChart from '@/views/Ai/CompanyOrgChart.vue';
import CompanyFlowBoard from '@/views/Ai/CompanyFlowBoard.vue';
import { useCompanyView } from '@/views/Ai/useCompanyView';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const global = { plugins: [i18n], mocks: { $t: i18n.global.t } };

const lane = (count = 0, items = []) => ({ count, items });
const item = (taskName, more = {}) => ({ taskId: taskName, taskKey: 'T-1', taskName, projectId: 'p1', project: 'Launch', ...more });

const ORG = {
    on: true,
    blueprints: [{
        blueprint: 'it-company',
        teams: [{ team: 'Support', roles: [{
            key: 'it-company/bug-triager', name: 'Bug Triager',
            projects: [{ id: 'p1', name: 'Launch', mode: 'suggest' }, { id: 'p2', name: 'Site', mode: 'apply' }],
            agents: [{ id: 'a1', name: 'Triage A', paused: true }],
            supervisors: [{ id: 'u1', name: 'Olive', via: 'agent' }],
        }, {
            key: 'it-company/code-reviewer', name: 'Code Reviewer', projects: [{ id: 'p1', name: 'Launch', mode: 'suggest' }], agents: [],
            supervisors: [{ id: 'u2', name: 'Mia', via: 'settings' }],
        }] }],
    }],
};

const FLOW = {
    on: true,
    stuckDays: 3,
    unrouted: lane(1, [item('Unrouted one')]),
    roles: [{
        key: 'it-company/bug-triager', name: 'Bug Triager',
        waiting: lane(1, [item('Suggested one')]),
        queued: lane(7, [item('Q1'), item('Q2'), item('Q3'), item('Q4'), item('Q5')]),
        held: lane(1, [item('Held one', { why: 'approval' })]),
        stuck: lane(1, [item('Old one', { stuck: true })]),
    }],
};

const answer = (org, flow) => apiRequest.mockImplementation((method, url) => Promise.resolve({
    data: { status: true, data: url.endsWith('org-chart') ? org : flow },
}));

const mountPage = async () => {
    const wrapper = mount(CompanyView, { global });
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    const { orgChart, flowBoard, forget } = useCompanyView();
    orgChart.value = null;
    flowBoard.value = null;
    forget();
});

describe('org chart panel', () => {
    it('shows blueprints, teams, roles, their agents and who supervises them', () => {
        const wrapper = mount(CompanyOrgChart, { props: { data: ORG }, global });
        const triager = wrapper.find('[data-role="it-company/bug-triager"]');
        expect(wrapper.find('[data-team="Support"]').exists()).toBe(true);
        expect(triager.text()).toContain('Bug Triager');
        expect(triager.text()).toContain('2 projects');
        expect(triager.text()).toContain('Triage A');
        expect(triager.text()).toContain('Paused');
        expect(triager.find('[data-test="supervisor"]').text()).toBe('Supervised by Olive');
        const reviewer = wrapper.find('[data-role="it-company/code-reviewer"]');
        expect(reviewer.text()).toContain('1 project');
        expect(reviewer.text()).toContain('No agent plays this role yet');
        expect(reviewer.find('[data-test="supervisor"]').text()).toBe('Set up by Mia');
    });

    it('names a supervisor with no name through the translations', () => {
        const nameless = { ...ORG, blueprints: [{ ...ORG.blueprints[0], teams: [{ team: 'Support', roles: [{ ...ORG.blueprints[0].teams[0].roles[0], supervisors: [{ id: 'u9', name: '', via: 'agent' }] }] }] }] };
        const wrapper = mount(CompanyOrgChart, { props: { data: nameless }, global });
        expect(wrapper.find('[data-test="supervisor"]').text()).toBe('Supervised by an unknown person');
    });

    it('says so when no role is on', () => {
        const wrapper = mount(CompanyOrgChart, { props: { data: { on: true, blueprints: [] } }, global });
        expect(wrapper.find('[data-test="org-empty"]').exists()).toBe(true);
    });
});

describe('flow board panel', () => {
    it('shows each role with its four counts, the held reason, and a note for the tasks not listed', () => {
        const wrapper = mount(CompanyFlowBoard, { props: { data: FLOW }, global });
        const triager = wrapper.find('[data-lane="it-company/bug-triager"]');
        const count = (bucket) => triager.find(`[data-bucket="${bucket}"] .ah-chip`).text();
        expect([count('waiting'), count('queued'), count('held'), count('stuck')]).toEqual(['1', '7', '1', '1']);
        expect(triager.find('[data-bucket="queued"]').text()).toContain('and 2 more');
        expect(triager.find('[data-bucket="held"]').text()).toContain('Waiting for approval');
        expect(triager.find('[data-bucket="stuck"] .ah-chip').classes()).toContain('ah-chip--danger');
        expect(wrapper.find('[data-lane="unrouted"]').text()).toContain('Unrouted one');
        expect(wrapper.text()).toContain('no activity for 3 days');
    });

    it('says so when there is no role', () => {
        const wrapper = mount(CompanyFlowBoard, { props: { data: { on: true, stuckDays: 3, unrouted: lane(), roles: [] } }, global });
        expect(wrapper.find('[data-test="flow-empty"]').exists()).toBe(true);
    });
});

describe('company view page', () => {
    it('reads each panel once and shows both', async () => {
        answer(ORG, FLOW);
        const wrapper = await mountPage();
        expect(apiRequest.mock.calls.map(([, url]) => url.split('/').pop()).sort()).toEqual(['flow-board', 'org-chart']);
        expect(wrapper.find('[data-test="org-chart"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="flow-board"]').exists()).toBe(true);
    });

    it('shows only the off notice, and reads nothing more, while the dispatcher is off', async () => {
        answer({ on: false, blueprints: [] }, { on: false });
        const wrapper = await mountPage();
        expect(wrapper.find('[data-test="off"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="org-chart"]').exists()).toBe(false);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });
});

describe('shared company view state', () => {
    it('reads the org chart again, and drops the last one, after a switch of company', async () => {
        localStorage.setItem('selectedCompany', 'company-a');
        apiRequest.mockResolvedValue({ data: { status: true, data: ORG } });
        const { orgChart, loadOrgChart } = useCompanyView();
        await loadOrgChart();
        await loadOrgChart();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(orgChart.value).toEqual(ORG);

        localStorage.setItem('selectedCompany', 'company-b');
        let settle;
        apiRequest.mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }));
        const pending = loadOrgChart();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(orgChart.value).toBeNull();
        settle({ data: { status: true, data: { on: false, blueprints: [] } } });
        await pending;
        expect(orgChart.value).toEqual({ on: false, blueprints: [] });
        localStorage.removeItem('selectedCompany');
    });
});
