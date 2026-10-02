import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay, apiRequest: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import HomeCardsMenu from '@/components/molecules/Home/HomeCardsMenu.vue';
import {
    DEFAULT_HOME_LAYOUT, HOME_CARDS, HOME_CATALOG_KEYS, homeCards, homeCardInfo, isHomeCardShown, moveHomeCard,
    resetHomeCards, resolveHomeLayout, setHomeCardShown, syncHomeCards, addHomeCard, removeHomeCard,
} from '@/components/molecules/Home/homeCards';
import { catalogEntry } from '@/plugins/dashboard/cardCatalog';

const blank = { render: () => null };
const SAVE = '/api/v2/users/home-cards';

const open = async ({ dashboards = true } = {}) => {
    const routes = [{ path: '/:cid', name: 'Home', component: blank }];
    if (dashboards) routes.push({ path: '/:cid/dashboards', name: 'Dashboards', component: blank });
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push({ name: 'Home', params: { cid: 'company-1' } });
    await router.isReady();
    const wrapper = mount(HomeCardsMenu, { global: { plugins: [router] }, attachTo: document.body });
    await wrapper.find('[data-test="home-cards-toggle"]').trigger('click');
    return wrapper;
};

const rowIds = (wrapper) => wrapper.findAll('[data-test="home-card-row"]').map((row) => row.attributes('data-card'));
const lastSaved = () => apiRequestWithoutCompnay.mock.calls.at(-1);

describe('Home cards and the dashboard catalogue', () => {
    it('has its own cards, including Recents and Goals', () => {
        expect(HOME_CARDS.map((c) => c.id)).toEqual(['waiting', 'standup', 'assigned_comments', 'recents', 'goals']);
    });

    it('offers only built dashboard cards, read from the dashboard catalogue', () => {
        expect(HOME_CATALOG_KEYS.length).toBeGreaterThan(1);
        HOME_CATALOG_KEYS.forEach((key) => {
            expect(catalogEntry(key)?.built).toBe(true);
            expect(homeCardInfo(key)).toMatchObject({ id: key, kind: 'catalog', labelKey: catalogEntry(key).titleKey });
        });
    });

    it('leaves team and management cards off a personal Home', () => {
        expect(HOME_CATALOG_KEYS).not.toContain('TeamLoggedVsEtaCard');
        expect(HOME_CATALOG_KEYS).not.toContain('FreeResourcesCard');
        expect(homeCardInfo('FreeResourcesCard')).toBeNull();
    });
});

describe('resolveHomeLayout', () => {
    it('gives a person who never arranged Home the default cards, Recents included', () => {
        expect(resolveHomeLayout(undefined)).toEqual([...DEFAULT_HOME_LAYOUT]);
        expect(DEFAULT_HOME_LAYOUT).toContain('recents');
    });

    it('carries over the cards someone hid before layouts existed', () => {
        expect(resolveHomeLayout({ hidden: ['standup'] })).toEqual(DEFAULT_HOME_LAYOUT.filter((id) => id !== 'standup'));
    });

    it('follows a saved layout in its order', () => {
        expect(resolveHomeLayout({ layout: ['MyTimeCard', 'recents'], hidden: ['recents'] })).toEqual(['MyTimeCard', 'recents']);
    });

    it('skips an unknown or retired card and a repeat', () => {
        expect(resolveHomeLayout({ layout: ['RetiredCard', 'standup', 'standup', 42, 'FreeResourcesCard'] })).toEqual(['standup']);
    });

    it('keeps an empty saved Home empty', () => {
        expect(resolveHomeLayout({ layout: [] })).toEqual([]);
    });
});

describe('Home layout preferences', () => {
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: {} } });
        resetHomeCards();
        syncHomeCards('user-1', { layout: ['waiting', 'recents', 'standup'] });
    });

    it('reads the layout from the person\'s own record once', () => {
        expect(homeCards.layout).toEqual(['waiting', 'recents', 'standup']);
        syncHomeCards('user-1', { layout: [] });
        expect(homeCards.layout).toEqual(['waiting', 'recents', 'standup']);
        expect(isHomeCardShown('assigned_comments')).toBe(false);
    });

    it('adds a card at the end and saves the whole layout', async () => {
        await addHomeCard('DueSoonCard');
        expect(homeCards.layout).toEqual(['waiting', 'recents', 'standup', 'DueSoonCard']);
        expect(lastSaved()).toEqual(['put', SAVE, { layout: ['waiting', 'recents', 'standup', 'DueSoonCard'] }]);
    });

    it('does not add a card that is already on Home or not allowed there', async () => {
        await addHomeCard('recents');
        await addHomeCard('FreeResourcesCard');
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });

    it('moves a card and removes one', async () => {
        await moveHomeCard('standup', 0);
        expect(homeCards.layout).toEqual(['standup', 'waiting', 'recents']);
        await removeHomeCard('waiting');
        expect(lastSaved()).toEqual(['put', SAVE, { layout: ['standup', 'recents'] }]);
    });

    it('hides a card through the old call', async () => {
        await setHomeCardShown('recents', false);
        expect(lastSaved()).toEqual(['put', SAVE, { layout: ['waiting', 'standup'] }]);
    });

    it('puts the layout back when the save is refused', async () => {
        apiRequestWithoutCompnay.mockRejectedValueOnce(new Error('nope'));
        await expect(moveHomeCard('standup', 0)).rejects.toThrow('nope');
        expect(homeCards.layout).toEqual(['waiting', 'recents', 'standup']);
    });
});

describe('Manage cards menu', () => {
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: {} } });
        resetHomeCards();
        syncHomeCards('user-1', { layout: ['waiting', 'recents', 'standup'] });
    });

    it('lists the cards on Home in their order', async () => {
        const wrapper = await open();
        expect(rowIds(wrapper)).toEqual(['waiting', 'recents', 'standup']);
        wrapper.unmount();
    });

    it('moves a card with named buttons, and cannot move past either end', async () => {
        const wrapper = await open();
        const rows = wrapper.findAll('[data-test="home-card-row"]');
        const up = rows[0].find('[data-test="home-card-up"]');
        const down = rows[2].find('[data-test="home-card-down"]');
        expect(up.attributes('disabled')).toBeDefined();
        expect(down.attributes('disabled')).toBeDefined();
        expect(rows[1].find('[data-test="home-card-up"]').attributes('aria-label')).toBe('Home.move_card_up');
        await rows[1].find('[data-test="home-card-down"]').trigger('click');
        await flushPromises();
        expect(rowIds(wrapper)).toEqual(['waiting', 'standup', 'recents']);
        expect(lastSaved()).toEqual(['put', SAVE, { layout: ['waiting', 'standup', 'recents'] }]);
        wrapper.unmount();
    });

    it('reorders by drag and drop', async () => {
        const wrapper = await open();
        const rows = wrapper.findAll('[data-test="home-card-row"]');
        const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
        await rows[2].trigger('dragstart', { dataTransfer });
        await rows[0].trigger('dragover', { dataTransfer });
        await rows[0].trigger('drop', { dataTransfer });
        await flushPromises();
        expect(rowIds(wrapper)).toEqual(['standup', 'waiting', 'recents']);
        wrapper.unmount();
    });

    it('removes a card from Home', async () => {
        const wrapper = await open();
        const remove = wrapper.findAll('[data-test="home-card-remove"]')[1];
        expect(remove.attributes('aria-label')).toBe('Home.remove_card');
        await remove.trigger('click');
        await flushPromises();
        expect(rowIds(wrapper)).toEqual(['waiting', 'standup']);
        wrapper.unmount();
    });

    it('adds a card from the dashboard catalogue picker, offering only what fits on Home', async () => {
        const wrapper = await open();
        await wrapper.find('[data-test="home-cards-add"]').trigger('click');
        const picker = wrapper.findComponent({ name: 'CardPicker' });
        expect(picker.exists()).toBe(true);
        const offered = picker.props('entries').map((e) => e.key);
        expect(offered).toEqual(expect.arrayContaining(['recents', 'assigned_comments', ...HOME_CATALOG_KEYS]));
        expect(offered).not.toContain('FreeResourcesCard');
        expect(picker.props('added')).toEqual(['waiting', 'recents', 'standup']);
        picker.vm.$emit('add', picker.props('entries').find((e) => e.key === 'MyTimeCard'));
        await flushPromises();
        expect(rowIds(wrapper)).toEqual(['waiting', 'recents', 'standup', 'MyTimeCard']);
        expect(wrapper.findComponent({ name: 'CardPicker' }).exists()).toBe(false);
        wrapper.unmount();
    });

    it('still leads to the dashboards when they exist', async () => {
        const wrapper = await open();
        expect(wrapper.find('[data-test="home-cards-dashboards"]').attributes('href')).toBe('/company-1/dashboards');
        wrapper.unmount();
        const without = await open({ dashboards: false });
        expect(without.find('[data-test="home-cards-dashboards"]').exists()).toBe(false);
        without.unmount();
    });

    it('names its button for screen readers and reports whether it is open', async () => {
        const wrapper = await open();
        const toggle = wrapper.find('[data-test="home-cards-toggle"]');
        expect(toggle.attributes('aria-label')).toBe('Home.manage_cards');
        expect(toggle.attributes('aria-expanded')).toBe('true');
        wrapper.unmount();
    });
});
