/* Hand check of build 772 (task 047): the limits card that took the search palette's class, the Connect your AI
   line that guessed before it knew, one minute that could not be logged, counts of one, "sprint" for a plain
   list, and an audio element with an empty source. The header chip is in agentPauseFollows.spec.js. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest, apiRequestWithoutCompnay, route } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    route: { name: 'AiConnect', meta: {}, params: { cid: 'company-1' }, query: {}, fullPath: '/' },
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(() => Promise.resolve()) }), useRoute: () => route }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Mira Member' }) }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue', () => ({ default: { name: 'TaskTimerChip', render: () => null } }));

import ConnectYourAi from '@/views/Ai/ConnectYourAi.vue';
import TaskTimeSection from '@/components/organisms/TaskDetailOverlay/TaskTimeSection.vue';
import { resetAiConnection } from '@/composable/aiConnection';
import { resetAiAvailability } from '@/composable/aiAvailability';
import { resetOnboardingRecord } from '@/composable/onboardingState';
import { timeFormProblem, emptyTimeForm } from '@/components/organisms/TaskDetailOverlay/taskTime';
import { actionLabel } from '@/views/Ai/plainLabels';
import en from '@/locales/en';

const SRC = path.resolve(__dirname, '../../src');
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');
const { t } = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false }).global;

describe('the card "Agents working at the same time"', () => {
    const card = read('views/Projects/ProjectDetail/ProjectAgentLimitsCard.vue');

    it('shares no class name with the search palette, whose rules reach every page', () => {
        expect(read('components/molecules/AdvanceSearch/style.css')).toMatch(/^\.pal \{[^}]*position: absolute/m);
        expect(card).not.toMatch(/\bpal(__|\b)/);
    });

    it('keeps one prefix of its own for the root and every part', () => {
        const template = card.slice(0, card.indexOf('<script'));
        const classes = [...template.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/));
        expect(classes.length).toBeGreaterThan(5);
        expect(classes.filter((name) => !/^plim(__[a-z-]+)?$/.test(name))).toEqual([]);
    });
});

describe('Connect your AI, before the first answer', () => {
    const STATUS = { connected: false, lastSeenAt: null, via: null, apps: true, tokens: true, address: 'https://hub.example.com/mcp', tools: { data: true, manage: true, work: true } };
    const SEEN = { ...STATUS, connected: true, lastSeenAt: '2026-10-01T22:13:13.000Z', via: 'app' };
    const answer = (data) => ({ data: { status: true, data } });
    const LinkStub = defineComponent({ name: 'RouterLink', setup: (props, { slots }) => () => h('a', slots.default && slots.default()) });
    const open = async () => {
        const wrapper = mount(ConnectYourAi, { global: { components: { RouterLink: LinkStub } } });
        await flushPromises();
        return wrapper;
    };
    const sign = (wrapper) => wrapper.find('[data-test="connect-ai-sign"]');

    beforeEach(() => {
        vi.useRealTimers();
        resetAiConnection();
        resetAiAvailability();
        resetOnboardingRecord();
        apiRequest.mockReset();
    });
    afterEach(() => vi.restoreAllMocks());

    it('says it is checking, not that nothing is connected, and then says what the server answered', async () => {
        let land;
        apiRequest.mockImplementation(() => new Promise((resolve) => { land = resolve; }));
        const wrapper = await open();
        expect(sign(wrapper).text()).toContain('ConnectAi.sign_checking');
        expect(sign(wrapper).text()).not.toContain('ConnectAi.sign_waiting');
        expect(sign(wrapper).classes()).not.toContain('is-connected');
        expect(wrapper.find('[data-test="connect-ai-way-claude"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="connect-ai-tools"]').exists()).toBe(false);

        land(answer(SEEN));
        await flushPromises();
        expect(sign(wrapper).text()).toContain('ConnectAi.sign_connected');
        expect(sign(wrapper).classes()).toContain('is-connected');
        expect(wrapper.find('[data-test="connect-ai-way-claude"]').exists()).toBe(true);
        wrapper.unmount();
    });

    it('says not connected only once the server said so', async () => {
        apiRequest.mockImplementation(() => Promise.resolve(answer(STATUS)));
        const wrapper = await open();
        expect(sign(wrapper).text()).toContain('ConnectAi.sign_waiting');
        expect(sign(wrapper).text()).not.toContain('ConnectAi.sign_checking');
        wrapper.unmount();
    });

    it('asks at once in a tab that is not in view, where the later asks wait', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        apiRequest.mockImplementation(() => Promise.resolve(answer(STATUS)));
        const wrapper = await open();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(sign(wrapper).text()).toContain('ConnectAi.sign_waiting');
        await vi.advanceTimersByTimeAsync(20000);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('asks again within a second when the first read fails, instead of waiting for the next slow ask', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        apiRequest.mockImplementationOnce(() => Promise.reject(new Error('offline')));
        apiRequest.mockImplementation(() => Promise.resolve(answer(SEEN)));
        const wrapper = await open();
        expect(sign(wrapper).text()).toContain('ConnectAi.sign_checking');
        await vi.advanceTimersByTimeAsync(1000);
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(2);
        expect(sign(wrapper).text()).toContain('ConnectAi.sign_connected');
        wrapper.unmount();
    });

    it('has the checking line in the English locale', () => {
        expect(en.ConnectAi.sign_checking).toEqual(expect.any(String));
    });
});

describe('Add time in the task panel', () => {
    const TASK = { _id: 'task-1', TaskName: 'Write spec', ProjectID: 'proj-1', sprintId: 'sprint-1' };
    const SAVE = '/api/v2/manualLogtime';
    const openForm = async () => {
        apiRequest.mockImplementation(async (method, url) => (url === SAVE
            ? { data: { status: true } }
            : { data: { status: true, data: { entries: [], totalMinutes: 0, mineMinutes: 0, estimateMinutes: 0, seesEveryone: true } } }));
        const wrapper = mount(TaskTimeSection, {
            props: { task: TASK, project: { _id: 'proj-1', ProjectName: 'Launch' }, showTimer: false },
            global: { plugins: [createStore({ getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }), 'settings/companyDateFormat': () => ({ dateFormat: 'DD/MM/YYYY' }) } })] },
        });
        await flushPromises();
        await wrapper.find('[data-test="time-add"]').trigger('click');
        return wrapper;
    };
    const fill = async (wrapper, hours, minutes) => {
        await wrapper.find('[data-test="time-hours"]').setValue(hours);
        await wrapper.find('[data-test="time-minutes"]').setValue(minutes);
        await wrapper.find('form').trigger('submit');
        await flushPromises();
    };
    const saved = () => apiRequest.mock.calls.filter(([, url]) => url === SAVE).map(([, , body]) => body.timeDuration);

    beforeEach(() => apiRequest.mockReset());

    it('takes any whole minute: the browser is given no step that refuses 1, and no say over the form', async () => {
        const wrapper = await openForm();
        const minutes = wrapper.find('[data-test="time-minutes"]');
        expect(minutes.attributes('step')).toBeUndefined();
        expect(minutes.attributes('min')).toBe('0');
        expect(minutes.attributes('max')).toBe('59');
        expect(wrapper.find('form').attributes('novalidate')).toBeDefined();
        await fill(wrapper, '0', '1');
        expect(saved()).toEqual(['00:01']);
    });

    it('still moves in fives with the arrow keys, from whatever minute is there', async () => {
        const wrapper = await openForm();
        const minutes = wrapper.find('[data-test="time-minutes"]');
        await minutes.setValue('1');
        await minutes.trigger('keydown', { key: 'ArrowUp' });
        expect(minutes.element.value).toBe('5');
        await minutes.trigger('keydown', { key: 'ArrowUp' });
        expect(minutes.element.value).toBe('10');
        await minutes.setValue('58');
        await minutes.trigger('keydown', { key: 'ArrowUp' });
        expect(minutes.element.value).toBe('59');
        await minutes.trigger('keydown', { key: 'ArrowDown' });
        expect(minutes.element.value).toBe('55');
        await minutes.setValue('3');
        await minutes.trigger('keydown', { key: 'ArrowDown' });
        await minutes.trigger('keydown', { key: 'ArrowDown' });
        expect(minutes.element.value).toBe('0');
    });

    it.each([['0', '75'], ['0', '1.5'], ['24', '0'], ['-1', '30']])('refuses %s h %s min with the app\'s own message and saves nothing', async (hours, minutes) => {
        const wrapper = await openForm();
        await fill(wrapper, hours, minutes);
        expect(wrapper.find('[role="alert"]').text()).toBe('TaskPanel.time_whole_numbers');
        expect(saved()).toEqual([]);
    });

    it('says which rule a form breaks, in words the English locale holds', () => {
        const form = (over) => ({ ...emptyTimeForm(new Date('2026-10-02T10:00:00')), ...over });
        expect(timeFormProblem(form({ hours: 0, minutes: 1 }))).toBe('');
        expect(timeFormProblem(form({ hours: '', minutes: 20 }))).toBe('');
        expect(timeFormProblem(form({ hours: 0, minutes: 0 }))).toBe('TaskPanel.time_duration_required');
        expect(timeFormProblem(form({ hours: 0, minutes: 60 }))).toBe('TaskPanel.time_whole_numbers');
        expect(timeFormProblem(form({ start: '', hours: 1, minutes: 0 }))).toBe('TaskPanel.time_start_required');
        ['time_whole_numbers', 'time_start_required'].forEach((key) => expect(en.TaskPanel[key], key).toEqual(expect.any(String)));
    });
});

describe('a count of one reads as one', () => {
    it.each([
        ['Everything.subtasks_n', { n: 1 }, 1, '1 subtask'],
        ['Everything.subtasks_n', { n: 3 }, 3, '3 subtasks'],
        ['List.risk_factor_subtasks', { done: 0, total: 1 }, 1, 'Only 0 of 1 subtask finished'],
        ['List.risk_factor_subtasks', { done: 1, total: 4 }, 4, 'Only 1 of 4 subtasks finished'],
        ['Parity.n_projects', { n: 1 }, 1, '1 project'],
        ['Parity.n_projects', { n: 2 }, 2, '2 projects'],
        ['Parity.n_skills', { n: 1 }, 1, '1 skill'],
        ['Parity.n_skills', { n: 0 }, 0, '0 skills'],
        ['Dash.n_cards', { n: 1 }, 1, '1 CARD'],
        ['Dash.n_cards', { n: 12 }, 12, '12 CARDS'],
    ])('%s %o', (key, named, count, text) => {
        expect(t(key, named, count)).toBe(text);
    });

    it('because each place that shows the count hands it over as the number to choose the form by', () => {
        ['views/Everything/EverythingRow.vue', 'views/Everything/EverythingTableRow.vue', 'views/Everything/EverythingCard.vue'].forEach((file) => {
            expect(read(file), file).toContain("$t('Everything.subtasks_n', { n: task.subTasks }, task.subTasks)");
        });
        expect(read('views/Dashboards/DashboardsHub.vue')).toContain("$t('Dash.n_cards', { n: d.cardCount }, d.cardCount)");
        const member = read('views/Ai/AgentMemberRow.vue');
        expect(member).toContain('t("Parity.n_projects", { n: projects.ids.length }, projects.ids.length)');
        expect(member).toContain('t("Parity.n_skills", { n: skills }, skills)');
        ['views/Projects/ListView/ListRow.vue', 'views/Projects/TableView/TableRow.vue'].forEach((file) => {
            expect(read(file), file).toMatch(/t\(`List\.risk_factor_\$\{top\.key\}`, \{[^}]*\}, top\.total \|\| 0\)/);
        });
    });
});

describe('"sprint" is kept for the Scrum sprint and not said of a plain list', () => {
    const NO_SPRINT = /\bsprints?\b/i;

    it('a custom report groups by list, and its ready-made reports are named for lists', () => {
        expect(en.Reports.dim_sprint).toBe('List');
        expect(en.Reports.template_name_tasks_by_sprint).toBe('Tasks by list');
        expect(en.Reports.template_name_points_by_sprint).toBe('Story points by list');
        ['tasks_by_status', 'tasks_by_project', 'points_by_project'].forEach((key) => expect(en.Reports[`template_name_${key}`], key).toEqual(expect.any(String)));
        const page = read('views/CustomReports/CustomReports.vue');
        expect(page).toContain('{{ templateName(tp) }}');
        expect(page).toContain('reportName.value = templateName(tpl)');
    });

    it('the action that moves a task says list, whatever label the server sends', () => {
        const fromServer = { key: 'task.sprint.move', label: 'Move a task between sprints' };
        expect(actionLabel(t, fromServer)).toBe('Move a task to another list');
        expect(actionLabel(t, 'task.sprint.move', [fromServer])).toBe('Move a task to another list');
        expect(actionLabel(t, { key: 'task.comment', label: 'Comment on a task' })).toBe('Comment on a task');
        expect(read('views/Ai/SkillLibrary.vue')).toContain('{{ actionLabel(t, action) }}');
    });

    it('the descriptions of what a person may do with a list say list', () => {
        ['project_sprint_create', 'project_sprint_name_edit', 'sprint_archive', 'sprint_delete', 'sprint_restore', 'task_move'].forEach((key) => {
            expect(en.PermissionDesc[key], key).not.toMatch(NO_SPRINT);
            expect(en.PermissionDesc[key], key).toMatch(/\blist\b/);
        });
    });

    it('the Scrum report, its picker and the switch between a plain list and a sprint keep the word', () => {
        expect(en.Reports.tab_sprint).toBe('Sprint');
        expect(en.Reports.sprint).toBe('Sprint');
        expect(en.PermissionDesc.sprint_type_change).toMatch(NO_SPRINT);
        expect(read('views/Projects/Reports/SprintReportPage.vue')).toContain('s.isScrum === true');
    });
});

describe('no media element is rendered with an empty source', () => {
    const vueFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return vueFiles(full);
        return entry.name.endsWith('.vue') ? [full] : [];
    });

    it('so opening the task panel loads nothing that is not there', () => {
        const empty = vueFiles(SRC).filter((file) => /<(audio|video)\b[^>]*\ssrc=(""|'')/.test(fs.readFileSync(file, 'utf8')));
        expect(empty.map((file) => path.relative(SRC, file))).toEqual([]);
    });

    it('the voice recorder still has the player it writes the recording to', () => {
        expect(read('components/atom/Record/Record.vue')).toMatch(/<audio\b[^>]*id="audioPlayer"/);
    });
});
