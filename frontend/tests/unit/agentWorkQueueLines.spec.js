import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1' } }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));

import TaskAgentClaim from '@/components/organisms/TaskDetailOverlay/TaskAgentClaim.vue';
import ProjectManagerCard from '@/views/Projects/ProjectDetail/ProjectManagerCard.vue';
import en from '@/locales/en';

const LINE = path.resolve(__dirname, '../../src/components/organisms/TaskDetailOverlay/TaskAgentClaim.vue');
const PANEL = path.resolve(__dirname, '../../src/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue');
const TASK_URL = '/api/v2/agents/work-queue/task/t1';
const CARD_URL = '/api/v2/agents/project-manager/p1';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { status: 403, data: { status: false, statusText } } }));
const claim = { name: 'Claude, for Priya', until: '2026-10-07T09:30:00.000Z' };
const held = (over = {}) => ({ id: 'i1', rule: 'no_owner', claim, canTakeBack: true, ...over });
const about = (over = {}) => ({ on: true, canHandOver: false, items: [], ...over });

let wrapper;
const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const mountWith = async (component, props) => {
    const words = i18n();
    wrapper = mount(component, { props, global: { plugins: [words], mocks: { $t: words.global.t }, stubs: { RouterLink: true } } });
    await flushPromises();
    return wrapper;
};
const answers = (table) => apiRequest.mockImplementation((type, url) => {
    const answer = table[`${type} ${url}`];
    return typeof answer === 'function' ? answer() : ok(answer);
});

beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); });
afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('the line on a task', () => {
    const line = () => wrapper.find('[data-test="claim-line"]');

    it('shows nothing where the project does not use the queue, or the task cannot be read', async () => {
        answers({ [`get ${TASK_URL}`]: { on: false, canHandOver: false, items: [] } });
        await mountWith(TaskAgentClaim, { taskId: 't1' });
        expect(wrapper.find('[data-test="task-agent-claim"]').exists()).toBe(false);
        apiRequest.mockImplementation(() => refused('nope'));
        await wrapper.setProps({ taskId: 't2' });
        await flushPromises();
        expect(wrapper.find('[data-test="task-agent-claim"]').exists()).toBe(false);
    });

    it('says who is working on it, and offers to take it back to a person who may', async () => {
        answers({ [`get ${TASK_URL}`]: about({ items: [held()] }) });
        await mountWith(TaskAgentClaim, { taskId: 't1' });
        expect(line().text()).toContain('Claude, for Priya is working on this');
        expect(line().text()).toContain(en.ProjectManager.rule_no_owner);
        expect(wrapper.find('[data-test="take-back"]').text()).toBe('Take it back');
    });

    it('offers nothing to a person who may not take it back', async () => {
        answers({ [`get ${TASK_URL}`]: about({ items: [held({ canTakeBack: false })] }) });
        await mountWith(TaskAgentClaim, { taskId: 't1' });
        expect(line().exists()).toBe(true);
        expect(wrapper.find('[data-test="take-back"]').exists()).toBe(false);
    });

    it('takes it back with one press and shows what the server answers', async () => {
        answers({ [`get ${TASK_URL}`]: about({ items: [held()] }), 'post /api/v2/agents/work-queue/i1/take-back': about({ canHandOver: true }) });
        await mountWith(TaskAgentClaim, { taskId: 't1' });
        await wrapper.find('[data-test="take-back"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('post', '/api/v2/agents/work-queue/i1/take-back', {});
        expect(line().exists()).toBe(false);
        expect(wrapper.find('[data-test="hand-over"]').text()).toBe('Hand to an agent');
    });

    it('hands a task to an agent, then says it is waiting for one', async () => {
        answers({ [`get ${TASK_URL}`]: about({ canHandOver: true }), [`post ${TASK_URL}/hand-over`]: about({ items: [held({ rule: 'handed_over', claim: null })] }) });
        await mountWith(TaskAgentClaim, { taskId: 't1' });
        await wrapper.find('[data-test="hand-over"]').trigger('click');
        await flushPromises();
        expect(line().text()).toContain(en.ProjectManager.waiting_for_agent);
        expect(wrapper.find('[data-test="hand-over"]').exists()).toBe(false);
    });

    it('says why when the server refuses', async () => {
        answers({ [`get ${TASK_URL}`]: about({ items: [held()] }), 'post /api/v2/agents/work-queue/i1/take-back': () => refused('You cannot take this item back.') });
        await mountWith(TaskAgentClaim, { taskId: 't1' });
        await wrapper.find('[data-test="take-back"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="claim-error"]').text()).toBe('You cannot take this item back.');
        expect(line().exists()).toBe(true);
    });

    it('is on the task panel, colours with tokens only and wraps on a narrow screen', () => {
        expect(fs.readFileSync(PANEL, 'utf8')).toMatch(/<TaskAgentClaim v-if="task\._id" :task-id="String\(task\._id\)" :round="claimRound" \/>/);
        const source = fs.readFileSync(LINE, 'utf8');
        const style = source.slice(source.indexOf('<style'));
        expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
        expect(style).not.toMatch(/var\(--ink-3\)/);
        expect(style).toMatch(/flex-wrap: wrap/);
        expect(style).toMatch(/min-width: 0/);
        const keys = [...new Set(source.match(/ProjectManager\.[a-z_]+/g))].filter((key) => !key.endsWith('_'));
        keys.forEach((key) => expect(en.ProjectManager[key.split('.')[1]], key).toEqual(expect.any(String)));
    });
});

describe('the line on the Project manager card', () => {
    const finding = (over = {}) => ({ id: 'i1', rule: 'no_owner', taskId: 't1', userId: '', facts: { taskKey: 'AP-12', taskName: 'Ship the page' }, canDecide: false, openedAt: '2026-10-07T09:00:00.000Z', ...over });
    const cardAnswer = (findings) => ({ on: true, level: 'suggest', canEdit: false, findings });

    it('says who holds a finding, and stays quiet for one nobody holds', async () => {
        answers({ [`get ${CARD_URL}`]: cardAnswer([finding({ claim, canTakeBack: false }), finding({ id: 'i2', rule: 'no_estimate' })]) });
        await mountWith(ProjectManagerCard, { projectId: 'p1' });
        const rows = wrapper.findAll('[data-test="finding"]');
        expect(rows[0].find('[data-test="finding-claim"]').text()).toContain('Claude, for Priya is working on this');
        expect(rows[0].find('[data-test="finding-take-back"]').exists()).toBe(false);
        expect(rows[1].find('[data-test="finding-claim"]').exists()).toBe(false);
    });

    it('takes a finding back and reads the card again', async () => {
        let taken = false;
        apiRequest.mockImplementation((type, url) => {
            if (type === 'post') { taken = true; return ok({ on: true, canHandOver: true, items: [] }); }
            expect(url).toBe(CARD_URL);
            return ok(cardAnswer([finding(taken ? {} : { claim, canTakeBack: true })]));
        });
        await mountWith(ProjectManagerCard, { projectId: 'p1' });
        await wrapper.find('[data-test="finding-take-back"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/work-queue/i1/take-back', {});
        expect(wrapper.find('[data-test="finding-claim"]').exists()).toBe(false);
        expect(wrapper.findAll('[data-test="finding"]')).toHaveLength(1);
        expect(toast.success).toHaveBeenCalledWith(en.ProjectManager.taken_back, expect.anything());
    });

    it('lists a task a person handed over, in plain words', async () => {
        answers({ [`get ${CARD_URL}`]: cardAnswer([finding({ rule: 'handed_over' })]) });
        await mountWith(ProjectManagerCard, { projectId: 'p1' });
        const text = wrapper.find('[data-test="finding"]').text();
        expect(text).toContain(en.ProjectManager.rule_handed_over);
        expect(text).toContain(en.ProjectManager.reason_handed_over);
        expect(text).toContain(en.ProjectManager.offer_handed_over);
    });
});
