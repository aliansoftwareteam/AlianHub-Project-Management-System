import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fs from 'fs';
import path from 'path';

const { apiRequest, apiRequestWithoutCompnay, push, getToken } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    push: vi.fn(() => Promise.resolve()),
    getToken: vi.fn()
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push, hasRoute: () => true }), useRoute: () => ({ fullPath: '/', meta: {}, name: 'Home', params: {}, query: {} }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ _id: 'user-1', tourStatus: {}, homeChecklist: {} }) }) }));
vi.mock('firebase/messaging', () => ({ getMessaging: () => ({}), getToken }));
vi.mock('@/config/firebaseInit', () => ({ default: { name: '[DEFAULT]' }, firebaseConfigured: true }));
vi.mock('@/composable/firstRunProgress', () => ({ markFirstRunStep: vi.fn(), isFirstRunStepDone: () => false, FIRST_RUN_STEPS: { BOARD_VIEW: 'board_view', NOTIFICATIONS: 'notifications' } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => ({ default: { name: 'SpinnerComp', render: () => null } }));

import { useOnboardingChecklist } from '@/composable/useOnboardingChecklist';
import Notifications from '@/views/Settings/Notifications/Notifications.vue';
import { UPDATE_SESSION } from '@/config/env';

const browserAnswers = (permission, answer = 'granted') => {
    const requestPermission = vi.fn(() => Promise.resolve(answer));
    vi.stubGlobal('Notification', { permission, requestPermission });
    return requestPermission;
};

const store = () => createStore({
    modules: {
        projectData: { namespaced: true, getters: { projects: () => ({ data: [] }) } },
        settings: {
            namespaced: true,
            getters: {
                companyUsers: () => [{ userId: 'user-1' }],
                companyUserDetail: () => ({ roleType: 3 }),
                notificationSettings: () => ({ _id: 'rules-1' })
            }
        },
        users: { namespaced: true, getters: { users: () => [] } }
    }
});

const checklist = () => {
    let api;
    const Host = defineComponent({ setup() { api = useOnboardingChecklist(); return () => h('div'); } });
    mount(Host, { global: { plugins: [store()] } });
    return api;
};

beforeEach(() => {
    apiRequest.mockResolvedValue({ data: { status: true, data: {} } });
    apiRequestWithoutCompnay.mockResolvedValue({ status: 200, data: { _id: 'user-1' } });
    getToken.mockResolvedValue('push-token');
    localStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('signing in does not ask about browser notifications', () => {
    it('has no question or pre-prompt on the app shell', () => {
        const app = fs.readFileSync(path.join(__dirname, '../../src/App.vue'), 'utf8');
        expect(app).not.toMatch(/Notification\.requestPermission/);
        expect(app).not.toMatch(/Home\.Notification_Request/);
    });
});

describe('the "Set your notifications" step asks', () => {
    it('asks the browser when the question is still open, then opens the notification settings', () => {
        const requestPermission = browserAnswers('default');
        checklist().onAction('notifications');
        expect(requestPermission).toHaveBeenCalledTimes(1);
        expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: 'Notifications' }));
    });

    it('saves the push token for this user after a yes', async () => {
        browserAnswers('default', 'granted');
        checklist().onAction('notifications');
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', UPDATE_SESSION, { userId: 'user-1', updateObject: { webToken: 'push-token' } });
    });

    it.each(['granted', 'denied'])('keeps an answer already given (%s) and asks nothing', (permission) => {
        const requestPermission = browserAnswers(permission);
        checklist().onAction('notifications');
        expect(requestPermission).not.toHaveBeenCalled();
        expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: 'Notifications' }));
    });
});

describe('the notification settings screen', () => {
    const open = async () => {
        const wrapper = mount(Notifications, { global: { plugins: [store()] } });
        await flushPromises();
        return wrapper;
    };

    it('offers to turn browser notifications on while the question is open, and asks on click', async () => {
        const requestPermission = browserAnswers('default');
        const wrapper = await open();
        expect(requestPermission).not.toHaveBeenCalled();
        await wrapper.find('[data-test="browser-alerts-ask"]').trigger('click');
        expect(requestPermission).toHaveBeenCalledTimes(1);
        await flushPromises();
        expect(wrapper.find('[data-test="browser-alerts-ask"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="browser-alerts"]').text()).toContain('Settings.browser_alerts_on');
    });

    it('says how to undo a block instead of asking again', async () => {
        const requestPermission = browserAnswers('denied');
        const wrapper = await open();
        expect(wrapper.find('[data-test="browser-alerts-ask"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="browser-alerts"]').text()).toContain('Settings.browser_alerts_blocked');
        expect(requestPermission).not.toHaveBeenCalled();
    });
});
