import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { h } from 'vue';

const { apiRequest, apiRequestWithoutCompnay, stub } = vi.hoisted(() => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: { status: true } })),
    apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: { status: true } })),
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkBucketStorage: vi.fn(() => Promise.resolve(true)) }),
    useGetterFunctions: () => ({ getUser: () => ({}) })
}));
vi.mock('@/components/molecules/Sidebar/Sidebar.vue', () => ({
    default: { name: 'Sidebar', render() { return h('div', this.$slots.body ? this.$slots.body() : []); } }
}));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => stub('Spinner'));
vi.mock('@/components/atom/Toggle/Toggle.vue', () => stub('Toggle'));
vi.mock('@/components/molecules/Assignee/Assignee.vue', () => stub('Assignee'));

import CreateChannelSidebar from '@/components/organisms/CreateChannelSidebar/CreateChannelSidebar.vue';

function mountSidebar() {
    const store = createStore({
        getters: {
            'settings/teams': () => [],
            'settings/companyUsers': () => [],
            'settings/selectedCompany': () => ({ planFeature: { maxPublicChannels: -1, maxPrivateChannels: -1 } })
        }
    });
    return mount(CreateChannelSidebar, { props: { visible: true }, global: { plugins: [store] } });
}

describe('CreateChannelSidebar', () => {
    it('does not call the API when the channel name is empty', async () => {
        const wrapper = mountSidebar();
        await wrapper.vm.createChannel();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(apiRequest).not.toHaveBeenCalled();
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
        expect(wrapper.vm.channelName.error).not.toBe('');
    });
});
