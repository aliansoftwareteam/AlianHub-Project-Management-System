import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() } }));
vi.mock('@/services', () => api);
vi.mock('@/config/env', () => ({
    STORAGE_TYPE: 'server',
    GET_SIGNED_OR_PUBLIC_URL: '/api/v1/generateSignedUrl',
    DOMAIN_URI: 'http://localhost',
    WASABI_RETRIVE_USER_PROFILE: '/api/v1/wasabi/retriveUserProfile'
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AvatarImage from '@/components/atom/AvatarImage/AvatarImage.vue';
import ListAssigneeCell from '@/views/Projects/ListView/ListAssigneeCell.vue';
import { clearSignedProfileUrls } from '@/composable/useSignedProfileUrl';

const STORED = '6a8e1f_52097645091_profile.png';
const SIGNED = '/api/v1/download/USER_PROFILES/6a8e1f_52097645091_profile.png?token=abc';
const provide = { $companyId: ref('c1') };

const srcs = (wrapper) => wrapper.findAll('img').map((img) => img.attributes('src'));

let resolveSigned;
beforeEach(() => {
    clearSignedProfileUrls();
    api.apiRequest.mockImplementation(() => new Promise((resolve) => { resolveSigned = () => resolve({ data: { url: SIGNED } }); }));
});
afterEach(() => vi.clearAllMocks());

describe('AvatarImage', () => {
    const mountAvatar = (src) => mount(AvatarImage, { props: { src, alt: 'Olivia' }, slots: { default: 'O' }, global: { provide } });

    it('puts no bare stored path in src while the signed URL is pending, and shows the fallback', async () => {
        const wrapper = mountAvatar(STORED);
        await flushPromises();

        expect(srcs(wrapper)).not.toContain(STORED);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).toBe('O');
        expect(api.apiRequest).toHaveBeenCalledTimes(1);
        expect(api.apiRequest.mock.calls[0][1]).toContain('/api/v1/generateSignedUrl/USER_PROFILES?filepath=' + STORED);
    });

    it('uses the signed URL once it arrives', async () => {
        const wrapper = mountAvatar(STORED);
        await flushPromises();
        resolveSigned();
        await flushPromises();

        expect(srcs(wrapper)).toEqual([SIGNED]);
        expect(wrapper.text()).toBe('');
    });

    it('asks once for the same picture however many rows show it', async () => {
        mountAvatar(STORED);
        mountAvatar(STORED);
        mountAvatar(STORED);
        await flushPromises();

        expect(api.apiRequest).toHaveBeenCalledTimes(1);
    });

    it('keeps the fallback when the signed URL cannot be fetched', async () => {
        api.apiRequest.mockImplementation(() => Promise.reject(new Error('404')));
        const wrapper = mountAvatar(STORED);
        await flushPromises();

        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).toBe('O');
    });

    it.each([
        ['a data image', 'data:image/png;base64,AAAA'],
        ['a web address', 'https://example.test/me.png'],
        ['a bundled image', 'img/default-user.1a2b3c.png']
    ])('uses %s as is without asking', async (_label, value) => {
        const wrapper = mountAvatar(value);
        await flushPromises();

        expect(srcs(wrapper)).toEqual([value]);
        expect(api.apiRequest).not.toHaveBeenCalled();
    });
});

describe('the assignee cell in the List view', () => {
    const store = createStore({
        getters: {
            'settings/companyUsers': () => [{ userId: 'u1', isDelete: false }],
            'users/users': () => [{ _id: 'u1', Employee_Name: 'Olivia Owner', Employee_profileImageURL: STORED }],
            'settings/teams': () => [],
            'settings/companyOwnerDetail': () => ({ userId: 'u1' })
        }
    });

    it('requests no bare stored path from the site root', async () => {
        const wrapper = mount(ListAssigneeCell, {
            props: { task: { _id: 't1', AssigneeUserId: ['u1'] }, editable: false },
            global: { plugins: [store], provide: { ...provide, $defaultUserAvatar: ref(''), $defaultGhostCustomUserImg: ref('') } }
        });
        await flushPromises();
        expect(srcs(wrapper)).not.toContain(STORED);
        expect(wrapper.text()).toBe('O');

        resolveSigned();
        await flushPromises();
        expect(srcs(wrapper)).toEqual([SIGNED]);
    });
});
