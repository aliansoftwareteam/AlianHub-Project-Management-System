import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { version as packageVersion } from '../../../package.json';

const { apiRequestWithoutSecure } = vi.hoisted(() => ({ apiRequestWithoutSecure: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutSecure }));

const load = () => import('@/composable/useAppVersion');

describe('useAppVersion', () => {
    beforeEach(() => {
        vi.resetModules();
        apiRequestWithoutSecure.mockReset();
    });

    it('asks the server once per page load and exposes its build label', async () => {
        apiRequestWithoutSecure.mockResolvedValue({ data: { status: true, data: { version: '14.36.0-beta.59', release: '14.35.0', channel: 'beta', build: 59, commit: '1247dbfe' } } });
        const { useAppVersion, fetchAppVersion } = await load();

        const rail = useAppVersion();
        const login = useAppVersion();
        expect(rail.version.value).toBe(packageVersion);
        await flushPromises();

        expect(rail.version.value).toBe('14.36.0-beta.59');
        expect(login.version.value).toBe('14.36.0-beta.59');
        expect((await fetchAppVersion()).commit).toBe('1247dbfe');
        expect(apiRequestWithoutSecure).toHaveBeenCalledTimes(1);
        expect(apiRequestWithoutSecure).toHaveBeenCalledWith('get', '/version');
    });

    it('falls back to the bundled package version when the call fails', async () => {
        apiRequestWithoutSecure.mockRejectedValue(new Error('404'));
        const { useAppVersion } = await load();
        const { version } = useAppVersion();
        await flushPromises();
        expect(version.value).toBe(packageVersion);
    });

    it('falls back when an older server answers without version data', async () => {
        apiRequestWithoutSecure.mockResolvedValue({ data: '<!doctype html><html></html>' });
        const { useAppVersion } = await load();
        const { version } = useAppVersion();
        await flushPromises();
        expect(version.value).toBe(packageVersion);
        expect(String(version.value)).not.toBe('undefined');
    });
});
