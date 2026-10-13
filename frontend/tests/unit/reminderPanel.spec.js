import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from '@vue/compiler-sfc';
import { defineComponent, h, ref } from 'vue';

const { apiRequest, toast, store, socket, getWasabiImageLink } = vi.hoisted(() => {
    const socketInstance = { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    return {
        apiRequest: vi.fn(),
        toast: { success: vi.fn(), error: vi.fn() },
        getWasabiImageLink: vi.fn(),
        socket: socketInstance,
        store: {
            getters: {
                'users/users': [{ _id: 'user-2', Employee_Name: 'Ben Ito' }],
                'settings/getSocketInstance': socketInstance,
            },
            state: {},
        },
    };
});

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ getWasabiImageLink }) }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));

import ReminderPanel from '@/components/molecules/GeneralReminder/ReminderPanel.vue';

const ModalStub = defineComponent({
    name: 'ReminderModal',
    props: ['modelValue', 'reminder'],
    emits: ['created', 'updated', 'update:modelValue'],
    render() { return h('div', { class: 'modal-stub', 'data-open': String(this.modelValue), 'data-title': this.reminder?.title || '' }); },
});

const future = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
const ROWS = [
    { _id: 'a', userId: 'user-1', title: 'Call Ana', description: 'About the deal', remindAt: future(2), notifyBefore: 10, isDone: false, fired: false, attachments: [{ name: 'brief.pdf', url: 'k/brief.pdf' }] },
    { _id: 'b', userId: 'user-1', title: 'Old thing', remindAt: future(-5), notifyBefore: 60, isDone: false, fired: true },
    { _id: 'c', userId: 'user-1', title: 'Finished', remindAt: future(-9), notifyBefore: -1, isDone: true },
];

let wrapper;
const items = () => wrapper.findAll('.grp__item');
const mountPanel = async (rows = ROWS) => {
    apiRequest.mockImplementation((method) => (method === 'get' ? Promise.resolve({ data: { status: true, data: structuredClone(rows) } }) : Promise.resolve({ data: { status: true } })));
    wrapper = mount(ReminderPanel, {
        props: { modelValue: false },
        global: { stubs: { ReminderModal: ModalStub }, provide: { $userId: ref('user-1'), $companyId: ref('company-1') } },
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
};

beforeEach(() => {
    apiRequest.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    getWasabiImageLink.mockReset().mockResolvedValue('https://signed/brief.pdf');
    Object.values(socket).forEach((fn) => typeof fn === 'function' && fn.mockReset?.());
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
});

describe('ReminderPanel states', () => {
    it('renders nothing while closed and does not fetch', () => {
        wrapper = mount(ReminderPanel, { props: { modelValue: false }, global: { stubs: { ReminderModal: ModalStub } } });
        expect(wrapper.find('.grp__panel').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('shows the loading text until the list arrives', async () => {
        let finish;
        apiRequest.mockReturnValue(new Promise((done) => { finish = done; }));
        wrapper = mount(ReminderPanel, { props: { modelValue: false }, global: { stubs: { ReminderModal: ModalStub } } });
        await wrapper.setProps({ modelValue: true });
        expect(wrapper.get('.grp__state').text()).toBe('Reminders.loading');
        finish({ data: { status: true, data: [ROWS[0]] } });
        await flushPromises();
        expect(wrapper.find('.grp__state').exists()).toBe(false);
        expect(items()).toHaveLength(1);
    });

    it('shows the empty message for an empty list', async () => {
        await mountPanel([]);
        expect(wrapper.get('.grp__state--empty').text()).toBe('Reminders.empty');
    });

    it('falls back to the empty message when loading fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        wrapper = mount(ReminderPanel, { props: { modelValue: true }, global: { stubs: { ReminderModal: ModalStub } } });
        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });
        await flushPromises();
        expect(wrapper.find('.grp__state--empty').exists()).toBe(true);
        expect(wrapper.find('.grp__state').text()).not.toBe('Reminders.loading');
    });

    it('lists reminders with title, description, notify text, status and marks overdue/done rows', async () => {
        await mountPanel();
        expect(wrapper.get('.grp__title').text()).toBe('Reminders.panel_title');
        expect(items()).toHaveLength(3);
        const [soon, late, done] = items();
        expect(soon.get('.grp__itemtitle').text()).toBe('Call Ana');
        expect(soon.get('.grp__itemdesc').text()).toBe('About the deal');
        expect(soon.get('.grp__when').text()).toMatch(/^Reminders\.today, /);
        expect(soon.get('.grp__notify').text()).toBe('10 Reminders.minutes_before');
        expect(soon.classes()).not.toContain('is-overdue');
        expect(late.classes()).toContain('is-overdue');
        expect(late.get('.grp__notify').text()).toBe('Reminders.one_hour_before');
        expect(late.get('.grp__fired').text()).toBe('Reminders.sent');
        expect(done.classes()).toContain('is-done');
        expect(done.classes()).not.toContain('is-overdue');
        expect(done.get('.grp__notify').text()).toBe('Reminders.dont_notify');
    });

    it('requests the default upcoming filter on open', async () => {
        await mountPanel();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/general-reminders?filter=upcoming');
    });
});

describe('ReminderPanel filters', () => {
    it('shows four labelled filters with upcoming active', async () => {
        await mountPanel();
        const buttons = wrapper.findAll('.grp__filter');
        expect(buttons.map((b) => b.text())).toEqual(['Reminders.filter_upcoming', 'Reminders.filter_done', 'Reminders.filter_all', 'Reminders.filter_assigned']);
        expect(buttons.map((b) => b.classes().includes('is-active'))).toEqual([true, false, false, false]);
    });

    it.each([[1, '?filter=done'], [2, ''], [3, '?filter=assigned']])('filter button %i fetches %s', async (index, query) => {
        await mountPanel();
        apiRequest.mockClear();
        await wrapper.findAll('.grp__filter')[index].trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', `/api/v1/general-reminders${query}`);
        expect(wrapper.findAll('.grp__filter')[index].classes()).toContain('is-active');
    });

    it('does not refetch when the active filter is clicked again', async () => {
        await mountPanel();
        apiRequest.mockClear();
        await wrapper.findAll('.grp__filter')[0].trigger('click');
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('the assigned view is read-only: no check, no menu, shows recipient and pending state', async () => {
        await mountPanel();
        apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: [
            { _id: 'x', userId: 'user-2', title: 'Sent to Ben', remindAt: future(3), fired: false },
            { _id: 'y', userId: 'user-9', title: 'Sent to ghost', remindAt: future(3), fired: true },
        ] } }));
        await wrapper.findAll('.grp__filter')[3].trigger('click');
        await flushPromises();
        expect(wrapper.find('button.grp__check').exists()).toBe(false);
        expect(wrapper.find('.grp__check--static').attributes('aria-hidden')).toBe('true');
        expect(wrapper.find('.grp__menubtn').exists()).toBe(false);
        const [first, second] = items();
        expect(first.get('.grp__for').text()).toBe('Reminders.for_user');
        expect(first.get('.grp__pending').text()).toBe('Reminders.pending');
        expect(second.find('.grp__pending').exists()).toBe(false);
        expect(second.get('.grp__fired').text()).toBe('Reminders.sent');
    });
});

describe('ReminderPanel actions', () => {
    it('the check button says what it does and completes the reminder, dropping it from the upcoming list', async () => {
        await mountPanel();
        const check = items()[0].get('.grp__check');
        expect(check.attributes('title')).toBe('Reminders.mark_done');
        expect(items()[2].get('.grp__check').attributes('title')).toBe('Reminders.mark_undone');
        apiRequest.mockClear();
        apiRequest.mockImplementation((method) => Promise.resolve({ data: { status: true, data: method === 'get' ? [ROWS[1], ROWS[2]] : undefined } }));
        await check.trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('patch', '/api/v1/general-reminders/a', { isDone: true });
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/general-reminders?filter=upcoming');
        expect(items().map((i) => i.get('.grp__itemtitle').text())).toEqual(['Old thing', 'Finished']);
    });

    it('shows an error toast and keeps the row unchanged when completing fails', async () => {
        await mountPanel();
        apiRequest.mockResolvedValue({ data: { status: false } });
        await items()[0].get('.grp__check').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Reminders.update_failed', expect.anything());
        expect(items()[0].classes()).not.toContain('is-done');
    });

    it('shows an error toast when completing throws', async () => {
        await mountPanel();
        apiRequest.mockRejectedValue(new Error('boom'));
        await items()[0].get('.grp__check').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Reminders.update_failed', expect.anything());
    });

    it('the options button opens a menu with edit, done, snooze and delete in i18n copy; clicking the panel closes it', async () => {
        await mountPanel();
        const button = items()[0].get('.grp__menubtn');
        expect(button.attributes('title')).toBe('Reminders.options');
        await button.trigger('click');
        const menu = wrapper.get('.grp__menu');
        expect(menu.findAll('.grp__menuitem').map((m) => m.text())).toEqual([
            'Reminders.edit', 'Reminders.mark_done', 'Reminders.snooze_10m', 'Reminders.snooze_1h', 'Reminders.snooze_1d', 'Reminders.delete',
        ]);
        expect(menu.get('.grp__menulabel').text()).toBe('Reminders.snooze');
        await wrapper.get('.grp__title').trigger('click');
        expect(wrapper.find('.grp__menu').exists()).toBe(false);
        await button.trigger('click');
        await button.trigger('click');
        expect(wrapper.find('.grp__menu').exists()).toBe(false);
    });

    it('closes the menu when the list scrolls', async () => {
        await mountPanel();
        await items()[0].get('.grp__menubtn').trigger('click');
        await wrapper.get('.grp__list').trigger('scroll');
        expect(wrapper.find('.grp__menu').exists()).toBe(false);
    });

    it('snoozing pushes the time out, confirms and reloads', async () => {
        await mountPanel();
        await items()[0].get('.grp__menubtn').trigger('click');
        apiRequest.mockClear();
        apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
        const before = Date.now();
        await wrapper.findAll('.grp__menuitem--sub')[1].trigger('click');
        await flushPromises();
        const [method, url, body] = apiRequest.mock.calls[0];
        expect([method, url]).toEqual(['patch', '/api/v1/general-reminders/a']);
        expect(new Date(body.remindAt).getTime() - before).toBeGreaterThanOrEqual(3600_000 - 50);
        expect(toast.success).toHaveBeenCalledWith('Reminders.snoozed', expect.anything());
        expect(wrapper.find('.grp__menu').exists()).toBe(false);
    });

    it('reports a failed snooze', async () => {
        await mountPanel();
        await items()[0].get('.grp__menubtn').trigger('click');
        apiRequest.mockResolvedValue({ data: { status: false } });
        await wrapper.findAll('.grp__menuitem--sub')[0].trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Reminders.update_failed', expect.anything());
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('deleting removes the row and confirms', async () => {
        await mountPanel();
        await items()[1].get('.grp__menubtn').trigger('click');
        apiRequest.mockClear();
        apiRequest.mockResolvedValue({ data: { status: true } });
        await wrapper.get('.grp__menuitem--danger').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('delete', '/api/v1/general-reminders/b');
        expect(items().map((i) => i.get('.grp__itemtitle').text())).toEqual(['Call Ana', 'Finished']);
        expect(toast.success).toHaveBeenCalledWith('Reminders.deleted', expect.anything());
    });

    it('keeps the row and reports when delete is refused or throws', async () => {
        await mountPanel();
        await items()[1].get('.grp__menubtn').trigger('click');
        apiRequest.mockResolvedValue({ data: { status: false } });
        await wrapper.get('.grp__menuitem--danger').trigger('click');
        await flushPromises();
        apiRequest.mockRejectedValue(new Error('x'));
        await wrapper.get('.grp__menuitem--danger').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledTimes(2);
        expect(toast.error).toHaveBeenCalledWith('Reminders.delete_failed', expect.anything());
        expect(items()).toHaveLength(3);
    });

    it('Edit opens the dialog prefilled with that reminder; Add opens it blank', async () => {
        await mountPanel();
        expect(wrapper.get('.modal-stub').attributes('data-open')).toBe('false');
        await items()[0].get('.grp__menubtn').trigger('click');
        await wrapper.findAll('.grp__menuitem')[0].trigger('click');
        expect(wrapper.get('.modal-stub').attributes()).toMatchObject({ 'data-open': 'true', 'data-title': 'Call Ana' });
        wrapper.getComponent(ModalStub).vm.$emit('update:modelValue', false);
        await flushPromises();
        await wrapper.get('.grp__add').trigger('click');
        expect(wrapper.get('.modal-stub').attributes()).toMatchObject({ 'data-open': 'true', 'data-title': '' });
        expect(wrapper.get('.grp__add').text()).toBe('+ Reminders.add');
    });

    it('a created reminder reloads the list and leaves the done filter', async () => {
        await mountPanel();
        await wrapper.findAll('.grp__filter')[1].trigger('click');
        await flushPromises();
        apiRequest.mockClear();
        apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
        wrapper.getComponent(ModalStub).vm.$emit('created');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/general-reminders?filter=upcoming');
        expect(wrapper.findAll('.grp__filter')[0].classes()).toContain('is-active');
    });

    it('an updated reminder reloads the list', async () => {
        await mountPanel();
        apiRequest.mockClear();
        apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
        wrapper.getComponent(ModalStub).vm.$emit('updated');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v1/general-reminders?filter=upcoming');
    });
});

describe('ReminderPanel attachments', () => {
    it('opens an attachment through a freshly signed link', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        await mountPanel();
        const file = wrapper.get('.grp__file');
        expect(file.attributes('title')).toBe('brief.pdf');
        await file.trigger('click');
        await flushPromises();
        expect(getWasabiImageLink).toHaveBeenCalledWith('company-1', 'k/brief.pdf');
        expect(open).toHaveBeenCalledWith('https://signed/brief.pdf', '_blank', 'noopener');
        expect(file.attributes('disabled')).toBeUndefined();
    });

    it('disables the file button while the link is being fetched', async () => {
        vi.spyOn(window, 'open').mockImplementation(() => null);
        let finish;
        getWasabiImageLink.mockReturnValue(new Promise((done) => { finish = done; }));
        await mountPanel();
        await wrapper.get('.grp__file').trigger('click');
        expect(wrapper.get('.grp__file').attributes('disabled')).toBeDefined();
        finish('https://x');
        await flushPromises();
        expect(wrapper.get('.grp__file').attributes('disabled')).toBeUndefined();
    });

    it.each([['no link', () => getWasabiImageLink.mockResolvedValue('')], ['a throw', () => getWasabiImageLink.mockRejectedValue(new Error('x'))]])('tells the person when the file cannot be opened (%s)', async (_, arrange) => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        arrange();
        await mountPanel();
        await wrapper.get('.grp__file').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Reminders.file_open_failed', expect.anything());
        expect(open).not.toHaveBeenCalled();
    });
});

describe('ReminderPanel closing and live updates', () => {
    it('the close button has an accessible name and asks to close; the backdrop does too, the panel does not', async () => {
        await mountPanel();
        expect(wrapper.get('.grp__close').attributes('aria-label')).toBe('Reminders.close');
        await wrapper.get('.grp__panel').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        await wrapper.get('.grp__close').trigger('click');
        await wrapper.get('.grp__overlay').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toEqual([[false], [false]]);
    });

    it('joins the reminder stream for the user and applies pushed changes', async () => {
        await mountPanel();
        expect(socket.emit).toHaveBeenCalledWith('joinGeneralReminder', { uid: 'user-1', socketId: 'sock-1' });
        const handler = socket.on.mock.calls.find(([name]) => name === 'generalReminderUpdate')[1];
        handler({ type: 'insert', fullDocument: { _id: 'n', userId: 'user-1', title: 'Pushed', remindAt: future(1), isDone: false } });
        await flushPromises();
        expect(items().map((i) => i.get('.grp__itemtitle').text())).toContain('Pushed');
        handler({ type: 'update', fullDocument: { _id: 'n', userId: 'user-1', title: 'Pushed v2', remindAt: future(1), isDone: false } });
        await flushPromises();
        expect(items().map((i) => i.get('.grp__itemtitle').text())).toContain('Pushed v2');
        handler({ type: 'update', fullDocument: { _id: 'n', userId: 'user-1', title: 'Pushed v2', remindAt: future(1), isDone: true } });
        await flushPromises();
        expect(items().map((i) => i.get('.grp__itemtitle').text())).not.toContain('Pushed v2');
        handler({ type: 'delete', fullDocument: { _id: 'a' } });
        await flushPromises();
        expect(items().map((i) => i.get('.grp__itemtitle').text())).not.toContain('Call Ana');
    });

    it('ignores pushed reminders that belong to someone else', async () => {
        await mountPanel();
        const handler = socket.on.mock.calls.find(([name]) => name === 'generalReminderUpdate')[1];
        handler({ type: 'insert', fullDocument: { _id: 'z', userId: 'user-2', title: 'Not mine', remindAt: future(1) } });
        await flushPromises();
        expect(items()).toHaveLength(3);
    });
});

describe('ReminderPanel copy', () => {
    const source = readFileSync(resolve(__dirname, '../../src/components/molecules/GeneralReminder/ReminderPanel.vue'), 'utf8');
    const visibleAttrs = ['title', 'placeholder', 'alt', 'aria-label', 'label'];

    const bareCopy = () => {
        const found = [];
        const walk = (node) => {
            if (node.type === 2 && /\p{L}|\d/u.test(node.content)) found.push(node.content.trim());
            (node.props || []).forEach((p) => {
                if (p.type === 6 && visibleAttrs.includes(p.name) && p.value?.content) found.push(`${p.name}="${p.value.content}"`);
            });
            (node.children || []).forEach((c) => typeof c === 'object' && walk(c));
        };
        walk(parse(source).descriptor.template.ast);
        return found;
    };

    // The options icon has the hard-coded English alt "options" while its button already carries the translated title.
    it.fails('has no hard-coded visible text or attributes in the template', () => {
        expect(bareCopy()).toEqual([]);
    });

    it('the only bare copy is the options icon alt', () => {
        expect(bareCopy()).toEqual(['alt="options"']);
    });
});
