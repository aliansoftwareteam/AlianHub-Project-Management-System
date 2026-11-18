import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, openTask } = vi.hoisted(() => ({ apiRequest: vi.fn(), openTask: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));

import StandupCard from '@/components/molecules/Home/StandupCard.vue';

const task = (id, name) => ({ taskId: id, taskKey: `K-${id}`, taskName: name, projectId: 'p1', sprintId: 's1', folderId: '' });

const standup = (over = {}) => ({
    since: 'yesterday',
    yesterday: [{ kind: 'completed', task: task('t1', 'Ship export') }, { kind: 'commented', task: task('t2', 'Review copy') }],
    today: [{ kind: 'due_today', task: task('t3', 'Send invoice') }],
    blocked: [{ kind: 'overdue', task: task('t4', 'Fix login'), days: 2 }],
    totals: { yesterday: 2, today: 1, blocked: 1 },
    ...over,
});

const respond = (data) => apiRequest.mockResolvedValue({ data: { status: true, data } });

const open = async () => {
    const wrapper = mount(StandupCard);
    await flushPromises();
    return wrapper;
};

describe('Standup (Home card)', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        openTask.mockReset();
    });

    it('asks for the caller\'s own standup in their time zone', async () => {
        respond(standup());
        await open();
        const [type, url] = apiRequest.mock.calls[0];
        expect(type).toBe('get');
        expect(url).toMatch(/^\/api\/v2\/agents\/team\/standup\?tz=-?\d+$/);
    });

    it('reads as yesterday, today and blocked, built from activity and not from a model', async () => {
        respond(standup());
        const wrapper = await open();
        const sections = wrapper.findAll('[data-test="standup-section"]');
        expect(sections.map((s) => s.find('h3').text())).toEqual(['Home.standup_yesterday', 'Home.standup_today', 'Home.standup_blocked']);
        expect(sections[0].text()).toContain('Ship export');
        expect(sections[2].text()).toContain('Fix login');
        expect(wrapper.find('[data-test="standup-source"]').text()).toBe('Home.standup_source');
        expect(wrapper.text()).not.toContain('✦');
    });

    it('says since Friday on a Monday', async () => {
        respond(standup({ since: 'friday' }));
        const wrapper = await open();
        expect(wrapper.findAll('[data-test="standup-section"] h3')[0].text()).toBe('Home.standup_since_friday');
    });

    it('opens a task from its line', async () => {
        respond(standup());
        const wrapper = await open();
        await wrapper.findAll('[data-test="standup-task"]')[0].trigger('click');
        expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', projectId: 'p1', sprintId: 's1' }));
    });

    it('says so when there is nothing to report', async () => {
        respond(standup({ yesterday: [], today: [], blocked: [], totals: { yesterday: 0, today: 0, blocked: 0 } }));
        const wrapper = await open();
        expect(wrapper.findAll('[data-test="standup-section"]')).toHaveLength(0);
        expect(wrapper.find('[data-test="standup-empty"]').exists()).toBe(true);
    });

    it('offers a retry when the standup cannot be built', async () => {
        apiRequest.mockRejectedValueOnce(new Error('down'));
        const wrapper = await open();
        expect(wrapper.find('[data-test="standup-error"]').exists()).toBe(true);
        respond(standup());
        await wrapper.find('[data-test="standup-retry"]').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('[data-test="standup-section"]')).toHaveLength(3);
    });

    it('can be hidden from Home', async () => {
        respond(standup());
        const wrapper = await open();
        await wrapper.find('[data-test="standup-hide"]').trigger('click');
        expect(wrapper.emitted('hide')).toHaveLength(1);
    });
});
