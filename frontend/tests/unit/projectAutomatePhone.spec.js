/* The Automate entry on a phone, through the real project menu and the real permission helper:
   a stubbed menu or a mocked `@/composable` would pass whatever the page does. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { readFileSync } from 'fs';
import path from 'path';
/* The store and the HTTP layer import each other; the layer has to load first. */
import '@/services';
import Store from '@/store/index';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ params: { cid: 'c1' } }) }));

import ProjectActionsBar from '@/views/Projects/components/ProjectActionsBar.vue';

const PROJECT = { _id: 'p1', ProjectName: 'QA Sandbox', ProjectCode: 'QA', watchers: {}, isGlobalPermission: true, AssigneeUserId: [] };
const PHONE = 557;
const SRC = path.resolve(__dirname, '../../src');

const signIn = (roleType) => {
    Store.state.settings.companyUserDetail = { userId: 'u1', roleType };
    Store.state.settings.rules = { project: {}, settings: {}, task: {} };
};

const setViewport = (width) => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => width });
};

let host;
let wrapper;

const openProjectMenu = async (roleType) => {
    signIn(roleType);
    wrapper = mount(ProjectActionsBar, {
        attachTo: document.body,
        props: { projectData: PROJECT, clientWidth: PHONE },
        global: {
            plugins: [Store],
            provide: { $clientWidth: ref(PHONE), selectedProject: ref(PROJECT) },
            stubs: { Assignee: true, WasabiImage: true }
        }
    });
    await wrapper.find('button[aria-haspopup]').trigger('click');
    await flushPromises();
};

describe('the project menu on a phone', () => {
    beforeEach(() => {
        push.mockReset();
        setViewport(PHONE);
        host = document.createElement('div');
        host.id = 'my-dropdown';
        document.body.appendChild(host);
    });

    afterEach(() => {
        wrapper?.unmount();
        host.remove();
        setViewport(1024);
    });

    it('has no Automate button in the header, where there is no room for it', async () => {
        await openProjectMenu(1);
        expect(wrapper.find('[data-test="project-automate"]').exists()).toBe(false);
    });

    it.each([[1, 'owner'], [2, 'admin']])('lists Automate for a roleType %i (%s) and opens the project\'s templates', async (roleType) => {
        await openProjectMenu(roleType);
        const entry = host.querySelector('[data-test="project-automate-menu"]');
        expect(entry).not.toBeNull();
        expect(entry.getAttribute('role')).toBe('menuitem');
        expect(entry.textContent).toContain('Projects.automate');
        entry.click();
        expect(push).toHaveBeenCalledWith({ name: 'Automations', params: { cid: 'c1' }, query: { templates: '1', project: 'p1' } });
    });

    it('leaves Automate out for a member, who cannot manage automations', async () => {
        await openProjectMenu(3);
        expect(host.querySelector('[role="menu"]')).not.toBeNull();
        expect(host.querySelector('[data-test="project-automate-menu"]')).toBeNull();
    });
});

/* The entry was there all along, but in the dark theme the menu that holds it could not be
   found or read: a #3A3A3A image on the dark header, and legacy grey text on rows that the
   phone stylesheet had already moved to the dark surface. */
describe('the project menu can be found and read in either theme', () => {
    beforeEach(() => {
        setViewport(PHONE);
        host = document.createElement('div');
        host.id = 'my-dropdown';
        document.body.appendChild(host);
    });

    afterEach(() => {
        wrapper?.unmount();
        host.remove();
        setViewport(1024);
    });

    it('draws its trigger in the current text colour instead of a fixed-colour image', async () => {
        await openProjectMenu(1);
        const trigger = wrapper.find('button[aria-haspopup]');
        expect(trigger.find('img').exists()).toBe(false);
        expect(trigger.find('svg').exists()).toBe(true);
        expect(trigger.find('#projectoptions_driver').exists()).toBe(true);
    });

    it('takes its sheet and its text from the theme on a phone', () => {
        const phone = readFileSync(path.join(SRC, 'views/Projects/style.css'), 'utf8')
            .split('@media (max-width: 767px)')
            .slice(1)
            .join('\n');
        expect(phone).toMatch(/\.assigneelist-audiofile-dropdown\s*\{[^}]*background(?:-color)?:\s*var\(--surface\)/);
        expect(phone).toMatch(/\.assigneelist-audiofile-dropdown \.drop-down-item,[^{]*\.assigneelist-audiofile-dropdown \.drop-down-item span\s*\{[^}]*color:\s*var\(--ink\)/);
    });

    it('colours the trigger from a token', () => {
        const header = readFileSync(path.join(SRC, 'views/Projects/components/project-header.css'), 'utf8');
        expect(header).toMatch(/\.ph2 \.dot-btn\s*\{[^}]*color:\s*var\(--ink-2\)/);
    });
});
