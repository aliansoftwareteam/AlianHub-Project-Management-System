import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutSecure, getAuth, replace, readSetupStatus } = vi.hoisted(() => ({
    apiRequestWithoutSecure: vi.fn(),
    getAuth: vi.fn(),
    replace: vi.fn(),
    readSetupStatus: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequestWithoutSecure, getAuth }));
vi.mock('@/router/setupStatus', () => ({ readSetupStatus, markInstalled: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import SetupWizard from '@/views/Setup/SetupWizard.vue';
import { SETUP_COMPLETE } from '@/config/env';
import { connectAiWelcomePath } from '@/router/ai/connect';

class FakeEventSource {
    close() {}
}

let assign;
let reload;

const finishSetup = async () => {
    const wrapper = mount(SetupWizard, { global: { mocks: { $t: (key) => key } } });
    await flushPromises();
    await wrapper.find('#firstName').setValue('Olivia');
    await wrapper.find('#lastName').setValue('Owner');
    await wrapper.find('#email').setValue('olivia@example.test');
    await wrapper.find('#password').setValue('Setup-Passw0rd!');
    await wrapper.find('#companyName').setValue('Acme Studio');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('EventSource', FakeEventSource);
    assign = vi.fn();
    reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, origin: 'http://app.test', assign, reload });
    replace.mockReset();
    getAuth.mockReset();
    readSetupStatus.mockReset();
    readSetupStatus.mockResolvedValue({ installed: false, dbOk: true });
    apiRequestWithoutSecure.mockReset();
    apiRequestWithoutSecure.mockImplementation(async (method, url) => {
        if (method === 'post' && url === SETUP_COMPLETE) return { data: { status: true, data: { userId: 'user-1', companyId: 'c1', session: true } } };
        throw new Error(`unexpected ${method} ${url}`);
    });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('the setup wizard, once the first workspace is made', () => {
    it('gets a session that names the workspace before it opens it, so the first screen is not refused and retried', async () => {
        let sessionReady;
        getAuth.mockImplementation(() => new Promise((resolve) => { sessionReady = resolve; }));
        await finishSetup();

        expect(getAuth).toHaveBeenCalledWith('user-1', true);
        expect(assign).not.toHaveBeenCalled();

        sessionReady({ status: true });
        await flushPromises();
        expect(assign).toHaveBeenCalledWith(`http://app.test/#${connectAiWelcomePath('c1')}`);
        expect(localStorage.getItem('selectedCompany')).toBe('c1');
    });

    it('goes to the sign-in page instead of opening the workspace on a session it could not get', async () => {
        getAuth.mockRejectedValue({ status: false });
        await finishSetup();

        expect(assign).not.toHaveBeenCalled();
        expect(replace).toHaveBeenCalledWith({ name: 'Log-in' });
    });
});
