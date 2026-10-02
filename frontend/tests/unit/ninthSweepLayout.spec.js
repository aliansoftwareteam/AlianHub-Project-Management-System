/* Task 047, hand check of build 782: empty lists, the rail in a short window, menus near the bottom edge,
   the plan notice on a long page, the time form, the phone gutter of Project Details and four empty screens. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, nextTick, ref } from 'vue';

const { apiRequest, hubList } = vi.hoisted(() => ({ apiRequest: vi.fn(), hubList: { value: [] } }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/plugins/dashboard/dashboardsApi', () => ({
    fetchDashboards: () => Promise.resolve(hubList.value),
    createDashboard: vi.fn(),
    duplicateDashboard: vi.fn(),
    removeDashboard: vi.fn(),
    makeCardUid: () => '1',
}));

import en from '@/locales/en';
import { taskEmptyStateKind, taskEmptySentenceKey, useTaskEmptyState } from '@/views/Projects/composables/useTaskEmptyState';
import { movedListRoute } from '@/views/Projects/folderSprints';
import { menuSide } from '@/views/Projects/composables/menuPlacement';
import { useRowMenu } from '@/components/molecules/ProjectTree/useRowMenu';
import { proposalTitle } from '@/views/Ai/plainLabels';
import AuditLog from '@/views/Settings/Audit/AuditLog.vue';
import DashboardsHub from '@/views/Dashboards/DashboardsHub.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.resolve(HERE, '../../src', file), 'utf8');
const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};
const phoneBlock = (css) => css.slice(css.search(/@media\s*\(max-width:\s*767px\)/));
const { t } = createI18n({ legacy: false, locale: 'en', messages: { en } }).global;

let wrapper;
afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('a list that holds no task', () => {
    const kind = (lists, over = {}) => taskEmptyStateKind({ showArchived: false, lastTaskId: 9, searched: false, lists, ...over });

    it('is named as an empty list, not as a view that failed to explain itself', () => {
        expect(kind([{ id: 's1', name: 'Backlog' }])).toBe('empty_list');
        expect(kind([{ id: 's1', name: 'Backlog', tasks: 0, archiveTaskCount: 0 }])).toBe('empty_list');
        expect(kind([{ id: 's1' }, { id: 's2', tasks: 0 }])).toBe('empty_lists');
    });

    it('keeps the unexplained text where a list should hold tasks, or holds archived ones', () => {
        expect(kind([{ id: 's1', tasks: 3 }])).toBe('no_visible_tasks');
        expect(kind([{ id: 's1', tasks: 0, archiveTaskCount: 2 }])).toBe('no_visible_tasks');
        expect(kind([{ id: 's1' }, { id: 's2', tasks: 1 }])).toBe('no_visible_tasks');
        expect(kind([])).toBe('no_visible_tasks');
    });

    it('still answers for the archive, a project with no task ever and a filter first', () => {
        const empty = [{ id: 's1' }];
        expect(kind(empty, { showArchived: true })).toBe('no_archived');
        expect(kind(empty, { lastTaskId: 0 })).toBe('no_tasks');
        expect(kind(empty, { searched: true })).toBe('no_match');
    });

    it('gives the views the name of the list and a sentence to say', () => {
        const Probe = defineComponent({
            setup: () => useTaskEmptyState(ref({ lastTaskId: 4 }), () => [{ id: 's1', name: 'Backlog' }]),
            template: '<div />',
        });
        const vm = mount(Probe).vm;
        expect(t(vm.emptyTitleKey, vm.emptyTitleParams)).toBe('Backlog has no tasks yet');
        expect(en.EmptyState.empty_list_msg).toMatch(/first one to this list/);
        expect(en.EmptyState.empty_lists_title).toBeTruthy();
        expect(en.EmptyState.empty_lists_msg).toBeTruthy();
        expect(en.EmptyState[taskEmptySentenceKey('empty_list').split('.')[1]]).toMatch(/this list/);
    });

    it.each(['views/Projects/ListView/ListView.vue', 'views/Projects/TableView/TableView.vue'])('%s hands the lists in view over and names the list', (file) => {
        const source = read(file);
        expect(source).toMatch(/useTaskEmptyState\(project, \(\) => props\.sprints\)/);
        expect(source).toContain('$t(emptyTitleKey, emptyTitleParams)');
    });
});

describe('the address of a list that was moved', () => {
    const project = {
        sprintsObj: { s1: { id: 's1' } },
        sprintsfolders: { f1: { folderId: 'f1', sprintsObj: { s2: { id: 's2' } } } },
    };
    const at = (name, params) => ({ name, params: { cid: 'c1', id: 'p1', ...params }, query: { tab: 'TableView' }, hash: '' });

    it('follows the list into its folder, with the view and the open task', () => {
        expect(movedListRoute({ route: at('ProjectSprint', { sprintId: 's2' }), project })).toEqual({
            name: 'ProjectFolderSprint', params: { cid: 'c1', id: 'p1', folderId: 'f1', sprintId: 's2' }, query: { tab: 'TableView' }, hash: '',
        });
        expect(movedListRoute({ route: at('ProjectSprintTask', { sprintId: 's2', taskId: 't1' }), project }).name).toBe('ProjectFolderSprintTask');
        expect(movedListRoute({ route: at('ProjectSprintTask', { sprintId: 's2', taskId: 't1' }), project }).params.taskId).toBe('t1');
    });

    it('follows the list out of a folder to the top level', () => {
        expect(movedListRoute({ route: at('ProjectFolderSprint', { folderId: 'f1', sprintId: 's1' }), project })).toEqual({
            name: 'ProjectSprint', params: { cid: 'c1', id: 'p1', sprintId: 's1' }, query: { tab: 'TableView' }, hash: '',
        });
    });

    it('leaves a right address, a list that is nowhere and every other page alone', () => {
        expect(movedListRoute({ route: at('ProjectSprint', { sprintId: 's1' }), project })).toBeNull();
        expect(movedListRoute({ route: at('ProjectFolderSprint', { folderId: 'f1', sprintId: 's2' }), project })).toBeNull();
        expect(movedListRoute({ route: at('ProjectSprint', { sprintId: 'gone' }), project })).toBeNull();
        expect(movedListRoute({ route: at('ProjectFolder', { folderId: 'f1' }), project })).toBeNull();
        expect(movedListRoute({ route: at('ProjectSprint', { sprintId: 's2' }), project: {} })).toBeNull();
    });

    it('is applied by the project page before it looks for the list', () => {
        expect(read('views/Projects/Projects.vue')).toMatch(/const moved = movedListRoute\(\{ route, project \}\);\s*if \(moved\) \{\s*router\.replace\(moved\);\s*return;/);
    });
});

describe('the rail in a short window', () => {
    const css = read('components/organisms/Shell/style.css');

    it('scrolls its links inside itself and keeps the mark and the foot whole', () => {
        const items = ruleBody(css, '.ah-rail__items');
        expect(items).toMatch(/flex:\s*1 1 auto/);
        expect(items).toMatch(/min-height:\s*0/);
        expect(items).toMatch(/overflow-y:\s*auto/);
        expect(ruleBody(css, '.ah-rail__foot')).toMatch(/flex:\s*none/);
        expect(ruleBody(css, '.ah-rail__mark')).toMatch(/flex:\s*none/);
    });

    it('sits in a shell that cannot be scrolled, even by focus', () => {
        expect(ruleBody(read('assets/css/tokens.css'), '.ah-app')).toMatch(/overflow:\s*hidden;\s*overflow:\s*clip/);
    });
});

describe('a tree row menu near the bottom edge', () => {
    const bounds = { top: 0, bottom: 728 };

    it('opens below when it fits, above when only that fits', () => {
        expect(menuSide({ top: 359, bottom: 383 }, 274, bounds)).toEqual({ up: false, maxHeight: null });
        expect(menuSide({ top: 535, bottom: 559 }, 274, bounds)).toEqual({ up: true, maxHeight: null });
    });

    it('takes the roomier side and the room there when neither fits', () => {
        const placed = menuSide({ top: 200, bottom: 224 }, 600, { top: 0, bottom: 500 });
        expect(placed.up).toBe(false);
        expect(placed.maxHeight).toBeGreaterThan(200);
        expect(placed.maxHeight).toBeLessThanOrEqual(500 - 224);
        expect(menuSide({ top: 400, bottom: 424 }, 600, { top: 0, bottom: 500 }).up).toBe(true);
    });

    const Host = defineComponent({
        setup: () => useRowMenu(),
        template: `<div class="scroller" style="overflow-y: auto">
            <div ref="root" class="pt-menu">
                <div v-if="shown" ref="menu" class="pt-menu__pop" :class="menuClass" :style="menuStyle"><button role="menuitem">Delete</button></div>
            </div>
        </div>`,
    });
    const openAt = async (rowTop) => {
        const box = (top, bottom) => ({ top, bottom, left: 0, right: 200, width: 200, height: bottom - top });
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
            if (this.classList.contains('scroller')) return box(0, 728);
            if (this.classList.contains('pt-menu')) return box(rowTop, rowTop + 24);
            return box(0, 0);
        });
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height() {
            return this.classList.contains('pt-menu__pop') ? 274 : 0;
        });
        wrapper = mount(Host, { attachTo: document.body });
        wrapper.vm.open();
        await nextTick();
        await nextTick();
        return wrapper.find('.pt-menu__pop');
    };

    it('flips upward for a row at y 535 in a panel that ends at 728', async () => {
        expect((await openAt(535)).classes()).toContain('pt-menu__pop--up');
    });

    it('still opens downward for a row with room below it', async () => {
        expect((await openAt(359)).classes()).not.toContain('pt-menu__pop--up');
    });

    it.each(['components/molecules/ProjectTree/FolderRowMenu.vue', 'components/molecules/ListMenu/ListMenu.vue'])('%s draws its menu where the shared code places it', (file) => {
        expect(read(file)).toMatch(/class="ah-pop pt-menu__pop" :class="menuClass" :style="menuStyle"/);
    });

    it('has the upward position and scrolls inside a capped height', () => {
        const css = read('components/molecules/ProjectTree/FolderRowMenu.vue');
        expect(ruleBody(css, '.pt-menu__pop--up')).toMatch(/top:\s*auto;\s*bottom:\s*calc\(100% \+ var\(--sp-1\)\)/);
        expect(ruleBody(css, '.pt-menu__pop')).toMatch(/overflow-y:\s*auto/);
    });
});

describe('the plan notice over a locked page', () => {
    const vue = read('components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue');
    const css = vue.slice(vue.indexOf('<style scoped>'));

    it('covers the locked block and pins the notice to what is on screen', () => {
        expect(vue).toMatch(/<div class="upw">\s*<div class="upw__pin">\s*<div class="upw__card">/);
        expect(ruleBody(css, '.upw')).toMatch(/position:\s*absolute;\s*inset:\s*0/);
        const pin = ruleBody(css, '.upw__pin');
        expect(pin).toMatch(/position:\s*sticky;\s*top:\s*0/);
        expect(pin).toMatch(/height:\s*min\(100%, 85dvh\)/);
    });

    it('lets clicks through everywhere but the notice itself', () => {
        expect(ruleBody(css, '.upw')).toMatch(/pointer-events:\s*none/);
        expect(ruleBody(css, '.upw__card')).toMatch(/pointer-events:\s*auto/);
    });
});

describe('the add time form', () => {
    it('keeps each input inside its grid cell', () => {
        const input = ruleBody(read('components/organisms/TaskDetailOverlay/TaskTimeSection.vue'), '.ah-time__input');
        expect(input).toMatch(/box-sizing:\s*border-box/);
        expect(input).toMatch(/min-width:\s*0/);
    });
});

describe('Start timer in the dark theme', () => {
    it('has an edge against the panel', () => {
        expect(ruleBody(read('components/organisms/TaskDetailOverlay/style.css'), '.ah-timer__start')).toMatch(/border:\s*1px solid var\(--border\)/);
    });
});

describe('Project Details on a phone', () => {
    it('gives every card the page gutter', () => {
        expect(phoneBlock(read('views/Projects/ProjectDetail/theme.css'))).toMatch(/> :is\(\.pm, \.pdt, \.pap, \.plim, \.psa, \.pmc, \.arc\)/);
    });

    it('keeps the details column inside the window', () => {
        expect(ruleBody(phoneBlock(read('components/organisms/ProjectDetailRightSide/style.css')), '.projectRightside')).toMatch(/box-sizing:\s*border-box/);
    });
});

describe('a proposal filed with no title', () => {
    const change = (label) => ({ action: 'task.comment', label });

    it('is named by its own change', () => {
        expect(proposalTitle(t, { what: 'undefined', changes: [change('Post the breakdown summary')] })).toBe('Post the breakdown summary');
        expect(proposalTitle(t, { what: '', changes: [change('Post the breakdown summary')] })).toBe('Post the breakdown summary');
        expect(proposalTitle(t, { changes: [change('Post the summary'), change('Set the due date'), change('Assign it')] })).toBe('Post the summary and 2 more changes');
    });

    it('never shows the word undefined, even with nothing to name it by', () => {
        expect(proposalTitle(t, { what: 'undefined' })).toBe(en.Ai.proposal_untitled);
        expect(proposalTitle(t, { what: 'null', changes: [change('undefined')] })).toBe(en.Ai.proposal_untitled);
    });
});

describe('an audit log filter that matches nothing', () => {
    const none = { data: { status: true, data: [], metadata: { total: 0, page: 1, totalPages: 1 } } };

    it('says so and clears the filter, back to the whole log', async () => {
        apiRequest.mockReset();
        apiRequest.mockResolvedValue(none);
        wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        await wrapper.findAll('.ah-tab')[2].trigger('click');
        await flushPromises();

        const empty = wrapper.find('[data-test="audit-empty"]');
        expect(empty.find('h2').text()).toBe(en.Audit.none_filtered);
        expect(empty.text()).not.toContain(en.Audit.none);
        expect(empty.find('.empty-state__btn').text()).toBe(en.Audit.clear_filters);

        await empty.find('.empty-state__btn').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('.ah-tab')[0].classes()).toContain('is-active');
        expect(apiRequest.mock.calls.at(-1)[1]).not.toMatch(/actorType/);
        expect(wrapper.find('[data-test="audit-empty"] h2').text()).toBe(en.Audit.none);
    });
});

describe('Dashboards, Shared with me', () => {
    const mine = { _id: 'd1', title: 'Mine', isMine: true, visibility: 'private', ownerName: 'Local PM', cardCount: 0, preview: [] };

    it('says that nothing is shared and leads back to all dashboards', async () => {
        hubList.value = [mine];
        wrapper = mount(DashboardsHub, { attachTo: document.body, global: { mocks: { $t: (key) => key } } });
        await flushPromises();
        expect(wrapper.find('[data-test="dash-empty-shared"]').exists()).toBe(false);

        await wrapper.findAll('.dash__tab')[2].trigger('click');
        const empty = wrapper.find('[data-test="dash-empty-shared"]');
        expect(empty.text()).toContain('Dash.shared_empty_title');
        expect(empty.text()).toContain('Dash.shared_empty_msg');
        await empty.find('.empty-state__btn').trigger('click');
        expect(wrapper.findAll('.dash__tab')[0].classes()).toContain('is-active');
        expect(en.Dash.shared_empty_title).toBeTruthy();
        expect(en.Dash.shared_empty_msg).toBeTruthy();
        expect(en.Dash.shared_empty_action).toBeTruthy();
    });
});

describe('empty screens that explained but offered nothing', () => {
    const tag = (file, test) => new RegExp(`<EmptyState[^>]*data-test="${test}"[^>]*/>`, 's').exec(read(file))?.[0] || '';

    it('Docs: a project with no docs offers New doc to someone who may write one', () => {
        const block = tag('views/Pages/PagesSpace.vue', 'docs-empty-project');
        expect(block).toContain(':action-label="$t(\'Docs.new_doc\')"');
        expect(block).toContain(':action-allowed="writesDocs"');
        expect(block).toContain('@action="createDoc({})"');
    });

    it.each(['docs-empty-shared', 'docs-empty-agents'])('Docs: %s leads back to the recent docs', (test) => {
        const block = tag('views/Pages/PagesSpace.vue', test);
        expect(block).toContain(':action-label="$t(\'Docs.see_recent\')"');
        expect(block).toContain('@action="view = \'recent\'"');
        expect(en.Docs.see_recent).toBeTruthy();
    });

    it('Approvals: an empty Time or Leave tab leads back to all approvals', () => {
        const block = tag('views/Approvals/Approvals.vue', 'approvals-empty');
        expect(block).toContain(':action-label="filter === \'all\' ? \'\' : $t(\'Time.show_all_approvals\')"');
        expect(block).toContain('@action="filter = \'all\'"');
        expect(en.Time.show_all_approvals).toBeTruthy();
    });

    it('AI Inbox: Approvals leads back to Waiting, Reports to the teammates that write them', () => {
        const approvals = tag('views/Ai/AiInbox.vue', 'approvals-empty');
        expect(approvals).toContain(':action-label="$t(\'Ai.back_to_waiting\')"');
        expect(approvals).toContain('@action="switchView(\'pending\')"');
        const reports = tag('views/Ai/AiInbox.vue', 'reports-empty');
        expect(reports).toContain(':action-label="$t(\'Ai.reports_empty_action\')"');
        expect(reports).toContain('@action="$router.push({ name: \'AgentTeammates\', params: { cid: companyId } })"');
        expect(en.Ai.back_to_waiting).toBeTruthy();
        expect(en.Ai.reports_empty_action).toBeTruthy();
    });

    it('Goals: the empty archive leads back to the goals', () => {
        const source = read('views/Goals/Goals.vue');
        expect(source).toMatch(/v-else-if="filters\.archived"[^>]*data-test="gls-empty-back"[^>]*@click="filter\(\{ archived: false \}\)"/s);
        expect(en.Goals.back_to_goals).toBeTruthy();
    });
});
