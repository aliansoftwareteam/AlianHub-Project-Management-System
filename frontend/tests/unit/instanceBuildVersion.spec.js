import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceStats from '@/views/Settings/Instance/InstanceStats.vue';
import InstanceUpgrade from '@/views/Settings/Instance/InstanceUpgrade.vue';

const REPO = 'https://github.com/aliansoftwareteam/AlianHub-Project-Management-System';
const ok = (data) => Promise.resolve({ data: { status: true, data } });

const build = {
    version: '14.36.0-beta.59', release: '14.35.0', base: '14.35.0', next: '14.36.0',
    channel: 'beta', build: 59, commit: '1247dbfe', builtAt: '2026-09-11T08:00:00Z', source: 'git', repoUrl: REPO,
};

const logOf = (count) => Array.from({ length: count }, (_, i) => {
    const n = count - i;
    return { build: n, version: `14.36.0-beta.${n}`, date: '2026-09-11', pr: n % 2 ? 500 + n : null, title: `change ${n}`, type: 'feat', commit: `c0ffee${String(n).padStart(2, '0')}` };
});

const upgradeInfo = (extra = {}) => ({
    currentVersion: '14.36.0-beta.59', docker: false, updateAvailable: false, latest: { version: '14.35.0' },
    migrations: { applied: [], pending: [], failed: [], auto: true }, releases: [], upgradeNeedsHands: false,
    ...extra,
});

const mountWith = async (component, payloads) => {
    apiRequestWithoutCompnay.mockImplementation((type, url) => ok(payloads[url.split('/').pop()]));
    const wrapper = mount(component);
    await flushPromises();
    return wrapper;
};

describe('InstanceStats version card', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); });

    it('shows the build label with the commit, the channel and the Node version beneath it', async () => {
        const wrapper = await mountWith(InstanceStats, {
            stats: { version: '14.36.0-beta.59', release: '14.35.0', commit: '1247dbfe', channel: 'beta', build: 59, nodeVersion: 'v20.20.2', uptimeSeconds: 10, companies: 2, users: 5 },
            companies: [],
        });
        expect(wrapper.find('[data-test="version-label"]').text()).toBe('v14.36.0-beta.59');
        expect(wrapper.find('[data-test="version-line"]').text()).toBe('1247dbfe · Instance.channel_beta · v20.20.2');
    });

    it('tolerates an older server that only sends the version and the Node version', async () => {
        const wrapper = await mountWith(InstanceStats, { stats: { version: '14.35.0', nodeVersion: 'v20.20.2', companies: 1, users: 1 }, companies: [] });
        expect(wrapper.find('[data-test="version-label"]').text()).toBe('v14.35.0');
        expect(wrapper.find('[data-test="version-line"]').text()).toBe('v20.20.2');
        expect(wrapper.text()).not.toContain('undefined');
    });
});

describe('InstanceUpgrade builds since the release', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); });

    it('puts the build label on the chip and lists each build with its PR and commit links', async () => {
        const wrapper = await mountWith(InstanceUpgrade, { upgrade: upgradeInfo({ release: '14.35.0', build, buildLog: logOf(3) }) });
        expect(wrapper.find('.ah-chip--mono').text()).toBe('v14.36.0-beta.59');
        expect(wrapper.find('[data-test="builds"] .in-card__title').text()).toBe('Instance.builds_since');
        expect(wrapper.find('[data-test="next-release"]').exists()).toBe(true);

        const rows = wrapper.findAll('[data-test="build-row"]');
        expect(rows).toHaveLength(3);
        expect(rows[0].text()).toContain('14.36.0-beta.3');
        expect(rows[0].text()).toContain('change 3');
        expect(rows[0].text()).toContain('2026-09-11');
        const pr = rows[0].find('[data-test="build-pr"]');
        expect(pr.attributes('href')).toBe(`${REPO}/pull/503`);
        expect(pr.attributes('target')).toBe('_blank');
        expect(pr.attributes('rel')).toBe('noopener');
        expect(rows[0].find('[data-test="build-commit"]').attributes('href')).toBe(`${REPO}/commit/c0ffee03`);
        expect(rows[1].find('[data-test="build-pr"]').exists()).toBe(false);
        expect(rows[1].text()).not.toContain('null');
        expect(wrapper.find('[data-test="builds-toggle"]').exists()).toBe(false);
    });

    it('shows the newest 20 builds until the toggle reveals all of them', async () => {
        const wrapper = await mountWith(InstanceUpgrade, { upgrade: upgradeInfo({ release: '14.35.0', build, buildLog: logOf(59) }) });
        expect(wrapper.findAll('[data-test="build-row"]')).toHaveLength(20);
        expect(wrapper.find('[data-test="build-row"]').text()).toContain('change 59');

        const toggle = wrapper.find('[data-test="builds-toggle"]');
        expect(toggle.text()).toBe('Instance.builds_show_all');
        await toggle.trigger('click');
        expect(wrapper.findAll('[data-test="build-row"]')).toHaveLength(59);
        expect(toggle.text()).toBe('Instance.builds_show_fewer');
        await toggle.trigger('click');
        expect(wrapper.findAll('[data-test="build-row"]')).toHaveLength(20);
    });

    it('hides the card when the server sends no build log', async () => {
        const old = await mountWith(InstanceUpgrade, { upgrade: upgradeInfo({ currentVersion: '14.35.0' }) });
        expect(old.find('[data-test="builds"]').exists()).toBe(false);
        expect(old.find('.ah-chip--mono').text()).toBe('v14.35.0');

        const empty = await mountWith(InstanceUpgrade, { upgrade: upgradeInfo({ release: '14.35.0', build, buildLog: [] }) });
        expect(empty.find('[data-test="builds"]').exists()).toBe(false);
    });
});
