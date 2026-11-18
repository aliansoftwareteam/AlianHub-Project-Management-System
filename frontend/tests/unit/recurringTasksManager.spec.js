import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const m = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, route: { params: { id: 'p1' } } }));

vi.mock('vue-toast-notification', () => ({ useToast: () => m.toast }));
vi.mock('vue-router', () => ({ useRoute: () => m.route }));
vi.mock('vuex', async (orig) => ({
    ...(await orig()),
    useStore: () => ({ getters: { 'projectData/allProjects': { data: [] }, 'settings/companyOwnerDetail': { userId: 'owner' } } }),
}));
vi.mock('@/services', () => ({ apiRequest: m.apiRequest }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ u1: { Employee_Name: 'Asha' }, u2: { Employee_Name: 'Ben' } }[id]) }),
}));

import RecurringTasksManager from '@/views/Projects/RecurringTasks/RecurringTasksManager.vue';

const project = { _id: 'p1', ProjectName: 'Alpha', ProjectCode: 'AL', CompanyId: 'c', AssigneeUserId: ['u1', 'u2'] };
const defs = () => [
    { _id: 'r1', name: 'Weekly sync', freq: 'weekly', byweekday: [1], runHour: 9, enabled: true, nextRunAt: '2030-01-07T09:00:00Z', templateSnapshot: { TaskName: 'Sync', AssigneeUserId: ['u2'] }, missedPolicy: 'roll', interval: 1 },
    { _id: 'r2', name: 'Monthly report', freq: 'monthly', interval: 2, monthday: 5, runHour: 14, enabled: false },
];
const respond = (list) => m.apiRequest.mockImplementation((method) => Promise.resolve(method === 'get' ? { data: { status: true, data: list } } : { data: { status: true, statusText: 'done' } }));

let w;
const mountIt = async (props = { projectData: project }) => {
    w = mount(RecurringTasksManager, { props, global: { provide: { selectedProject: ref({}) }, stubs: { ShellIcon: true } } });
    await flushPromises();
    return w;
};
const calls = (method) => m.apiRequest.mock.calls.filter((c) => c[0] === method);
const btn = (text) => w.findAll('button').find((b) => b.text() === text);
const openNew = async () => { await btn('Members.new_rule').trigger('click'); };

beforeEach(() => {
    m.apiRequest.mockReset();
    m.toast.success = vi.fn(); m.toast.error = vi.fn();
    respond(defs());
});

describe('RecurringTasksManager list states', () => {
    it('loads the project rules and shows count and rows', async () => {
        await mountIt();
        expect(calls('get')[0][1]).toBe('/api/v1/recurring-tasks/project/p1');
        expect(w.find('h1').text()).toBe('Members.recurring');
        expect(w.find('.rtx__count').text()).toBe('Members.rules_count');
        const rows = w.findAll('.rtx__row');
        expect(rows).toHaveLength(2);
        expect(rows[0].find('.rtx__row-name').text()).toBe('Weekly sync');
        expect(rows[0].find('.rtx__row-sub').text()).toBe('Members.every Monday 09:00');
        expect(rows[1].find('.rtx__row-sub').text()).toContain('Members.every 2 Members.unit_months');
        expect(rows[1].find('.rtx__row-sub').text()).toContain('14:00');
    });

    it('marks paused rules and shows the next run only for enabled ones', async () => {
        await mountIt();
        const rows = w.findAll('.rtx__row');
        expect(rows[0].find('.rtx__next').text()).toBe('Members.next_run');
        expect(rows[1].classes()).toContain('is-paused');
        expect(rows[1].find('.rtx__next').text()).toBe('Members.rule_paused');
    });

    it('shows the loading key, then the empty state', async () => {
        let done;
        m.apiRequest.mockReturnValue(new Promise((r) => { done = r; }));
        w = mount(RecurringTasksManager, { props: { projectData: project }, global: { provide: { selectedProject: ref({}) }, stubs: { ShellIcon: true } } });
        await flushPromises();
        expect(w.text()).toContain('Members.loading');
        expect(w.find('.ah-empty').exists()).toBe(false);
        done({ data: { status: true, data: [] } });
        await flushPromises();
        expect(w.find('.ah-empty').text()).toBe('Members.no_rules');
    });

    it('falls back to the empty state when loading fails', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        m.apiRequest.mockRejectedValue(new Error('x'));
        await mountIt();
        expect(w.find('.ah-empty').text()).toBe('Members.no_rules');
        expect(w.text()).not.toContain('Members.loading');
        err.mockRestore();
    });

    it('does not fetch without a project', async () => {
        await mountIt({});
        expect(m.apiRequest).not.toHaveBeenCalled();
    });
});

describe('RecurringTasksManager creating a rule', () => {
    it('opens an empty editor with i18n placeholders and hides the empty state', async () => {
        respond([]);
        await mountIt();
        await openNew();
        expect(w.find('.rtx__name-input').attributes('placeholder')).toBe('Members.rule_name_ph');
        expect(w.find('input.ah-input').attributes('placeholder')).toBe('Members.rule_task_ph');
        expect(w.find('.rtx__project').text()).toBe('ALPHA');
        expect(btn('Members.create_rule')).toBeTruthy();
        expect(w.find('.ah-empty').exists()).toBe(false);
        expect(w.find('.rtx__editor .rtx__toggle').exists()).toBe(false);
    });

    it('refuses to save without a name and task name', async () => {
        await mountIt();
        await openNew();
        await btn('Members.create_rule').trigger('click');
        expect(w.find('.ah-field__error').text()).toBe('Members.rule_needs_name');
        expect(calls('post')).toHaveLength(0);
    });

    it('posts the rule, closes the editor and reloads the list', async () => {
        await mountIt();
        await openNew();
        await w.find('.rtx__name-input').setValue('Daily');
        await w.find('input.ah-input').setValue('Water plants');
        await w.findAll('select.rtx__pill')[0].setValue('daily');
        await btn('Members.create_rule').trigger('click');
        await flushPromises();
        const [, url, body] = calls('post')[0];
        expect(url).toBe('/api/v1/recurring-tasks');
        expect(body).toMatchObject({ name: 'Daily', taskName: 'Water plants', freq: 'daily', interval: 1, byweekday: [], missedPolicy: 'skip', assignees: [] });
        expect(w.find('.rtx__editor').exists()).toBe(false);
        expect(calls('get')).toHaveLength(2);
    });

    it('lists project members as assignees for a new rule', async () => {
        await mountIt();
        await openNew();
        const sel = w.findAll('select.rtx__pill').find((s) => s.text().includes('Members.assign_nobody'));
        expect(sel.findAll('option').map((o) => o.text())).toEqual(['Members.assign_nobody', 'Asha', 'Ben']);
    });

    it('shows the server message when saving fails and keeps the editor open', async () => {
        m.apiRequest.mockImplementation((method) => Promise.resolve(method === 'get' ? { data: { status: true, data: [] } } : { data: { status: false, statusText: 'Limit reached' } }));
        await mountIt();
        await openNew();
        await w.find('.rtx__name-input').setValue('A');
        await w.find('input.ah-input').setValue('B');
        await btn('Members.create_rule').trigger('click');
        await flushPromises();
        expect(w.find('.ah-field__error').text()).toBe('Limit reached');
        expect(btn('Members.create_rule').attributes('disabled')).toBeUndefined();
    });

    it('falls back to the generic i18n error when the server gives no message', async () => {
        m.apiRequest.mockImplementation((method) => method === 'get' ? Promise.resolve({ data: { status: true, data: [] } }) : Promise.resolve({ data: { status: false } }));
        await mountIt();
        await openNew();
        await w.find('.rtx__name-input').setValue('A');
        await w.find('input.ah-input').setValue('B');
        await btn('Members.create_rule').trigger('click');
        await flushPromises();
        expect(w.find('.ah-field__error').text()).toBe('Toast.something_went_wrong');
    });

    it('Cancel closes the editor', async () => {
        await mountIt();
        await openNew();
        await btn('Members.cancel').trigger('click');
        expect(w.find('.rtx__editor').exists()).toBe(false);
    });
});

describe('RecurringTasksManager rule form', () => {
    it('changes the fields with the frequency', async () => {
        await mountIt();
        await openNew();
        const freq = w.findAll('select.rtx__pill')[0];
        expect(w.find('input.rtx__num').exists()).toBe(false);
        expect(w.findAll('option').some((o) => o.text() === 'Friday')).toBe(true);
        await freq.setValue('daily');
        expect(w.find('input.rtx__num').exists()).toBe(true);
        await freq.setValue('monthly');
        expect(w.findAll('input.rtx__num')).toHaveLength(2);
        expect(w.text()).toContain('Members.on_day');
    });

    it('previews upcoming dates, and says when there are none', async () => {
        await mountIt();
        await openNew();
        expect(w.findAll('.rtx__chip')).toHaveLength(4);
        expect(w.find('.rtx__chip').classes()).toContain('is-first');
        await w.find('input[type="date"]').setValue('2000-01-01');
        expect(w.findAll('.rtx__chip')).toHaveLength(0);
        expect(w.text()).toContain('Members.no_occurrences');
    });

    it('missed-run choices act as a single-select group', async () => {
        await mountIt();
        await openNew();
        const choices = w.findAll('.rtx__choice');
        expect(choices.map((c) => c.text())).toEqual(['Members.missed_skip', 'Members.missed_create', 'Members.missed_roll']);
        expect(choices[0].classes()).toContain('is-on');
        await choices[2].trigger('click');
        expect(w.findAll('.rtx__choice').map((c) => c.classes().includes('is-on'))).toEqual([false, false, true]);
    });
});

describe('RecurringTasksManager editing', () => {
    const edit = async () => { await w.findAll('.rtx__row-main')[0].trigger('click'); };

    it('loads the rule into the editor, swaps the buttons and hides it from the list', async () => {
        await mountIt();
        await edit();
        expect(w.find('.rtx__name-input').element.value).toBe('Weekly sync');
        expect(w.find('input.ah-input').element.value).toBe('Sync');
        expect(btn('Members.save_rule')).toBeTruthy();
        expect(btn('Members.run_now')).toBeTruthy();
        expect(btn('Members.delete_rule')).toBeTruthy();
        expect(w.findAll('.rtx__row')).toHaveLength(1);
        expect(w.text()).not.toContain('Members.assign_to');
        expect(w.findAll('.rtx__choice')[2].classes()).toContain('is-on');
    });

    it('saves changes with a patch and reloads', async () => {
        await mountIt();
        await edit();
        await w.find('.rtx__name-input').setValue('Renamed');
        await btn('Members.save_rule').trigger('click');
        await flushPromises();
        const [, url, body] = calls('patch')[0];
        expect(url).toBe('/api/v1/recurring-tasks/r1');
        expect(body).toMatchObject({ name: 'Renamed', enabled: true, freq: 'weekly', byweekday: [1], missedPolicy: 'roll' });
        expect(w.find('.rtx__editor').exists()).toBe(false);
    });

    it('Run now confirms with the server message; a failure shows the error toast', async () => {
        await mountIt();
        await edit();
        await btn('Members.run_now').trigger('click');
        await flushPromises();
        expect(m.toast.success).toHaveBeenCalledWith('done', expect.anything());
        m.apiRequest.mockRejectedValueOnce(new Error('x'));
        await btn('Members.run_now').trigger('click');
        await flushPromises();
        expect(m.toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
    });

    it('Delete removes the rule and closes the editor', async () => {
        await mountIt();
        await edit();
        await btn('Members.delete_rule').trigger('click');
        await flushPromises();
        expect(calls('delete')[0][1]).toBe('/api/v1/recurring-tasks/r1');
        expect(w.find('.rtx__editor').exists()).toBe(false);
    });

    it('a failed delete keeps the editor and shows the error toast', async () => {
        await mountIt();
        await edit();
        m.apiRequest.mockRejectedValueOnce(new Error('x'));
        await btn('Members.delete_rule').trigger('click');
        await flushPromises();
        expect(m.toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
        expect(w.find('.rtx__editor').exists()).toBe(true);
    });
});

describe('RecurringTasksManager row toggle and keyboard', () => {
    it('the switch pauses an active rule and resumes a paused one', async () => {
        await mountIt();
        const boxes = w.findAll('.rtx__row input[type="checkbox"]');
        expect(boxes.map((b) => b.element.checked)).toEqual([true, false]);
        await boxes[0].trigger('change');
        await boxes[1].trigger('change');
        expect(calls('patch').map((c) => c[2])).toEqual([{ enabled: false }, { enabled: true }]);
    });

    it('a toggle failure shows the error toast', async () => {
        await mountIt();
        m.apiRequest.mockRejectedValueOnce(new Error('x'));
        await w.find('.rtx__row input[type="checkbox"]').trigger('change');
        await flushPromises();
        expect(m.toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
    });

    it('every action is a native button reachable by Tab, never a div', async () => {
        await mountIt();
        await openNew();
        const actions = w.findAll('.rtx__row-main, .rtx__choice, .rtx__actions button, .rtx__bar button');
        expect(actions.length).toBeGreaterThan(6);
        actions.forEach((a) => {
            expect(a.element.tagName).toBe('BUTTON');
            expect(a.attributes('type')).toBe('button');
            expect(a.attributes('tabindex')).toBeUndefined();
        });
    });

    // the row switches are bare checkboxes inside an empty label, so a screen reader announces no name
    it.fails('gives each row switch an accessible name', async () => {
        await mountIt();
        w.findAll('.rtx__row input[type="checkbox"]').forEach((b) => {
            const label = b.element.closest('label');
            expect(b.attributes('aria-label') || label.getAttribute('aria-label') || label.textContent.trim()).toBeTruthy();
        });
    });
});

describe('RecurringTasksManager i18n', () => {
    const src = readFileSync(resolve(__dirname, '../../src/views/Projects/RecurringTasks/RecurringTasksManager.vue'), 'utf8');

    it('has no bare title, placeholder or aria-label attribute', () => {
        const tpl = src.slice(0, src.indexOf('<script'));
        expect(tpl.match(/\s(?:title|placeholder|aria-label)="[^"]+"/g) || []).toEqual([]);
    });

    // weekday names are a hard-coded English array shown in the select and in each row's schedule
    it.fails('shows weekday names from i18n', async () => {
        await mountIt();
        await openNew();
        expect(w.findAll('option').some((o) => ['Sunday', 'Friday'].includes(o.text()))).toBe(false);
    });
});
