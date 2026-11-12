import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const COMPANY = '6f0000000000000000000c02';
const DEEP_LINK = `/${COMPANY}/project/p1/list`;

const mocks = vi.hoisted(() => ({ apiRequestWithoutSecure: vi.fn(), route: { query: {} } }));

vi.mock('@/services', () => ({ apiRequestWithoutSecure: mocks.apiRequestWithoutSecure }));
vi.mock('vue-router', () => ({ useRoute: () => mocks.route }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot /></div>' } }));

import * as env from '@/config/env';
import SsoLogin from '@/views/Authentication/Sso/SsoLogin.vue';

const RouterLinkStub = { name: 'RouterLink', props: ['to'], template: '<a class="router-link"><slot /></a>' };

const mountSso = (query) => {
    mocks.route.query = query;
    return mount(SsoLogin, { global: { stubs: { 'router-link': RouterLinkStub } } });
};

const continueToIdp = async (wrapper) => {
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return new URL(wrapper.find('a.ah-btn--primary').attributes('href'), 'https://app.example.test');
};

describe('the single sign-on page', () => {
    beforeEach(() => {
        mocks.apiRequestWithoutSecure.mockReset();
        mocks.apiRequestWithoutSecure.mockResolvedValue({ data: { status: true, data: { companyId: COMPANY, companyName: 'Acme', provider: 'oidc' } } });
    });

    it('sends the identity provider the address typed on the login page and the page to return to', async () => {
        const wrapper = mountSso({ email: 'max@acme.test', redirect_url: DEEP_LINK });

        expect(wrapper.find('#sso-email').element.value).toBe('max@acme.test');
        const initiate = await continueToIdp(wrapper);

        expect(mocks.apiRequestWithoutSecure).toHaveBeenCalledWith('get', `${env.SSO_DISCOVER}?email=${encodeURIComponent('max@acme.test')}`);
        expect(initiate.pathname).toBe('/api/v2/sso/oidc/initiate');
        expect(Object.fromEntries(initiate.searchParams)).toEqual({ companyId: COMPANY, login_hint: 'max@acme.test', redirect_url: DEEP_LINK });
    });

    it('starts SAML the same way', async () => {
        mocks.apiRequestWithoutSecure.mockResolvedValue({ data: { status: true, data: { companyId: COMPANY, companyName: 'Acme', provider: 'saml' } } });
        const initiate = await continueToIdp(mountSso({ email: 'max@acme.test', redirect_url: DEEP_LINK }));

        expect(initiate.pathname).toBe('/api/v2/sso/saml/initiate');
        expect(initiate.searchParams.get('redirect_url')).toBe(DEEP_LINK);
    });

    it('keeps the page to return to on the way back to the other sign-in options', () => {
        const wrapper = mountSso({ redirect_url: DEEP_LINK });

        expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ name: 'Log-in', query: { redirect_url: DEEP_LINK } });
    });

    it('goes back to the plain sign-in page when there is nothing to return to', () => {
        const wrapper = mountSso({});

        expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ name: 'Log-in', query: {} });
    });
});
