/* UIX-20 — without Firebase keys every load logged "No Firebase App '[DEFAULT]' has been created". */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';

const { apiRequestWithoutCompnay, initializeApp, getMessaging, getToken, firebaseApp } = vi.hoisted(() => ({
    apiRequestWithoutCompnay: vi.fn(),
    initializeApp: vi.fn(),
    getMessaging: vi.fn(),
    getToken: vi.fn(),
    firebaseApp: { name: '[DEFAULT]' }
}));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('firebase/app', () => ({ initializeApp }));
vi.mock('firebase/messaging', () => ({ getMessaging, getToken }));

const pushKeys = { apiKey: 'key', projectId: 'alianhub', messagingSenderId: '1', appId: 'app' };

const loadWithConfig = async (config) => {
    vi.resetModules();
    vi.doMock('@/config/firebaseConfig', () => ({ default: config }));
    await import('@/config/firebaseInit');
    return import('@/composable/browserNotifications');
};

let consoleError;

beforeEach(() => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn(() => Promise.resolve('granted')) });
    initializeApp.mockReturnValue(firebaseApp);
    getMessaging.mockImplementation((app) => {
        if (app !== firebaseApp) throw new Error("Firebase: No Firebase App '[DEFAULT]' has been created (app/no-app).");
        return {};
    });
    getToken.mockResolvedValue('push-token');
    apiRequestWithoutCompnay.mockResolvedValue({ status: 200, data: { _id: 'user-1' } });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/config/firebaseConfig');
    consoleError.mockRestore();
});

describe('push is not configured', () => {
    it.each([
        ['no keys', {}],
        ['the placeholder key', { ...pushKeys, apiKey: 'placeholder' }]
    ])('with %s, loading and refreshing the token never touches messaging or logs', async (_label, config) => {
        const { refreshWebPush } = await loadWithConfig(config);
        expect(() => refreshWebPush('user-1')).not.toThrow();
        await flushPromises();
        expect(initializeApp).not.toHaveBeenCalled();
        expect(getMessaging).not.toHaveBeenCalled();
        expect(getToken).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
    });

    it('answering the browser question still resolves quietly', async () => {
        vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('granted')) });
        const { askForBrowserNotifications } = await loadWithConfig({});
        await expect(askForBrowserNotifications('user-1')).resolves.toBeUndefined();
        expect(getMessaging).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
    });
});

describe('push is configured', () => {
    it('gets the token from the initialised app and saves it', async () => {
        const { refreshWebPush } = await loadWithConfig(pushKeys);
        refreshWebPush('user-1');
        await flushPromises();
        expect(initializeApp).toHaveBeenCalledWith(pushKeys);
        expect(getMessaging).toHaveBeenCalledWith(firebaseApp);
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', expect.any(String), { userId: 'user-1', updateObject: { webToken: 'push-token' } });
        expect(localStorage.getItem('webTokens')).toBe('push-token');
        expect(consoleError).not.toHaveBeenCalled();
    });
});
