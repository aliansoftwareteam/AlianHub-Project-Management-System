import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const COMPANY_ID = '6f0000000000000000000c01';
const INVITE_ID = '6f00000000000000000a0001';
const TOKEN = 'f00d'.repeat(16);

vi.mock('@/services', () => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    apiRequestWithoutSecure: vi.fn(),
    getAuth: vi.fn(),
    useAuth: () => ({ logOut: vi.fn() }),
}));
vi.mock('vue-router', () => ({
    useRoute: () => ({ query: { companyId: `${COMPANY_ID}-${INVITE_ID}`, token: TOKEN }, fullPath: '/invitation' }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/config/publicConfig', () => ({
    enabledProviders: () => ['google', 'github', 'gitlab'],
    publicConfig: { auth: { google: {}, github: {}, gitlab: {} } },
}));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ debouncerWithPromise: () => Promise.resolve() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', async () => {
    const { h } = await import('vue');
    return { default: { name: 'AuthShell', setup: (props, { slots }) => () => h('div', slots.default && slots.default()) } };
});

const { providerStub } = vi.hoisted(() => ({
    providerStub: (name) => ({ default: { name, props: ['mode', 'companyID', 'companyUserDocID', 'linkId'], render: () => null } }),
}));
vi.mock('@/plugins/oauth/google/GoogleAuth.vue', () => providerStub('GoogleAuth'));
vi.mock('@/plugins/oauth/github/GithubAuth.vue', () => providerStub('GithubAuth'));
vi.mock('@/plugins/oauth/gitlab/GitlabAuth.vue', () => providerStub('GitlabAuth'));

import Invitation from '@/views/Authentication/Invitation/Invitation.vue';

describe('provider buttons on the invitation page', () => {
    it('hand every provider the invitation link along with its company and row', async () => {
        const $axios = { post: vi.fn(async () => ({ data: { status: true, data: { status: 1, email: 'invitee@example.test', workspaceName: 'Acme' } } })) };
        const wrapper = mount(Invitation, { global: { provide: { $axios, addSubscription: vi.fn() }, mocks: { $t: (key) => key } } });
        await flushPromises();

        const started = ['GoogleAuth', 'GithubAuth', 'GitlabAuth'].map((name) => [name, wrapper.findComponent({ name }).props()]);

        expect(started).toEqual(['GoogleAuth', 'GithubAuth', 'GitlabAuth'].map((name) => [name, {
            mode: 'register', companyID: COMPANY_ID, companyUserDocID: INVITE_ID, linkId: TOKEN,
        }]));
    });
});
