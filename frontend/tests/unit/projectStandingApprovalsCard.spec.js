import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ 'u-priya': { Employee_Name: 'Priya' }, 'u-sam': { Employee_Name: 'Sam' } }[id] || null) }),
    useConvertDate: () => ({ convertDateFormat: (at) => String(at).slice(0, 10) }),
}));

import ProjectStandingApprovalsCard from '@/views/Projects/ProjectDetail/ProjectStandingApprovalsCard.vue';

const URL = '/api/v2/agents/standing-approvals/p1';
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { status: 403, data: { status: false, statusText } } }));
const standing = (id, over = {}) => ({
    id, projectId: 'p1', action: 'task.comment', label: 'Comment on a task', agentName: 'Claude (MCP)', requestedBy: 'u-priya', madeBy: 'u-sam',
    madeAt: '2026-09-28T09:00:00.000Z', expiresAt: '2026-12-27T09:00:00.000Z', uses: 3, status: 'active', canEnd: true, ...over,
});

const mountCard = async (rows, onDelete = () => ok({})) => {
    apiRequest.mockImplementation((type) => (type === 'get' ? ok({ rows, lifetimeDays: 90 }) : onDelete()));
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    const wrapper = mount(ProjectStandingApprovalsCard, { props: { projectId: 'p1' }, global: { plugins: [i18n] } });
    await flushPromises();
    return wrapper;
};
const rowsOf = (wrapper) => wrapper.findAll('[data-test="standing-row"]');

describe('ProjectStandingApprovalsCard', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); });

    it('lists each standing approval: the agent and its person, the kind of change, who made it, when it ends and how often it was used', async () => {
        const wrapper = await mountCard([standing('s1'), standing('s2', { label: 'Add a tag to a task', uses: 0 })]);
        expect(apiRequest).toHaveBeenCalledWith('get', URL, undefined);
        expect(rowsOf(wrapper)).toHaveLength(2);
        const text = rowsOf(wrapper)[0].text();
        expect(text).toContain('Claude (MCP), for Priya');
        expect(text).toContain('Comment on a task');
        expect(text).toContain('Sam');
        expect(text).toContain('2026-12-27');
        expect(text).toContain('3');
        expect(wrapper.text()).toContain('90 days');
    });

    it('says how one is made when there is none', async () => {
        const wrapper = await mountCard([]);
        expect(rowsOf(wrapper)).toHaveLength(0);
        expect(wrapper.find('[data-test="standing-empty"]').text()).toContain('Always do this');
    });

    it('removes one with one click, and the row goes', async () => {
        const wrapper = await mountCard([standing('s1'), standing('s2')]);
        const button = rowsOf(wrapper)[0].find('[data-test="standing-remove"]');
        expect(button.attributes('aria-label')).toContain('Comment on a task');
        await button.trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('delete', `${URL}/s1`, undefined);
        expect(rowsOf(wrapper).map((node) => node.attributes('data-id'))).toEqual(['s2']);
        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it('keeps the row and shows the reason when the removal is refused', async () => {
        const wrapper = await mountCard([standing('s1')], () => refused('Standing approval not found.'));
        await wrapper.find('[data-test="standing-remove"]').trigger('click');
        await flushPromises();
        expect(rowsOf(wrapper)).toHaveLength(1);
        expect(wrapper.find('[data-test="standing-error"]').text()).toContain('Standing approval not found.');
    });

    it('offers no removal on a row the viewer may not end', async () => {
        const wrapper = await mountCard([standing('s1', { canEnd: false })]);
        expect(wrapper.find('[data-test="standing-remove"]').exists()).toBe(false);
    });

    it('shows nothing but the reason when the list cannot be read', async () => {
        apiRequest.mockImplementation(() => refused('Guests do not see standing approvals.'));
        const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
        const wrapper = mount(ProjectStandingApprovalsCard, { props: { projectId: 'p1' }, global: { plugins: [i18n] } });
        await flushPromises();
        expect(rowsOf(wrapper)).toHaveLength(0);
        expect(wrapper.find('[data-test="standing-error"]').text()).toContain('Guests do not see standing approvals.');
    });
});
