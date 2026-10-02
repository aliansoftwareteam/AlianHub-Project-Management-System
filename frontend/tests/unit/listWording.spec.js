import { describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { answer } = vi.hoisted(() => ({ answer: { total: 0, projects: [] } }));
vi.mock('@/services', () => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: { status: true, data: { statuses: [], scope: 'self', ...answer } } }))
}));

import en from '@/locales/en.js';
import TasksByStatusCard from '@/components/organisms/TasksByStatusCard/TasksByStatusCard.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const locales = Object.entries(import.meta.glob('@/locales/*.js', { eager: true }))
    .map(([file, module]) => [file.split('/').pop().replace('.js', ''), module.default])
    .filter(([code, messages]) => !['en', 'main'].includes(code) && messages && typeof messages === 'object');

const read = (messages, [namespace, key]) => messages?.[namespace]?.[key];

/* Each names a list: the place a task is created in or moved to, or the list being made. */
const LIST_KEYS = [
    ['PlaceHolder', 'Enter_sprint_name', 'Enter sprint name'],
    ['Toast', 'Sprint created successfully', 'Sprint created successfully'],
    ['Toast', 'Sprint updated successfully', 'Sprint updated successfully'],
    ['Toast', 'Sprint_already_exists', 'Sprint already exists'],
    ['Chat', 'sprint', 'Sprint'],
    ['Chat', 'select_sprint', 'Select a sprint'],
    ['Chat', 'pick_both', 'Pick a project and a sprint.'],
    ['TalkToText', 'sprint', 'Sprint'],
    ['TalkToText', 'select_sprint', 'Select a sprint'],
    ['Notepad', 'select_sprint', 'Sprint'],
    ['Notepad', 'select_sprint_placeholder', 'Select a sprint'],
    ['Notepad', 'loading_sprints', 'Loading sprints…'],
    ['Notepad', 'select_sprint_required', 'Please select a sprint.'],
    ['List', 'sprint', 'Sprint'],
    ['List', 'sprint_total_hint', 'Every task in this sprint, subtasks included. Reports and the burndown count parent tasks only.'],
    ['Auth', 'from_description_desc', 'Describe the project and AI drafts the sprints and tasks.'],
    ['Auth', 'tour_project_new_body', 'Lists group work into sprints or phases; folders group lists. Both start from + New.'],
    ['Home', 'recents_empty', 'Nothing opened yet. Tasks, projects, docs and sprints you open show up here.'],
    ['Home', 'recents_type_sprint', 'Sprint'],
    ['Palette', 'sprint_in', 'Sprint in {project}'],
    ['TaskPanel', 'sprint', 'Sprint'],
    ['Views', 'sprint_fallback', 'Sprint'],
    ['Views', 'map_empty', 'No tasks in this sprint yet.'],
    ['Fields', 'rollup_scope_sprint', 'Sprint'],
    ['Fields', 'hint_rollup', 'sums up subtasks or a sprint'],
    ['Projects', 'sprint', 'Sprint'],
    ['Projects', 'create_new_list', 'Create New Sprint'],
    ['Projects', 'sprint_planned_hint', 'Hours planned across every task in this sprint, subtasks included'],
    ['Projects', 'sprint_logged_hint', 'Hours logged across every task in this sprint, subtasks included'],
    ['Projects', 'select_sprint', 'Sprint'],
    ['Projects', 'form_pick_sprint', 'Choose a sprint…'],
    ['Projects', 'select_folder', 'Select a folder to move this sprint into'],
    ['Projects', 'import_csv_hint', 'Upload a CSV/XLSX file, map your columns, and tasks land in the selected sprint.'],
    ['Projects', 'sprint_data_required', 'SPRINT DATA REQUIRED'],
    ['ViewListdescription', 'forms_view', 'Collect requests through a shareable form — every submission arrives as a task in the sprint you choose.'],
    ['TalkToText', 'pick_project_sprint', 'Please select a project and sprint.'],
    ['EmptyState', 'no_sprints_msg', 'Lists group related tasks together — a sprint, a phase, or simply a heading. Add one to organise this project.'],
    ['Toast', 'Sprint restored successfully', 'Sprint restored successfully'],
    ['Toast', 'Sprint archived successfully', 'Sprint archived successfully'],
    ['Toast', 'Sprint deleted successfully', 'Sprint deleted successfully'],
    ['Toast', 'Sprint_not_found', 'Sprint not found'],
    ['Toast', 'Upgrade_your_plan_you_have_reached_the_limit_for_creating_sprints', 'Upgrade your plan. You have reached the limit for creating sprints.'],
    ['IntegrationsHub', 'email_note', "Tasks land in the project's first sprint, created as the inbox owner."],
    ['AiProject', 'generating_plan_sub', 'Building your sprints and tasks — usually 15–30 seconds. Please wait.'],
    ['AiProject', 'sprint_count', '{n} sprint | {n} sprints'],
    ['AiProject', 'progress_sprints', 'Sprints'],
    ['WhoCanSee', 'menu_sprint', 'Who can see this sprint'],
    ['WhoCanSee', 'kind_sprint', 'Sprint'],
    ['WhoCanSee', 'can_sprint_view', 'Can open the sprint and read its tasks.'],
    ['WhoCanSee', 'can_sprint_manage', 'Can rename, share or archive the sprint.'],
    ['WhoCanSee', 'reason_admin_hint', 'Owners and admins can see every project, sprint and shared doc in the company.'],
    ['WhoCanSee', 'reason_sprint_member_hint', 'This sprint is private and was shared with them by name.'],
    ['WhoCanSee', 'reason_sprint_team_hint', 'This sprint is private and was shared with their team: {teams}.'],
    ['WhoCanSee', 'reason_guest_sprint_hint', 'Guests who were given this sprint or its project, by name or through a team.'],
    ['WhoCanSee', 'reason_everyone_sprint_hint', 'This sprint is not private and its project is public, so every member of the company can open it.'],
    ['WhoCanSee', 'link_sprint_hint', "Can see this sprint's tasks, read only, without signing in."],
];
/* The code swaps the upper-case stand-in for the list's name, so only the words around it are read. */
const NAMED_LIST_KEYS = [
    ['Toast', 'create_task_plan_limit_message', 'Upgrade your plan. You have reached the limit for creating tasks in the TASK_SPRINT sprint.', 'TASK_SPRINT'],
    ['Toast', 'create_task_limit_in_sprint_upgrade_task_message', 'Upgrade your plan. You have reached the limit for creating tasks in the SELECTED_SPRINT_DATA sprint.', 'SELECTED_SPRINT_DATA'],
];
const FOLDER_KEY = ['PlaceHolder', 'Enter_directory_name', 'Enter directory name'];

describe('a list is called a list', () => {
    it.each(LIST_KEYS)('%s.%s says list, not sprint', (namespace, key) => {
        const text = read(en, [namespace, key]);
        expect(text).toMatch(/list/i);
        expect(text).not.toMatch(/sprint/i);
    });

    it.each(NAMED_LIST_KEYS)('%s.%s names the list and calls it a list', (namespace, key, _old, standIn) => {
        expect(read(en, [namespace, key])).toMatch(new RegExp(`in the ${standIn} list\\.$`));
    });

    it('asks for a folder name, not a directory name', () => {
        expect(read(en, FOLDER_KEY)).toBe('Enter folder name');
    });

    it('leaves no locale on the old English sentence', () => {
        const stale = locales.flatMap(([code, messages]) => [...LIST_KEYS, ...NAMED_LIST_KEYS, FOLDER_KEY]
            .filter(([namespace, key, old]) => read(messages, [namespace, key]) === old)
            .map(([namespace, key]) => `${code}: ${namespace}.${key}`));
        expect(locales.length).toBeGreaterThan(5);
        expect(stale).toEqual([]);
    });
});

describe('the tasks by status card', () => {
    const subOf = async (total, projectCount) => {
        answer.total = total;
        answer.projects = Array.from({ length: projectCount }, (_, n) => ({ projectId: `p${n}`, name: `Project ${n}`, total: 1, counts: {} }));
        const wrapper = mount(TasksByStatusCard, { global: { mocks: { $t: i18n.global.t } } });
        await flushPromises();
        return `${wrapper.get('.dc-num').text()} ${wrapper.get('.dc-sub').text()}`;
    };

    it('counts one project as a project and one task as a task', async () => {
        expect(await subOf(2, 1)).toBe('2 tasks across 1 project');
        expect(await subOf(1, 1)).toBe('1 task across 1 project');
        expect(await subOf(7, 3)).toBe('7 tasks across 3 projects');
    });
});
