import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const { getAuth, replace } = vi.hoisted(() => ({ getAuth: vi.fn(), replace: vi.fn() }));

vi.mock('@/services', () => ({ getAuth }));
vi.mock('vue-router', () => ({
    useRoute: () => ({ query: { id: 'aW52aXRl' } }),
    useRouter: () => ({ replace }),
}));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import VerifyInvitation from '@/views/Authentication/VerifyInvitation/VerifyInvitation.vue';

const PAUSE_ON_ACCEPTED = 1200;
let reload;

const openLink = async ({ signedInAs, openCompany = ref('') }) => {
    const $axios = { post: vi.fn(async () => ({ data: { status: true, key: 5, companyId: 'c9' } })) };
    const wrapper = mount(VerifyInvitation, {
        global: {
            mocks: { $t: (key) => key },
            provide: { $axios, $userId: ref(signedInAs), $companyId: openCompany },
            stubs: { 'router-link': { template: '<a><slot /></a>' } },
        },
    });
    await flushPromises();
    return wrapper;
};
const afterThePause = async () => {
    vi.advanceTimersByTime(PAUSE_ON_ACCEPTED);
    await flushPromises();
};

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    replace.mockReset();
    replace.mockResolvedValue();
    getAuth.mockReset();
    getAuth.mockResolvedValue({ status: true });
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the mailed invitation link, once the invitation is accepted', () => {
    it('renews a signed-in person\'s session before it selects and opens the workspace, so the first screen is not refused and retried', async () => {
        let renewed;
        getAuth.mockImplementation(() => new Promise((resolve) => { renewed = resolve; }));
        const wrapper = await openLink({ signedInAs: 'user-1' });
        await afterThePause();

        expect(getAuth).toHaveBeenCalledWith('user-1');
        expect(localStorage.getItem('selectedCompany')).toBeNull();
        expect(replace).not.toHaveBeenCalled();

        renewed({ status: true });
        await flushPromises();
        expect(wrapper.text()).toContain('Auth.invite_accepted_title');
        expect(localStorage.getItem('selectedCompany')).toBe('c9');
        await afterThePause();
        expect(replace).toHaveBeenCalledWith({ name: 'Log-in' });
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('tells the app which workspace is open before it leaves, so a signed-in person with no workspace is not sent to name one', async () => {
        const openCompany = ref('');
        let openWhenLeaving;
        replace.mockImplementation(async () => { openWhenLeaving = openCompany.value; });
        await openLink({ signedInAs: 'user-1', openCompany });
        await afterThePause();

        expect(openWhenLeaving).toBe('c9');
    });

    it('still goes on when the session cannot be renewed here', async () => {
        getAuth.mockRejectedValue({ status: false });
        await openLink({ signedInAs: 'user-1' });
        await afterThePause();

        expect(replace).toHaveBeenCalledWith({ name: 'Log-in' });
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('asks for no session when nobody is signed in: signing in gives a fresh one', async () => {
        const wrapper = await openLink({ signedInAs: '' });
        expect(wrapper.text()).toContain('Auth.invite_accepted_title');
        expect(localStorage.getItem('selectedCompany')).toBe('c9');
        await afterThePause();

        expect(getAuth).not.toHaveBeenCalled();
        expect(replace).toHaveBeenCalledWith({ name: 'Log-in' });
        expect(reload).not.toHaveBeenCalled();
    });
});
