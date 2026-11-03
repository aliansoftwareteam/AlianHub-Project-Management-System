import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

const { roleType } = vi.hoisted(() => ({ roleType: { value: 3 } }));

vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/companyUserDetail': { roleType: roleType.value } } }) }));

import DesktopAppCard from '@/views/Settings/TimeTracking/DesktopAppCard.vue';
import { buildTrackerConnectLink } from '@/utils/trackerDeepLink';
import en from '@/locales/en';

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
const FEED = 'https://downloads.alianhub.com/tracker/stable';
const originalLocation = window.location;

const release = {
    channel: 'stable',
    version: '6.0.2',
    downloads: [
        { os: 'windows', kind: 'exe', version: '6.0.2', url: `${FEED}/AlianHub-Tracker-Setup-6.0.2.exe` },
        { os: 'mac', kind: 'dmg', version: '6.0.2', url: `${FEED}/AlianHub-Tracker-6.0.2-universal.dmg` },
        { os: 'linux', kind: 'AppImage', version: '6.0.2', url: `${FEED}/AlianHub-Tracker-6.0.2-x86_64.AppImage` },
        { os: 'linux', kind: 'deb', version: '6.0.2', url: `${FEED}/AlianHub-Tracker-6.0.2-amd64.deb` },
    ],
};
const info = (over = {}) => ({
    enabled: true,
    managed: true,
    portalUrl: null,
    seats: { used: 8, limit: 20 },
    release,
    screenshots: { bytes: Math.round(2.1 * 1024 * 1024 * 1024), retention: { enabled: true, maxAgeMonths: 3 } },
    ...over,
});

const mountCard = (props, slots = {}) => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
    return mount(DesktopAppCard, { props, slots, global: { plugins: [i18n], mocks: { $t: i18n.global.t } } });
};
const text = (wrapper, test) => wrapper.find(`[data-test="${test}"]`).text();

describe('DesktopAppCard', () => {
    beforeEach(() => {
        roleType.value = 3;
        vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(WINDOWS_UA);
        vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    it('offers the download for this computer first, with its version and the seats in use', () => {
        const wrapper = mountCard({ info: info() });
        expect(text(wrapper, 'desktop-app-seats')).toBe('8 of 20 users');
        const primary = wrapper.find('[data-test="desktop-app-primary"]');
        expect(primary.text()).toBe('Download for Windows');
        expect(primary.attributes('href')).toBe(`${FEED}/AlianHub-Tracker-Setup-6.0.2.exe`);
        expect(wrapper.text()).toContain('v6.0.2');
        expect(text(wrapper, 'desktop-app-others')).toBe('macOS · Linux (AppImage) · Linux (deb)');
    });

    it('puts the Mac download first on a Mac', () => {
        vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(MAC_UA);
        vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
        const wrapper = mountCard({ info: info() });
        expect(wrapper.find('[data-test="desktop-app-primary"]').text()).toBe('Download for macOS');
        expect(text(wrapper, 'desktop-app-others')).toBe('Windows · Linux (AppImage) · Linux (deb)');
    });

    it('shows screenshot storage and how long screenshots are kept', () => {
        expect(text(mountCard({ info: info() }), 'desktop-app-screenshots')).toBe('Screenshots: 2.1 GB · kept 3 months');
        const pending = info({ screenshots: { bytes: null, retention: { enabled: false, maxAgeMonths: 3 } } });
        expect(text(mountCard({ info: pending }), 'desktop-app-screenshots')).toBe('Screenshots: counted overnight · kept until deleted');
        const small = info({ screenshots: { bytes: 5 * 1024 * 1024, retention: { enabled: true, maxAgeMonths: 1 } } });
        expect(text(mountCard({ info: small }), 'desktop-app-screenshots')).toBe('Screenshots: 5 MB · kept 1 month');
    });

    it('counts tracked users without a limit', () => {
        expect(text(mountCard({ info: info({ seats: { used: 1, limit: null } }) }), 'desktop-app-seats')).toBe('1 tracked user');
    });

    it('falls back to the downloads this server hosts when the update feed has none', () => {
        const wrapper = mountCard({ info: info({ release: null }) }, { fallback: '<p data-test="own-builds">builds</p>' });
        expect(wrapper.find('[data-test="desktop-app-primary"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="own-builds"]').exists()).toBe(true);
    });

    it('opens the tracker on this workspace, and says what to do when nothing happened', () => {
        vi.useFakeTimers();
        const location = { origin: 'https://acme.alianhub.com', href: 'https://acme.alianhub.com/#/settings' };
        Object.defineProperty(window, 'location', { configurable: true, value: location });
        const wrapper = mountCard({ info: info() });
        return wrapper.find('[data-test="desktop-app-open"]').trigger('click').then(async () => {
            expect(location.href).toBe(buildTrackerConnectLink('https://acme.alianhub.com'));
            expect(location.href).toBe('alianhub-tracker://connect?url=https%3A%2F%2Facme.alianhub.com');
            vi.advanceTimersByTime(1500);
            await wrapper.vm.$nextTick();
            expect(text(wrapper, 'desktop-app-open-hint')).toBe('Nothing happened? Install the tracker first, then try again.');
        });
    });

    describe('when the plan has no time tracker', () => {
        const off = info({ enabled: false, release: null, portalUrl: 'https://portal.example.test' });

        it('sends an owner or admin to the portal to add it', () => {
            roleType.value = 1;
            const wrapper = mountCard({ info: off });
            const link = wrapper.find('[data-test="desktop-app-off"] a');
            expect(link.text()).toBe('Add the time tracker');
            expect(link.attributes('href')).toBe('https://portal.example.test');
            expect(wrapper.find('[data-test="desktop-app-seats"]').exists()).toBe(false);
            expect(wrapper.find('[data-test="desktop-app-open"]').exists()).toBe(false);
        });

        it('asks anyone else to ask their admin', () => {
            const wrapper = mountCard({ info: off });
            const lines = wrapper.findAll('[data-test="desktop-app-off"] p').map((p) => p.text());
            expect(lines).toEqual(["Time tracking isn't part of this workspace's plan.", 'Ask your admin to add the time tracker.']);
            expect(wrapper.find('[data-test="desktop-app-off"] a').exists()).toBe(false);
        });

        it('tells a self-hosted admin to add it to the plan', () => {
            roleType.value = 2;
            const wrapper = mountCard({ info: { ...off, portalUrl: null } });
            expect(text(wrapper, 'desktop-app-off')).toContain("Add the time tracker to this workspace's plan to use it.");
        });
    });
});
