import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: toastError, success: vi.fn() }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }));
vi.mock('@/services', () => ({ apiRequestWithoutSecure: vi.fn(), apiRequestWithoutCompnay: vi.fn(), getAuth: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import GoogleAuth from '@/plugins/oauth/google/GoogleAuth.vue';

const mountButton = () => mount(GoogleAuth, { global: { mocks: { $t: (key) => key } } });

describe('Google sign-in button', () => {
    beforeEach(() => {
        toastError.mockReset();
        delete window.google;
    });
    afterEach(() => { delete window.google; });

    it('says so when the Google script never loaded, instead of doing nothing', async () => {
        const wrapper = mountButton();
        await wrapper.find('button').trigger('click');
        expect(toastError).toHaveBeenCalledWith('Auth.google_unavailable', expect.anything());
    });

    it('still works when the script arrives after the button mounted', async () => {
        const wrapper = mountButton();
        const requestCode = vi.fn();
        window.google = { accounts: { oauth2: { initCodeClient: vi.fn(() => ({ requestCode })) } } };
        await wrapper.find('button').trigger('click');
        expect(requestCode).toHaveBeenCalledTimes(1);
        expect(toastError).not.toHaveBeenCalled();
    });
});
