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
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
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
const otherNames = (wrapper) => wrapper.findAll('[data-test="desktop-app-other-name"]').map((name) => name.text());

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
        expect(wrapper.find('.desktop-app__primary').text()).toContain('v6.0.2');
        expect(wrapper.find('.desktop-app__primary').text()).toContain('For this computer');
        expect(otherNames(wrapper)).toEqual(['macOS', 'Linux (AppImage)', 'Linux (deb)']);
        const macRow = wrapper.findAll('[data-test="desktop-app-others"] li')[0].find('a');
        expect(macRow.attributes('href')).toBe(`${FEED}/AlianHub-Tracker-6.0.2-universal.dmg`);
        expect(macRow.attributes('aria-label')).toBe('Download for macOS');
    });

    it('puts the Mac download first on a Mac', () => {
        vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(MAC_UA);
        vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
        const wrapper = mountCard({ info: info() });
        expect(wrapper.find('[data-test="desktop-app-primary"]').text()).toBe('Download for macOS');
        expect(otherNames(wrapper)).toEqual(['Windows', 'Linux (AppImage)', 'Linux (deb)']);
    });

    it('does not claim a desktop download is for a phone', () => {
        vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ANDROID_UA);
        vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux armv81');
        const wrapper = mountCard({ info: info() });
        expect(wrapper.find('[data-test="desktop-app-primary"]').text()).toBe('Download for Windows');
        expect(wrapper.find('.desktop-app__primary').text()).not.toContain('For this computer');
    });

    it('shows screenshot storage and how long screenshots are kept', () => {
        const stats = (wrapper) => [text(wrapper, 'desktop-app-storage'), text(wrapper, 'desktop-app-kept')];
        expect(stats(mountCard({ info: info() }))).toEqual(['2.1 GB', '3 months']);
        const pending = info({ screenshots: { bytes: null, retention: { enabled: false, maxAgeMonths: 3 } } });
        expect(stats(mountCard({ info: pending }))).toEqual(['Counted overnight', 'Until deleted']);
        const small = info({ screenshots: { bytes: 5 * 1024 * 1024, retention: { enabled: true, maxAgeMonths: 1 } } });
        expect(stats(mountCard({ info: small }))).toEqual(['5 MB', '1 month']);
        const large = info({ screenshots: { bytes: Math.round(1364.1 * 1024 * 1024 * 1024), retention: { enabled: false } } });
        expect(stats(mountCard({ info: large }))).toEqual(['1.3 TB', 'Until deleted']);
    });

    it('counts no seats when the plan does not limit them', () => {
        expect(text(mountCard({ info: info({ seats: { used: null, limit: null } }) }), 'desktop-app-seats')).toBe('Unlimited users');
    });

    it('falls back to the downloads this server hosts when the update feed has none', () => {
        const localDownloads = [
            { os: 'mac', name: 'Mac', version: '5.0.0', url: '/tracker/mac.dmg', note: '' },
            { os: 'windows', name: 'Windows', version: '5.1.6', url: '/tracker/setup.exe', note: 'Compatible with Windows 8 or newer' },
        ];
        const wrapper = mountCard({ info: info({ release: null }), localDownloads });
        const primary = wrapper.find('[data-test="desktop-app-primary"]');
        expect(primary.text()).toBe('Download for Windows');
        expect(primary.attributes('href')).toBe('/tracker/setup.exe');
        expect(wrapper.find('.desktop-app__primary').text()).toContain('Compatible with Windows 8 or newer');
        expect(otherNames(wrapper)).toEqual(['macOS']);
    });

    it('prefers the update feed over the downloads this server hosts', () => {
        const localDownloads = [{ os: 'windows', name: 'Windows', version: '5.1.6', url: '/tracker/setup.exe', note: '' }];
        const wrapper = mountCard({ info: info(), localDownloads });
        expect(wrapper.find('[data-test="desktop-app-primary"]').attributes('href')).toBe(`${FEED}/AlianHub-Tracker-Setup-6.0.2.exe`);
    });

    it('says when no download is available at all', () => {
        const wrapper = mountCard({ info: info({ release: null }) });
        expect(wrapper.find('[data-test="desktop-app-primary"]').exists()).toBe(false);
        expect(text(wrapper, 'desktop-app-none')).toBe('No desktop tracker download is available on this server yet.');
    });

    it('opens the tracker on a workspace served under a path with that path', () => {
        const location = { origin: 'https://example.com', pathname: '/team/', href: 'https://example.com/team/#/settings' };
        Object.defineProperty(window, 'location', { configurable: true, value: location });
        const wrapper = mountCard({ info: info() });
        return wrapper.find('[data-test="desktop-app-open"]').trigger('click').then(() => {
            expect(location.href).toBe(buildTrackerConnectLink('https://example.com/team'));
        });
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
