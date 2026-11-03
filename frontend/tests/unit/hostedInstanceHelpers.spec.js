import { describe, expect, it, vi } from 'vitest';
import { bootedAfter, restartAndWait } from '@/views/Settings/Instance/restartInstance';
import { sourceCodeUrl } from '@/composable/sourceCode';
import { upgradeTarget } from '@/composable/upgradeLink';
import { publicConfig } from '@/config/publicConfig';
import { REPO_URL, INSTANCE_RESTART } from '@/config/env';

describe('waiting for a restart', () => {
    it('counts a healthy answer only from a process that started after the click', () => {
        expect(bootedAfter({ status: 'ok', uptimeSeconds: 3600 }, 1000, 11000)).toBe(false);
        expect(bootedAfter({ status: 'ok', uptimeSeconds: 4 }, 1000, 11000)).toBe(true);
        expect(bootedAfter({ status: 'degraded', uptimeSeconds: 4 }, 1000, 11000)).toBe(false);
        expect(bootedAfter(null, 1000, 11000)).toBe(false);
    });

    it('asks for the restart, then polls until the new process answers', async () => {
        let clock = 0;
        const post = vi.fn(async () => ({}));
        const answers = [null, { status: 'ok', uptimeSeconds: 900 }, { status: 'ok', uptimeSeconds: 1 }];
        const fetchHealth = vi.fn(async () => answers.shift());
        const wait = async (ms) => { clock += ms; };
        await expect(restartAndWait({ post, companyId: 'c1', fetchHealth, wait, now: () => clock, intervalMs: 2000 })).resolves.toBe(true);
        expect(post).toHaveBeenCalledWith(INSTANCE_RESTART, { companyId: 'c1' });
        expect(fetchHealth).toHaveBeenCalledTimes(3);
    });

    it('gives up after the timeout', async () => {
        let clock = 0;
        const wait = async (ms) => { clock += ms; };
        const stale = async () => ({ status: 'ok', uptimeSeconds: 9999 });
        await expect(restartAndWait({ post: async () => ({}), fetchHealth: stale, wait, now: () => clock, timeoutMs: 10000 })).rejects.toThrow('restart_timeout');
    });
});

describe('the source code link', () => {
    it('names the release tag of a release build', () => {
        expect(sourceCodeUrl({ version: '14.40.0', release: '14.40.0', commit: 'abc1234' })).toBe(`${REPO_URL}/tree/v14.40.0`);
    });

    it('names the commit of a build between releases', () => {
        expect(sourceCodeUrl({ version: '14.41.0-beta.3', release: '14.40.0', commit: 'abc1234' })).toBe(`${REPO_URL}/tree/abc1234`);
    });

    it('falls back to the tag of the bundled version when the server says nothing more', () => {
        expect(sourceCodeUrl({ version: '14.40.0' })).toBe(`${REPO_URL}/tree/v14.40.0`);
    });
});

describe('where Upgrade goes', () => {
    const router = (routes) => ({ hasRoute: (name) => routes.includes(name) });

    it('keeps the in-app Upgrade page on a self-hosted instance', () => {
        publicConfig.hosting = { mode: 'self', portalUrl: '' };
        expect(upgradeTarget(router([]), 'c1')).toEqual({ name: 'Upgrade', params: { cid: 'c1' } });
    });

    it('goes to Plan & usage on a hosted instance, or nowhere in-app when this build has no such page', () => {
        publicConfig.hosting = { mode: 'managed', portalUrl: 'https://account.alianhub.com' };
        expect(upgradeTarget(router(['PlanUsage']), 'c1')).toEqual({ name: 'PlanUsage', params: { cid: 'c1' } });
        expect(upgradeTarget(router([]), 'c1')).toBeNull();
        publicConfig.hosting = { mode: 'self', portalUrl: '' };
    });
});
