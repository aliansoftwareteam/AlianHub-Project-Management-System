import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ params: { cid: 'c1' } }) }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => null }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import ProjectActionsBar from '@/views/Projects/components/ProjectActionsBar.vue';

const DropDown = { name: 'DropDown', template: '<div><slot name="button" :triggerAttrs="{}" /><slot name="options" /></div>' };
const DropDownOption = { name: 'DropDownOption', emits: ['click'], template: '<div class="dd-option" @click="$emit(\'click\')"><slot /></div>' };

const mountBar = (roleType, clientWidth = 1280) => mount(ProjectActionsBar, {
    props: { projectData: { _id: 'p1', ProjectName: 'Web', watchers: {} }, clientWidth },
    global: {
        plugins: [createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } } })],
        stubs: { DropDown, DropDownOption, Assignee: true, WasabiImage: true },
    },
});

const EXPECTED = { name: 'Automations', params: { cid: 'c1' }, query: { templates: '1', project: 'p1' } };

describe('the Automate button in the project actions bar', () => {
    beforeEach(() => { push.mockReset(); });

    it.each([[1, 'owner'], [2, 'admin']])('opens the template gallery scoped to the project for a roleType %i (%s)', async (roleType) => {
        const wrapper = mountBar(roleType);
        await wrapper.find('[data-test="project-automate"]').trigger('click');
        expect(push).toHaveBeenCalledWith(EXPECTED);
    });

    it.each([[3, 'member'], [0, 'guest']])('is not offered to a roleType %i (%s), who cannot manage automations', (roleType) => {
        expect(mountBar(roleType).find('[data-test="project-automate"]').exists()).toBe(false);
        expect(mountBar(roleType, 390).find('[data-test="project-automate-menu"]').exists()).toBe(false);
    });

    it('moves into the project menu on a phone', async () => {
        const wrapper = mountBar(1, 390);
        expect(wrapper.find('[data-test="project-automate"]').exists()).toBe(false);
        await wrapper.find('[data-test="project-automate-menu"]').trigger('click');
        expect(push).toHaveBeenCalledWith(EXPECTED);
    });
});

describe('the project actions bar on a desktop', () => {
    it('draws Automate, files, audio, watchers and more as the same small bordered button', () => {
        const wrapper = mountBar(1);
        const buttons = wrapper.findAll('button');
        expect(buttons).toHaveLength(5);
        buttons.forEach((button) => expect(button.classes()).toEqual(expect.arrayContaining(['ah-btn', 'ah-btn--secondary', 'ah-btn--sm'])));
        expect(wrapper.find('img').exists()).toBe(false);
    });

    it('shows the watcher count inside the watchers button', () => {
        const wrapper = mount(ProjectActionsBar, {
            props: { projectData: { _id: 'p1', ProjectName: 'Web', watchers: { u1: true, u2: true } }, clientWidth: 1280 },
            global: {
                plugins: [createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 3 }) } } } })],
                stubs: { DropDown, DropDownOption, Assignee: true, WasabiImage: true },
            },
        });
        expect(wrapper.find('[data-test="project-watchers"] .ph2__count').text()).toBe('2');
    });
});
