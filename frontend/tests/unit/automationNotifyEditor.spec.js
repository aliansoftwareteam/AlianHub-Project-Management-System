import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';

const ids = vi.hoisted(() => ({ next: 0 }));
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++ids.next}` }),
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));

import NotifyActionEditor from '@/views/Automations/NotifyActionEditor.vue';
import AutomationsPage from '@/views/Automations/AutomationsPage.vue';
import RunHistoryDrawer from '@/views/Automations/RunHistoryDrawer.vue';
import { renderNotice } from '@/views/Inbox/renderNotice';
import en from '@/locales/en';

const PRIYA = 'u-priya';
const SAM = 'u-sam';
const GONE = 'u-gone';
const echo = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

const storeWith = (roleType = 1) => createStore({
    modules: {
        settings: {
            namespaced: true,
            getters: {
                companyUserDetail: () => ({ roleType }),
                companyUsers: () => [
                    { userId: PRIYA, isDelete: false, status: 2 },
                    { userId: SAM, isDelete: false, status: 2 },
                    { userId: GONE, isDelete: true, status: 2 },
                ],
            },
        },
        users: {
            namespaced: true,
            getters: {
                users: () => [
                    { _id: PRIYA, Employee_Name: 'Priya Shah' },
                    { _id: SAM, Employee_Name: 'Sam Lee' },
                    { _id: GONE, Employee_Name: 'Gone Person' },
                ],
            },
        },
    },
});

let wrapper;
const mountEditor = async (modelValue) => {
    wrapper = mount(NotifyActionEditor, {
        props: { modelValue },
        attachTo: '#app',
        global: { plugins: [storeWith()], mocks: { $t: echo } },
    });
    await flushPromises();
    return wrapper;
};

const lastConfig = () => {
    const events = wrapper.emitted('update:modelValue') || [];
    return events.length ? events[events.length - 1][0] : null;
};
const peopleTrigger = () => document.querySelector('#app [aria-haspopup="listbox"]');
const openPeople = async () => {
    peopleTrigger().click();
    await flushPromises();
    return document.getElementById(peopleTrigger().getAttribute('aria-controls'));
};
const options = (list) => [...list.querySelectorAll('[role="option"]')];
const optionNamed = (list, text) => options(list).find((el) => el.textContent.includes(text));

beforeEach(() => {
    document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
});

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('NotifyActionEditor', () => {
    it('offers the assignees, the creator, the watchers and the active members in a keyboard-reachable listbox', async () => {
        await mountEditor({ recipients: [], message: '' });
        const list = await openPeople();
        expect(list.getAttribute('role')).toBe('listbox');
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
        const names = options(list).map((el) => el.textContent.trim());
        expect(names.slice(0, 3)).toEqual(['Automations.notify_role_task_assignees', 'Automations.notify_role_task_creator', 'Automations.notify_role_task_watchers']);
        expect(names).toEqual(expect.arrayContaining(['Priya Shah', 'Sam Lee']));
        expect(names.join(' ')).not.toMatch(/Gone Person/);
    });

    it('toggles a recipient in and out and names the picked ones on the button', async () => {
        await mountEditor({ recipients: ['task_assignees'], message: 'Hi' });
        expect(wrapper.find('[data-test="notify-recipients"]').text()).toBe('Automations.notify_role_task_assignees');
        const list = await openPeople();
        expect(optionNamed(list, 'notify_role_task_assignees').getAttribute('aria-selected')).toBe('true');
        optionNamed(list, 'Priya Shah').click();
        await flushPromises();
        expect(lastConfig()).toEqual({ recipients: ['task_assignees', PRIYA], message: 'Hi' });
        await wrapper.setProps({ modelValue: lastConfig() });
        optionNamed(list, 'notify_role_task_assignees').click();
        await flushPromises();
        expect(lastConfig().recipients).toEqual([PRIYA]);
    });

    it('takes the message, with a label and the placeholder hint, and keeps it short', async () => {
        await mountEditor({ recipients: ['task_creator'], message: '' });
        const input = wrapper.find('[data-test="notify-message"]');
        expect(input.attributes('aria-label')).toBe('Automations.notify_message');
        expect(input.attributes('maxlength')).toBe('500');
        await input.setValue('{{task.TaskKey}} is late');
        await input.trigger('change');
        expect(lastConfig()).toEqual({ recipients: ['task_creator'], message: '{{task.TaskKey}} is late' });
    });

    it('leaves out the person who caused the event unless the box is ticked', async () => {
        await mountEditor({ recipients: ['task_creator'], message: 'Hi' });
        const box = wrapper.find('[data-test="notify-include-actor"]');
        expect(box.element.checked).toBe(false);
        await box.setValue(true);
        expect(lastConfig()).toEqual({ recipients: ['task_creator'], message: 'Hi', includeActor: true });
        await wrapper.setProps({ modelValue: lastConfig() });
        await box.setValue(false);
        expect(lastConfig()).toEqual({ recipients: ['task_creator'], message: 'Hi' });
    });
});

const MANIFEST = {
    triggers: [
        { key: 'task.created', label: 'Task is created', entity: 'task', hasDiff: false },
        { key: 'task.due_date_passed', label: 'Task due date passes', entity: 'task', hasDiff: false },
        { key: 'task.subtasks_all_done', label: 'All subtasks of a task are done', entity: 'task', hasDiff: false },
    ],
    conditionFields: [],
    actions: [
        { key: 'add_comment', label: 'Add a comment', schema: { body: { type: 'textarea', label: 'Comment' } } },
        { key: 'notify', label: 'Send a notification', schema: { recipients: { type: 'user_multi', label: 'Recipients' }, message: { type: 'textarea', label: 'Message' }, includeActor: { type: 'boolean', label: 'Also notify the person who caused the event' } } },
    ],
    operators: {},
};
const RULE = {
    _id: 'r1', enabled: true, sentence: 'When a task due date passes, send "Late" to the assignees.', firedCount: 0,
    trigger: { type: 'event', event: 'task.due_date_passed' }, scope: { allProjects: true, projectIds: [] }, conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'notify', config: { recipients: ['task_assignees', GONE], message: 'Late' } }],
};
const PLAN = {
    matched: true, inScope: true, reasons: [], conditions: [], basis: 'Nothing was saved.',
    rule: { id: 'r1', name: 'Overdue', enabled: true, trigger: 'task.due_date_passed' },
    task: { id: 't1', key: 'WEB-7', name: 'Fix login', projectId: 'p1' },
    trigger: { event: 'task.due_date_passed', wouldFire: false, reason: 'not_due_yet' },
    actions: [{
        id: 's1', type: 'action', action: 'notify', label: 'Send a notification', wouldRun: true, params: { recipients: ['task_assignees', GONE], message: 'Late' },
        notify: { wouldNotify: [{ userId: PRIYA, name: 'Priya Shah' }], skipped: [{ userId: GONE, name: 'Gone Person', reason: 'not_a_member' }, { userId: SAM, name: 'Sam Lee', reason: 'no_task_access' }] },
    }],
};
const ok = (data) => Promise.resolve({ data: { status: true, data } });

const openPage = async () => {
    apiRequest.mockImplementation((method, url) => {
        if (url.endsWith('/registry')) return ok(MANIFEST);
        if (url.endsWith('/automations')) return ok([RULE]);
        if (url.endsWith('/compile')) return ok({ sentence: RULE.sentence, errors: [], ambiguities: [], grammar: {} });
        if (url.endsWith('/dry-run')) return ok(PLAN);
        if (url.endsWith('/backtest')) return ok({ windowDays: 30, matched: 4, sample: [], basis: 'server words', basisKey: 'due_date_passed', assignments: [], notifications: [{ stepId: 's1', people: [{ userId: 'task_assignees', name: null }], skipped: [{ userId: GONE, name: 'Gone Person', reason: 'not_a_member' }] }] });
        if (url.endsWith('/find')) return Promise.resolve({ data: [{ _id: 't1', TaskName: 'Fix login', TaskKey: 'WEB-7' }] });
        if (method === 'get') return ok([{ _id: 'p1', ProjectName: 'Web' }]);
        return ok([]);
    });
    wrapper = mount(AutomationsPage, { attachTo: '#app', global: { plugins: [storeWith()], mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};
const clickButton = async (text) => {
    await wrapper.findAll('button').find((b) => b.text() === text).trigger('click');
    await flushPromises();
};
const triggerSelect = () => wrapper.findAll('select.au__slot').find((s) => s.findAll('option').some((o) => o.attributes('value') === 'task.created'));
const actionSelect = () => wrapper.findAll('select.au__slot').find((s) => s.findAll('option').some((o) => o.attributes('value') === 'notify'));

describe('AutomationsPage with the new triggers and a notify step', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('labels the two triggers and the action through i18n, and leaves the others as the registry names them', async () => {
        await openPage();
        await clickButton('Automations.new');
        expect(triggerSelect().findAll('option').map((o) => o.text())).toEqual(['Task is created', 'Automations.trigger_due_date_passed', 'Automations.trigger_subtasks_all_done']);
        expect(actionSelect().findAll('option').map((o) => o.text())).toEqual(['Add a comment', 'Automations.action_notify']);
    });

    it('explains the chosen trigger, and only one that has help', async () => {
        await openPage();
        await clickButton('Automations.new');
        expect(wrapper.find('[data-test="trigger-help"]').exists()).toBe(false);
        await triggerSelect().setValue('task.due_date_passed');
        await flushPromises();
        expect(wrapper.find('[data-test="trigger-help"]').text()).toBe('Automations.trigger_due_date_passed_help');
        await triggerSelect().setValue('task.subtasks_all_done');
        await flushPromises();
        expect(wrapper.find('[data-test="trigger-help"]').text()).toBe('Automations.trigger_subtasks_all_done_help');
    });

    it('draws the notify editor with its help, and starts a new notify step empty', async () => {
        await openPage();
        await clickButton('Automations.new');
        await actionSelect().setValue('notify');
        await flushPromises();
        expect(wrapper.find('[data-test="notify-recipients"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="notify-message"]').element.value).toBe('');
        expect(wrapper.findAll('[data-test="action-help"]').map((p) => p.text())).toEqual(['Automations.action_notify_help']);
        expect(wrapper.findAll('input.au__slot--text:not([data-test="notify-message"])').length).toBe(0);
    });

    it('shows who the dry run would notify, who it would skip and why, and whether the trigger would fire', async () => {
        await openPage();
        await clickButton('Automations.edit');
        await wrapper.find('[data-test="dry-run-project"]').setValue('p1');
        await flushPromises();
        await wrapper.find('[data-test="dry-run-task"]').setValue('t1');
        await wrapper.find('[data-test="dry-run"]').trigger('click');
        await flushPromises();
        const text = wrapper.find('[data-test="dry-run-notify"]').text();
        expect(text).toContain('Automations.notify_would_notify');
        expect(text).toContain('Priya Shah');
        expect(text).toContain('Gone Person');
        expect(text).toContain('Automations.assign_skip_not_a_member');
        expect(text).toContain('Automations.assign_skip_no_task_access');
        expect(wrapper.find('[data-test="dry-run-verdict"]').text()).toBe('Automations.dry_run_not_now');
        expect(wrapper.find('[data-test="dry-run-headline"]').text()).toContain('Automations.dry_run_trigger_not_due_yet');
        expect(wrapper.find('.au__plan-params').exists()).toBe(false);
    });

    it('shows who the backtest would notify and what it counted', async () => {
        await openPage();
        await clickButton('Automations.edit');
        await clickButton('Parity.test_30_days');
        const text = wrapper.find('[data-test="backtest-notify"]').text();
        expect(text).toContain('Automations.notify_backtest_people');
        expect(text).toContain('Automations.notify_role_task_assignees');
        expect(text).toContain('Gone Person');
        expect(wrapper.find('[data-test="backtest-basis"]').text()).toContain('Automations.backtest_basis_due_date_passed');
    });
});

describe('RunHistoryDrawer with a notify step', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('names the trigger and the action through i18n, and says who was notified and who was skipped', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [{
            _id: 'run1', status: 'success', eventType: 'task.due_date_passed', startedAt: new Date().toISOString(),
            entity: { kind: 'task', id: 't1', key: 'WEB-7' }, envelope: { scope: {}, data: { TaskName: 'Fix login' } },
            steps: [{ id: 's1', type: 'action', action: 'notify', output: {
                changed: true,
                notified: [{ userId: PRIYA, name: 'Priya Shah' }],
                skipped: [{ userId: SAM, name: 'Sam Lee', reason: 'rate_limited' }],
            } }],
        }] } });
        wrapper = mount(RunHistoryDrawer, {
            props: { rule: RULE, triggers: MANIFEST.triggers, actions: MANIFEST.actions },
            global: { mocks: { $t: echo } },
        });
        await flushPromises();
        expect(wrapper.find('[data-test="run-trigger"]').text()).toBe('Automations.trigger_due_date_passed');
        const text = wrapper.find('[data-test="run-outcome"]').text();
        expect(text).toContain('Automations.action_notify');
        expect(text).toContain('Automations.notify_notified');
        expect(text).toContain('Priya Shah');
        expect(wrapper.find('[data-test="run-skipped"]').text()).toContain('Automations.assign_skip_rate_limited');
    });
});

describe('the Inbox line for an automation notice', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
    const t = i18n.global.t;
    const passThrough = (text) => text;
    const row = (changeData) => ({ changeType: 'automation_notify', message: '&lt;b&gt;Late&lt;/b&gt;', changeData });

    it('renders the rule name and the text as text, whatever markup they carry', () => {
        const html = renderNotice(row({ ruleName: 'Overdue <img src=x onerror=alert(1)>', text: '<b>Late</b> & waiting' }), { t, changeText: passThrough });
        const shown = mount({ template: '<p v-html="html"></p>', data: () => ({ html }) });
        expect(shown.find('img').exists()).toBe(false);
        expect(shown.find('b').exists()).toBe(false);
        expect(shown.text()).toContain('Overdue <img src=x onerror=alert(1)>');
        expect(shown.text()).toContain('<b>Late</b> & waiting');
    });

    it('falls back to the stored message when the row carries no text', () => {
        expect(renderNotice({ changeType: 'automation_notify', message: 'Fixed text' }, { t, changeText: passThrough })).toBe('Fixed text');
    });

    it('has every string the builder and the Inbox use for these in en.js', () => {
        [
            'trigger_due_date_passed', 'trigger_due_date_passed_help', 'trigger_subtasks_all_done', 'trigger_subtasks_all_done_help',
            'action_notify', 'action_notify_help', 'notify_recipients', 'notify_pick_recipients', 'notify_search', 'notify_no_people', 'notify_message',
            'notify_message_placeholder', 'notify_include_actor', 'notify_role_task_assignees', 'notify_role_task_creator', 'notify_role_task_watchers',
            'notify_would_notify', 'notify_would_notify_nobody', 'notify_backtest_people', 'notify_notified',
            'assign_skip_no_task_access', 'assign_skip_caused_event', 'assign_skip_rate_limited',
            'dry_run_trigger_due', 'dry_run_trigger_not_due_yet', 'dry_run_trigger_no_due_date', 'dry_run_trigger_task_closed',
            'dry_run_trigger_no_subtasks', 'dry_run_trigger_subtasks_open', 'dry_run_trigger_subtasks_done',
            'backtest_basis_touched', 'backtest_basis_due_date_passed', 'backtest_basis_subtasks_all_done',
        ].forEach((key) => expect(typeof en.Automations[key], key).toBe('string'));
        expect(typeof en.Inbox.automation_notify).toBe('string');
    });
});
