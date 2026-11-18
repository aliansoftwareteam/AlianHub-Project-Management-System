import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import InstallAppItem from '@/components/organisms/Shell/InstallAppItem.vue';
import { installAvailable, watchInstallPrompt, resetInstallPrompt } from '@/serviceWorker/installPrompt';

const fakeWindow = ({ standalone = false } = {}) => {
    const listeners = {};
    return {
        navigator: {},
        matchMedia: (query) => ({ matches: standalone && query === '(display-mode: standalone)' }),
        addEventListener: (type, handler) => { listeners[type] = handler; },
        fire: (type, event = {}) => listeners[type] && listeners[type](event),
    };
};

const browserOffer = () => ({ preventDefault: vi.fn(), prompt: vi.fn().mockResolvedValue(undefined) });

const mountItem = () => mount(InstallAppItem, { global: { stubs: { ShellIcon: true } } });

describe('the Install app entry', () => {
    beforeEach(() => resetInstallPrompt());

    it('is absent until the browser offers an install', () => {
        watchInstallPrompt(fakeWindow());
        expect(installAvailable.value).toBe(false);
        expect(mountItem().find('[data-test="install-app"]').exists()).toBe(false);
    });

    it('appears when the browser offers one, and holds back the browser\'s own pop-up', () => {
        const win = fakeWindow();
        const offer = browserOffer();
        watchInstallPrompt(win);
        win.fire('beforeinstallprompt', offer);

        expect(offer.preventDefault).toHaveBeenCalledTimes(1);
        expect(offer.prompt).not.toHaveBeenCalled();
        const entry = mountItem().find('[data-test="install-app"]');
        expect(entry.exists()).toBe(true);
        expect(entry.text()).toContain('Shell.install_app');
    });

    it('opens the browser\'s install dialog on click, once, and then goes away', async () => {
        const win = fakeWindow();
        const offer = browserOffer();
        watchInstallPrompt(win);
        win.fire('beforeinstallprompt', offer);
        const wrapper = mountItem();

        await wrapper.find('[data-test="install-app"]').trigger('click');
        await flushPromises();

        expect(offer.prompt).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted('done')).toHaveLength(1);
        expect(wrapper.find('[data-test="install-app"]').exists()).toBe(false);
    });

    it('stays hidden in the installed app', () => {
        const win = fakeWindow({ standalone: true });
        watchInstallPrompt(win);
        win.fire('beforeinstallprompt', browserOffer());
        expect(installAvailable.value).toBe(false);
    });

    it('goes away once the app is installed', () => {
        const win = fakeWindow();
        watchInstallPrompt(win);
        win.fire('beforeinstallprompt', browserOffer());
        win.fire('appinstalled');
        expect(installAvailable.value).toBe(false);
    });
});
