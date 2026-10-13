import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const push = vi.hoisted(() => vi.fn());
const list = vi.hoisted(() => ({ value: [] }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/plugins/dashboard/dashboardsApi', () => ({
    fetchDashboards: () => Promise.resolve(list.value),
    createDashboard: vi.fn(),
    duplicateDashboard: vi.fn(),
    removeDashboard: vi.fn(),
    makeCardUid: () => '1',
}));

import DashboardsHub from '@/views/Dashboards/DashboardsHub.vue';

const at = (x, y, w, h) => ({ x, y, w, h });
const resourceUtilization = {
    _id: 'd1',
    title: 'Resource Utilization',
    isMine: true,
    visibility: 'private',
    ownerName: 'Local PM',
    cardCount: 5,
    preview: [
        { componentId: 'FreeResourcesCard', ...at(0, 0, 6, 9) },
        { componentId: 'ProjectPulseCard', ...at(6, 0, 6, 9) },
        { componentId: 'TeamLoggedVsEtaCard', ...at(0, 9, 6, 10) },
        { componentId: 'TasksByStatusCard', ...at(6, 9, 6, 9) },
        { componentId: 'DueSoonCard', ...at(0, 19, 4, 9) },
    ],
};

let wrapper;
const mountHub = async (dashboards) => {
    list.value = dashboards;
    wrapper = mount(DashboardsHub, {
        attachTo: document.body,
        global: {
            mocks: { $t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) },
            stubs: { ShellIcon: { props: ['name'], template: '<i class="shell-icon" :data-name="name" />' } },
        },
    });
    await flushPromises();
};
const tile = () => wrapper.find('.dash__hub-grid article');

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    push.mockReset();
});

describe('a dashboard tile in the list', () => {
    it('shows no loading bars once the list has loaded', async () => {
        await mountHub([resourceUtilization]);
        expect(tile().findAll('.dash__preview-block')).toHaveLength(0);
        expect(tile().find('[class*="skeleton"]').exists()).toBe(false);
    });

    it('names the cards on the dashboard, with an icon for what each one answers', async () => {
        await mountHub([resourceUtilization]);
        const items = tile().findAll('.dash__preview-item');
        expect(items.map((item) => item.text())).toEqual([
            'Dash.card_FreeResourcesCard_title',
            'Dash.card_ProjectPulseCard_title',
            'Dash.card_TeamLoggedVsEtaCard_title',
            'Dash.card_TasksByStatusCard_title',
        ]);
        expect(items[0].find('.shell-icon').attributes('data-name')).toBe('members');
        expect(items[3].find('.shell-icon').attributes('data-name')).toBe('reports');
        expect(tile().find('.dash__preview-more').text()).toBe('Dash.preview_more:{"n":1}');
    });

    it('counts cards outside the current card set in the remainder instead of naming them', async () => {
        await mountHub([{
            ...resourceUtilization,
            cardCount: 3,
            preview: [
                { componentId: 'UsersByCategoryCard', ...at(0, 0, 6, 8) },
                { componentId: 'ProjectPulseCard', ...at(6, 0, 6, 9) },
                { componentId: 'OldCard', ...at(0, 8, 6, 8) },
            ],
        }]);
        expect(tile().findAll('.dash__preview-item').map((item) => item.text())).toEqual(['Dash.card_ProjectPulseCard_title']);
        expect(tile().find('.dash__preview-more').text()).toBe('Dash.preview_more:{"n":2}');
    });

    it('says a new dashboard has no cards yet', async () => {
        await mountHub([{ ...resourceUtilization, cardCount: 0, preview: [] }]);
        expect(tile().find('.dash__preview-item').exists()).toBe(false);
        expect(tile().text()).toContain('Dash.no_cards_yet');
    });

    it('opens from the keyboard through a button named after the dashboard', async () => {
        await mountHub([resourceUtilization]);
        const openButton = tile().find('button.dash__tile-open');
        expect(openButton.text()).toBe('Resource Utilization');
        await openButton.trigger('click');
        expect(push).toHaveBeenCalledTimes(1);
        expect(push.mock.calls[0][0]).toMatchObject({ name: 'DashboardView', params: { dashboardId: 'd1' } });
    });
});
