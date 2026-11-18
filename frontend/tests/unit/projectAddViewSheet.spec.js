import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => 'u1' }),
}));

import ProjectBottomModals from '@/views/Projects/components/ProjectBottomModals.vue';

const ViewsDropdown = { name: 'ViewsDropdown', emits: ['handleCloseDropdown'], template: '<button class="views-stub" @click="$emit(\'handleCloseDropdown\')">close</button>' };

let wrapper;
const settle = async () => {
    vi.advanceTimersByTime(150);
    await flushPromises();
};
const sheet = () => document.querySelector('#my-dropdown .viewlist-mobile-dropdown-new');

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('the mobile "+ Add view" in the project view switcher', () => {
    const mountModals = async () => {
        wrapper = mount(ProjectBottomModals, {
            props: { clientWidth: 390, projectData: { _id: 'p1' } },
            global: {
                mocks: { $t: (key) => key },
                stubs: {
                    ViewsDropdown, ProjectWatcher: true, ConfirmationSidebar: true, CreateProjectSidebar: true,
                    AiProjectCreator: true, ProjectPermission: true, ConfirmModal: true, AISidebar: true,
                },
            },
            attachTo: '#app',
        });
        await flushPromises();
        return wrapper;
    };

    it('opens the All views sheet through the bottom modals, and a pick closes it again', async () => {
        await mountModals();
        expect(sheet()).toBeNull();

        expect(() => wrapper.vm.openAllViews()).not.toThrow();
        await settle();
        expect(sheet()).not.toBeNull();

        document.querySelector('#my-dropdown .views-stub').click();
        await settle();
        expect(sheet()).toBeNull();
    });

    it('is wired from Projects.vue through a ref on ProjectBottomModals, not a ref the page does not own', () => {
        const page = readFileSync(resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');
        expect(page).not.toMatch(/\$refs\.all_views_dd/);
        const refName = page.match(/<ProjectBottomModals\s[^>]*?\bref="([^"]+)"/)?.[1];
        expect(refName).toBeTruthy();
        expect(page).toContain(`$refs.${refName}.openAllViews()`);
    });
});
