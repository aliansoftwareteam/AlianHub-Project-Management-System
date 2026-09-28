import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay, apiRequest: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import HomeCardsMenu from '@/components/molecules/Home/HomeCardsMenu.vue';
import { HOME_CARDS, homeCards, isHomeCardShown, resetHomeCards, setHomeCardShown, syncHomeCards } from '@/components/molecules/Home/homeCards';

const blank = { render: () => null };

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

describe('Home cards preferences', () => {
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { hidden: [] } } });
        resetHomeCards();
    });

    it('offers the waiting, standup and assigned comments cards', () => {
        expect(HOME_CARDS.map((c) => c.id)).toEqual(['waiting', 'standup', 'assigned_comments']);
    });

    it('shows every card until the person hides one', () => {
        syncHomeCards('user-1', undefined);
        expect(isHomeCardShown('waiting')).toBe(true);
        expect(isHomeCardShown('standup')).toBe(true);
    });

    it('reads what the person hid from their own record', () => {
        syncHomeCards('user-1', { hidden: ['standup'] });
        expect(isHomeCardShown('standup')).toBe(false);
        expect(isHomeCardShown('waiting')).toBe(true);
    });

    it('saves a hidden card to the caller\'s record', async () => {
        syncHomeCards('user-1', { hidden: [] });
        await setHomeCardShown('standup', false);
        expect(homeCards.hidden).toEqual(['standup']);
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', '/api/v2/users/home-cards', { hidden: ['standup'] });
    });

    it('puts the card back when the save is refused', async () => {
        syncHomeCards('user-1', { hidden: [] });
        apiRequestWithoutCompnay.mockRejectedValueOnce(new Error('nope'));
        await setHomeCardShown('waiting', false).catch(() => {});
        expect(isHomeCardShown('waiting')).toBe(true);
    });
});

describe('Manage cards menu', () => {
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { hidden: [] } } });
        resetHomeCards();
        syncHomeCards('user-1', { hidden: ['standup'] });
    });

    it('lists each Home card with whether it is on Home', async () => {
        const wrapper = await open();
        const boxes = wrapper.findAll('[data-test="home-card-option"] input[type="checkbox"]');
        expect(boxes).toHaveLength(3);
        expect(boxes.map((b) => b.element.checked)).toEqual([true, false, true]);
        wrapper.unmount();
    });

    it('adds a card back to Home', async () => {
        const wrapper = await open();
        await wrapper.findAll('[data-test="home-card-option"] input[type="checkbox"]')[1].setValue(true);
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', '/api/v2/users/home-cards', { hidden: [] });
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
