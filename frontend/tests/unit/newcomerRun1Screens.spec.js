import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import en from '@/locales/en';
import { proposalTitle } from '@/views/Ai/plainLabels';
import { plainReason } from '@/views/Ai/auditWords';
import { adminNames } from '@/components/molecules/AdminOnlyNote/adminNames';
import AdminOnlyNote from '@/components/molecules/AdminOnlyNote/AdminOnlyNote.vue';
import { ROLE_ADMIN, ROLE_MEMBER, ROLE_OWNER } from '@/utils/roles';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const { t, te } = i18n.global;
const read = (path) => readFileSync(resolve(__dirname, '../../src', path), 'utf8');

const seats = [
    { userId: 'u-member', roleType: ROLE_MEMBER },
    { userId: 'u-admin', roleType: ROLE_ADMIN },
    { userId: 'u-owner', roleType: ROLE_OWNER },
    { userId: 'u-gone', roleType: ROLE_ADMIN, isDelete: true }
];
const users = [
    { _id: 'u-member', Employee_Name: 'Sam Newcomer' },
    { _id: 'u-admin', Employee_Name: 'Ava Admin' },
    { _id: 'u-owner', Employee_Name: 'Mevil Bhojani' },
    { _id: 'u-gone', Employee_Name: 'Gone Admin' }
];
const storeWith = (companyUsers, people) => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUsers: () => companyUsers } },
        users: { namespaced: true, getters: { users: () => people } }
    }
});

describe('what a Member is told where projects and invites live', () => {
    it('names the owner first, then an admin, and leaves out a removed seat', () => {
        expect(adminNames(seats, users)).toEqual(['Mevil Bhojani', 'Ava Admin']);
    });

    it('says who to ask for a project', () => {
        const wrapper = mount(AdminOnlyNote, { props: { what: 'projects' }, global: { plugins: [i18n, storeWith(seats, users)] } });
        expect(wrapper.text()).toBe('Only an admin can create projects. Ask Mevil Bhojani or Ava Admin to create one or to change your role.');
    });

    it('says who to ask for an invite, and falls back to "an admin" when no name is known', () => {
        const wrapper = mount(AdminOnlyNote, { props: { what: 'invite' }, global: { plugins: [i18n, storeWith(seats, [])] } });
        expect(wrapper.text()).toBe('Only an admin can invite people. Ask an admin to invite them or to change your role.');
    });

    it('is shown on Home\'s New menu, the Projects page, Settings, People and Members to whoever cannot do it', () => {
        expect(read('views/Home/TodayOverdue.vue')).toContain('<AdminOnlyNote v-if="!canCreateProject" what="projects"');
        expect(read('views/Projects/ProjectsListing/ProjectsListPage.vue')).toContain('<AdminOnlyNote v-if="!canCreate" what="projects"');
        expect(read('views/Settings/SettingsShell.vue')).toContain('<AdminOnlyNote v-if="!canInvite" what="invite"');
        expect(read('views/People/PeopleDirectory.vue')).toContain('<AdminOnlyNote v-if="!canInvite" what="invite"');
        expect(read('views/Settings/Members/Members.vue')).toContain('<AdminOnlyNote v-if="!canInvite" what="invite"');
    });
});

describe('a connected app\'s proposal, in words', () => {
    const filed = {
        what: 'task.create: Creates a task in a project at once, with as much as you know in one call.',
        changes: [{ action: 'task.add', label: 'task.create (via tool)', params: { title: 'Book the movers' } }]
    };

    it('is titled by what it does and what it names, not by the tool\'s description', () => {
        expect(proposalTitle(t, filed)).toBe('Create a task: “Book the movers”');
        expect(proposalTitle(t, { ...filed, changes: [] })).toBe('Create a task');
    });

    it('keeps the skill-engine titles it read before', () => {
        expect(proposalTitle(t, { what: 'brief.parse: 3 changes on Launch' })).not.toContain('brief.parse');
    });

    it('names the app by its name or host, not its metadata address', () => {
        const old = "Tidy the board (task.add reaches the whole project; it came from an outside client (https://claude.ai/oauth/claude-code-client-metadata), so it needs a person's approval)";
        expect(plainReason(t, te, old)).toBe('Tidy the board (This change reaches the whole project, and it came from claude.ai, an app outside AlianHub, so a person has to approve it)');
        const named = "task.add reaches the whole project; it came from an outside client (Claude Code (app · claude.ai)), so it needs a person's approval";
        expect(plainReason(t, te, named)).toBe('This change reaches the whole project, and it came from Claude Code (app · claude.ai), an app outside AlianHub, so a person has to approve it');
    });

    it('reads the same on Home as in the Inbox', () => {
        expect(read('components/molecules/Home/WaitingOnYouCard.vue')).toContain('plainReason(t, te, p.why)');
    });
});

describe('small things a newcomer met', () => {
    it('the people picker has a plain title', () => {
        expect(t('Projects.choose_people')).toBe('Choose people');
        expect(read('components/molecules/Assignee/Assignee.vue')).not.toContain('list_of_user');
        expect(read('views/Projects/components/ProjectSidebars.vue')).not.toContain('list_of_user');
    });

    it('the menu entry and the page it opens share one name', () => {
        expect(read('components/organisms/Shell/GlobalRail.vue')).toContain("$t('Settings.nav_my_settings')");
        expect(read('components/organisms/Shell/GlobalRail.vue')).not.toContain('Shell.my_profile');
    });

    it('the More menu is drawn on the surface, not over what is behind it', () => {
        expect(read('components/organisms/Shell/style.css')).toMatch(/\.ah-rail__pop \{[^}]*background: var\(--surface\)/);
    });

    it('the task panel\'s date box stays inside its cell', () => {
        expect(read('components/organisms/TaskDetailOverlay/style.css')).toContain('.ah-detail__props .due-date .date_format_cal { width: 100%; min-width: 0;');
    });
});

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ makeUniqueId: () => 'x', checkApps: () => false }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: id === 'u1' ? 'Sam Newcomer' : 'Ghost User', ghostUser: false }), getTeam: () => ({}) })
}));

describe('the assignee in the task panel', () => {
    it('shows the one assignee\'s name beside the picture', async () => {
        const { default: Assignee } = await import('@/components/molecules/Assignee/Assignee.vue');
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUsers: () => [] } } } });
        const wrapper = mount(Assignee, {
            props: { users: ['u1'], showName: true, options: [] },
            global: { plugins: [i18n, store], stubs: { UserProfile: true, DropDown: true, DropDownOption: true, Sidebar: true } }
        });
        expect(wrapper.find('[data-test="assignee-name"]').text()).toBe('Sam Newcomer');
        await wrapper.setProps({ showName: false });
        expect(wrapper.find('[data-test="assignee-name"]').exists()).toBe(false);
    });

    it('opens the picker, titled "Choose people", from the same add button with the name shown', async () => {
        const { default: Assignee } = await import('@/components/molecules/Assignee/Assignee.vue');
        const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUsers: () => [] } } } });
        const wrapper = mount(Assignee, {
            props: { users: ['u1'], showName: true, showAddUser: true, addUser: true, options: [] },
            global: { plugins: [i18n, store], stubs: { UserProfile: true, DropDown: true, DropDownOption: true, Sidebar: { name: 'Sidebar', props: ['title', 'visible'], template: '<div class="picker" :data-open="visible">{{ title }}</div>' } } }
        });
        expect(wrapper.find('.picker').attributes('data-open')).toBe('false');
        await wrapper.find('button.assignee__add-btn').trigger('click');
        expect(wrapper.find('.picker').attributes('data-open')).toBe('true');
        expect(wrapper.find('.picker').text()).toBe('Projects.choose_people');
    });
});
