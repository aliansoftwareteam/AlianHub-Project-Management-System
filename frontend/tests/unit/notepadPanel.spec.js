import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/services', () => api);
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/components/molecules/Notepad/ConvertNoteToTask.vue', () => ({
    default: { name: 'ConvertNoteToTask', props: ['note'], emits: ['close', 'converted'], template: '<div class="convert"><b>{{ note.title }}</b><button class="cv-done" @click="$emit(\'converted\', { taskId: 77 })">done</button><button class="cv-close" @click="$emit(\'close\')">x</button></div>' }
}));

import NotepadPanel from '@/components/molecules/Notepad/NotepadPanel.vue';

const source = readFileSync(resolve(__dirname, '../../src/components/molecules/Notepad/NotepadPanel.vue'), 'utf8');

const notesOf = () => [
    { _id: 'n1', title: 'Groceries', content: 'milk\neggs', updatedAt: '2026-10-01T10:00:00Z' },
    { _id: 'n2', title: '', content: 'Call the bank\nabout the card', updatedAt: '2026-10-02T10:00:00Z' },
    { _id: 'n3', title: 'Zebra ideas', content: '', updatedAt: '2026-09-01T10:00:00Z' }
];
const ok = (data) => Promise.resolve({ data: { status: true, data } });

let wrapper;
const routes = {};
const setRoutes = (over = {}) => {
    Object.assign(routes, { get: () => ok(notesOf()), post: () => ok({ _id: 'new', title: '', content: '' }), patch: () => ok({}), delete: () => ok({}) }, over);
};
const mountPanel = async (props = {}) => {
    wrapper = mount(NotepadPanel, { props: { modelValue: false, ...props }, attachTo: document.body, global: { stubs: { Teleport: true } } });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    return wrapper;
};
const calls = (method) => api.apiRequest.mock.calls.filter((c) => c[0] === method);
const rowTitles = () => wrapper.findAll('.np__rtitle').map((r) => r.text());
const titleBtn = (title) => wrapper.findAll('button').find((b) => b.attributes('title') === title);
const rowOf = (text) => wrapper.findAll('.np__row').find((r) => r.text().includes(text));

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api.apiRequest.mockReset();
    setRoutes();
    api.apiRequest.mockImplementation((method, url, body) => routes[method](url, body));
    toast.success.mockClear();
    toast.error.mockClear();
});
afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('NotepadPanel visibility and loading', () => {
    it('renders nothing while closed and does not fetch', async () => {
        wrapper = mount(NotepadPanel, { props: { modelValue: false } });
        expect(wrapper.find('.np__pop').exists()).toBe(false);
        expect(api.apiRequest).not.toHaveBeenCalled();
    });

    it('shows the loading line until the notes arrive', async () => {
        let release;
        setRoutes({ get: () => new Promise((r) => { release = () => r({ data: { status: true, data: notesOf() } }); }) });
        wrapper = mount(NotepadPanel, { props: { modelValue: false }, attachTo: document.body });
        await wrapper.setProps({ modelValue: true });
        expect(wrapper.get('.np__state').text()).toBe('Notepad.loading');
        release();
        await flushPromises();
        expect(wrapper.find('.np__state').exists()).toBe(false);
        expect(wrapper.findAll('.np__row')).toHaveLength(3);
    });

    it('titles the header and labels every header control from i18n keys', async () => {
        await mountPanel();
        expect(wrapper.get('.np__htitle').text()).toBe('Notepad.title');
        expect(['Notepad.search', 'Notepad.options', 'Reminders.close'].every((t) => titleBtn(t))).toBe(true);
        expect(wrapper.get('.np__new').text()).toContain('Notepad.add');
    });

    it('shows the empty message when there are no notes', async () => {
        setRoutes({ get: () => ok([]) });
        await mountPanel();
        expect(wrapper.get('.np__state').text()).toBe('Notepad.empty');
        expect(wrapper.get('.np__new').text()).toContain('Notepad.add');
    });

    it('shows the empty message when the server says the request did not succeed', async () => {
        setRoutes({ get: () => Promise.resolve({ data: { status: false } }) });
        await mountPanel();
        expect(wrapper.get('.np__state').text()).toBe('Notepad.empty');
    });

    // A failed fetch ends the loading line and shows the same text as "no notes", so the person cannot tell.
    it.fails('does not show the "no notes" message when the notes could not be fetched', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        setRoutes({ get: () => Promise.reject(new Error('offline')) });
        await mountPanel();
        expect(wrapper.find('.np__state').exists() && wrapper.get('.np__state').text()).not.toBe('Notepad.empty');
    });

    it('closes from the close button and from a click on the backdrop, but not from a click inside', async () => {
        await mountPanel();
        await wrapper.get('.np__pop').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        await titleBtn('Reminders.close').trigger('click');
        expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([false]);
        await wrapper.get('.np__overlay').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toHaveLength(2);
    });
});

describe('NotepadPanel list', () => {
    it('lists the newest note first with a label and one-line preview', async () => {
        await mountPanel();
        expect(rowTitles()).toEqual(['Call the bank', 'Groceries', 'Zebra ideas']);
        expect(wrapper.findAll('.np__rpreview').map((p) => p.text())).toEqual(['Call the bank about the card', 'milk eggs', 'Notepad.no_content']);
    });

    it('labels a note with no title and no content as untitled', async () => {
        setRoutes({ get: () => ok([{ _id: 'n9', title: '  ', content: '' }]) });
        await mountPanel();
        expect(rowTitles()).toEqual(['Notepad.untitled']);
    });

    it('cuts a long preview at 120 characters', async () => {
        setRoutes({ get: () => ok([{ _id: 'n9', title: 'Long', content: 'x'.repeat(200) }]) });
        await mountPanel();
        expect(wrapper.get('.np__rpreview').text()).toBe(`${'x'.repeat(120)}…`);
    });

    it('labels each row action from i18n keys', async () => {
        await mountPanel();
        const titles = wrapper.get('.np__row').findAll('.np__ra').map((b) => b.attributes('title'));
        expect(titles).toEqual(['Notepad.edit', 'Notepad.convert_action', 'Notepad.archive', 'Notepad.delete']);
    });

    it('sorts by name when the recent toggle is turned off', async () => {
        setRoutes({ get: () => ok([{ _id: 'a', title: 'Beta', content: '', updatedAt: '2026-10-05' }, { _id: 'b', title: 'Alpha', content: '', updatedAt: '2026-01-05' }]) });
        await mountPanel();
        expect(rowTitles()).toEqual(['Beta', 'Alpha']);
        await titleBtn('Notepad.options').trigger('click');
        expect(wrapper.get('.np__hmlabel').text()).toBe('Notepad.sort_recent');
        const toggle = wrapper.get('.np__switch');
        expect(toggle.attributes('aria-pressed')).toBe('true');
        await toggle.trigger('click');
        expect(toggle.attributes('aria-pressed')).toBe('false');
        expect(rowTitles()).toEqual(['Alpha', 'Beta']);
    });

    it('closes the options menu when the list is clicked elsewhere', async () => {
        await mountPanel();
        await titleBtn('Notepad.options').trigger('click');
        expect(wrapper.find('.np__hmenu').exists()).toBe(true);
        await wrapper.get('.np__pop').trigger('click');
        expect(wrapper.find('.np__hmenu').exists()).toBe(false);
    });
});

describe('NotepadPanel search', () => {
    it('is hidden until opened, then filters on title and content', async () => {
        await mountPanel();
        expect(wrapper.find('.np__searchinput').exists()).toBe(false);
        await titleBtn('Notepad.search').trigger('click');
        expect(wrapper.get('.np__searchinput').attributes('placeholder')).toBe('Notepad.search_placeholder');
        expect(titleBtn('Notepad.search').classes()).toContain('is-on');
        await wrapper.get('.np__searchinput').setValue('BANK');
        expect(rowTitles()).toEqual(['Call the bank']);
        await wrapper.get('.np__searchinput').setValue('milk');
        expect(rowTitles()).toEqual(['Groceries']);
    });

    it('says nothing matched, and clears the filter when search is closed', async () => {
        await mountPanel();
        await titleBtn('Notepad.search').trigger('click');
        await wrapper.get('.np__searchinput').setValue('zzz');
        expect(wrapper.get('.np__state').text()).toBe('Notepad.no_results');
        await titleBtn('Notepad.search').trigger('click');
        expect(wrapper.findAll('.np__row')).toHaveLength(3);
    });
});

describe('NotepadPanel archive view', () => {
    const showArchived = async () => {
        await titleBtn('Notepad.options').trigger('click');
        await wrapper.get('.np__hmitem').trigger('click');
        await flushPromises();
    };

    it('switches to archived notes with a restore action and its own empty text', async () => {
        await mountPanel();
        setRoutes({ get: (url) => ok(url.includes('archived=1') ? [] : notesOf()) });
        await titleBtn('Notepad.options').trigger('click');
        expect(wrapper.get('.np__hmitem').text()).toBe('Notepad.show_archived');
        await wrapper.get('.np__hmitem').trigger('click');
        await flushPromises();
        expect(calls('get').pop()[1]).toContain('archived=1');
        expect(wrapper.get('.np__state').text()).toBe('Notepad.empty_archived');
        await titleBtn('Notepad.options').trigger('click');
        expect(wrapper.get('.np__hmitem').text()).toBe('Notepad.show_active');
    });

    it('offers restore instead of archive on archived notes and removes the note when restored', async () => {
        await mountPanel();
        await showArchived();
        const row = wrapper.get('.np__row');
        expect(row.findAll('.np__ra')[2].attributes('title')).toBe('Notepad.restore');
        const before = rowTitles().length;
        await row.findAll('.np__ra')[2].trigger('click');
        await flushPromises();
        expect(rowTitles()).toHaveLength(before - 1);
        expect(toast.success).toHaveBeenCalledWith('Notepad.restored_toast', expect.anything());
    });

    it('archives a note from the list and says so', async () => {
        await mountPanel();
        await rowOf('Groceries').findAll('.np__ra')[2].trigger('click');
        await flushPromises();
        expect(rowTitles()).toEqual(['Call the bank', 'Zebra ideas']);
        expect(toast.success).toHaveBeenCalledWith('Notepad.archived_toast', expect.anything());
    });

    it('keeps the note and reports an error when archiving is refused', async () => {
        setRoutes({ patch: () => Promise.resolve({ data: { status: false } }) });
        await mountPanel();
        await rowOf('Groceries').findAll('.np__ra')[2].trigger('click');
        await flushPromises();
        expect(rowTitles()).toHaveLength(3);
        expect(toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
    });
});

describe('NotepadPanel adding', () => {
    it('creates a note and opens it straight in the editor with the title focused', async () => {
        await mountPanel();
        await wrapper.get('.np__new').trigger('click');
        await flushPromises();
        expect(wrapper.get('.np__htitleinput').attributes('placeholder')).toBe('Notepad.title_placeholder');
        expect(wrapper.get('.np__etext').attributes('placeholder')).toBe('Notepad.editor_placeholder');
        expect(document.activeElement).toBe(wrapper.get('.np__htitleinput').element);
    });

    it('turns the add button off while the note is being created', async () => {
        let release;
        setRoutes({ post: () => new Promise((r) => { release = () => r({ data: { status: true, data: { _id: 'new', title: '', content: '' } } }); }) });
        await mountPanel();
        await wrapper.get('.np__new').trigger('click');
        expect(wrapper.get('.np__new').attributes('disabled')).toBeDefined();
        release();
        await flushPromises();
        expect(wrapper.find('.np__new').exists()).toBe(false);
    });

    it('shows the server message as an error when creation is refused', async () => {
        setRoutes({ post: () => Promise.resolve({ data: { status: false, statusText: 'Limit reached' } }) });
        await mountPanel();
        await wrapper.get('.np__new').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Limit reached', expect.anything());
        expect(wrapper.find('.np__htitleinput').exists()).toBe(false);
        expect(wrapper.get('.np__new').attributes('disabled')).toBeUndefined();
    });

    it('falls back to a generic error when the refusal has no message', async () => {
        setRoutes({ post: () => Promise.resolve({ data: { status: false } }) });
        await mountPanel();
        await wrapper.get('.np__new').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
    });
});

describe('NotepadPanel editor', () => {
    const openGroceries = async () => {
        await rowOf('Groceries').trigger('click');
        await flushPromises();
    };

    it('opens a note with its title and content and focuses the body', async () => {
        await mountPanel();
        await openGroceries();
        expect(wrapper.get('.np__htitleinput').element.value).toBe('Groceries');
        expect(wrapper.get('.np__etext').element.value).toBe('milk\neggs');
        expect(document.activeElement).toBe(wrapper.get('.np__etext').element);
        expect(wrapper.find('.np__list').exists()).toBe(false);
        expect(wrapper.find('.np__htitle').exists()).toBe(false);
    });

    it('opens from the edit action too', async () => {
        await mountPanel();
        await rowOf('Groceries').findAll('.np__ra')[0].trigger('click');
        expect(wrapper.get('.np__htitleinput').element.value).toBe('Groceries');
    });

    it('moves from the title to the body on Enter', async () => {
        await mountPanel();
        await openGroceries();
        wrapper.get('.np__htitleinput').element.focus();
        await wrapper.get('.np__htitleinput').trigger('keyup.enter');
        expect(document.activeElement).toBe(wrapper.get('.np__etext').element);
    });

    it('shows saving while an edit is pending and saved once it is stored', async () => {
        await mountPanel();
        await openGroceries();
        expect(wrapper.get('.np__saved').text()).toBe('Notepad.saved');
        await wrapper.get('.np__etext').setValue('milk, eggs, tea');
        expect(wrapper.get('.np__saved').text()).toBe('Notepad.saving');
        expect(calls('patch')).toHaveLength(0);
        vi.advanceTimersByTime(700);
        await flushPromises();
        expect(wrapper.get('.np__saved').text()).toBe('Notepad.saved');
        expect(calls('patch')[0][2]).toEqual({ title: 'Groceries', content: 'milk, eggs, tea' });
    });

    it('saves once for a burst of typing', async () => {
        await mountPanel();
        await openGroceries();
        for (const text of ['a', 'ab', 'abc']) {
            await wrapper.get('.np__etext').setValue(text);
            vi.advanceTimersByTime(200);
        }
        vi.advanceTimersByTime(700);
        await flushPromises();
        expect(calls('patch')).toHaveLength(1);
        expect(calls('patch')[0][2].content).toBe('abc');
    });

    it('saves at once when the field loses focus', async () => {
        await mountPanel();
        await openGroceries();
        await wrapper.get('.np__htitleinput').setValue('Shopping');
        await wrapper.get('.np__htitleinput').trigger('blur');
        await flushPromises();
        expect(calls('patch')[0][2].title).toBe('Shopping');
        expect(wrapper.get('.np__saved').text()).toBe('Notepad.saved');
    });

    it('goes back to the list with the edited title, saving first', async () => {
        await mountPanel();
        await openGroceries();
        await wrapper.get('.np__htitleinput').setValue('Shopping');
        await titleBtn('Notepad.back').trigger('click');
        await flushPromises();
        expect(rowTitles()).toContain('Shopping');
        expect(wrapper.find('.np__htitleinput').exists()).toBe(false);
        expect(calls('patch').some((c) => c[2].title === 'Shopping')).toBe(true);
    });

    it('limits the title to 250 characters', async () => {
        await mountPanel();
        await openGroceries();
        expect(wrapper.get('.np__htitleinput').attributes('maxlength')).toBe('250');
    });

    it('labels the editor footer actions from i18n keys', async () => {
        await mountPanel();
        await openGroceries();
        expect(wrapper.findAll('.np__eaction').map((b) => b.attributes('title'))).toEqual(['Notepad.convert_action', 'Notepad.archive', 'Notepad.delete']);
    });

    it('archives the open note and returns to the list', async () => {
        await mountPanel();
        await openGroceries();
        await wrapper.findAll('.np__eaction')[1].trigger('click');
        await flushPromises();
        expect(wrapper.find('.np__htitleinput').exists()).toBe(false);
        expect(rowTitles()).not.toContain('Groceries');
    });

    // A note is clickable and editable but the row is a div with a click handler and no focus stop, so it cannot be opened with the keyboard.
    it.fails('lets a note row be opened from the keyboard', async () => {
        await mountPanel();
        const row = wrapper.get('.np__row');
        expect(row.element.tagName === 'BUTTON' || row.attributes('tabindex') === '0').toBe(true);
    });
});

describe('NotepadPanel delete', () => {
    it('asks first, then removes the note', async () => {
        await mountPanel();
        await rowOf('Groceries').findAll('.np__ra')[3].trigger('click');
        expect(wrapper.get('.np__ctitle').text()).toBe('Notepad.confirm_delete_title');
        expect(wrapper.get('.np__cdesc').text()).toBe('Notepad.confirm_delete_desc');
        expect(wrapper.findAll('.np__cbtn').map((b) => b.text())).toEqual(['Projects.cancel', 'Notepad.delete']);
        expect(rowTitles()).toHaveLength(3);
        await wrapper.get('.np__cbtn--danger').trigger('click');
        await flushPromises();
        expect(wrapper.find('.np__confirm').exists()).toBe(false);
        expect(rowTitles()).toEqual(['Call the bank', 'Zebra ideas']);
    });

    it('keeps the note when the person cancels, or clicks outside the dialog', async () => {
        await mountPanel();
        await rowOf('Groceries').findAll('.np__ra')[3].trigger('click');
        await wrapper.findAll('.np__cbtn')[0].trigger('click');
        expect(wrapper.find('.np__confirm').exists()).toBe(false);
        await rowOf('Groceries').findAll('.np__ra')[3].trigger('click');
        await wrapper.get('.np__confirmwrap').trigger('click');
        expect(wrapper.find('.np__confirm').exists()).toBe(false);
        expect(rowTitles()).toHaveLength(3);
    });

    it('keeps the note and reports the server message when deletion is refused', async () => {
        setRoutes({ delete: () => Promise.resolve({ data: { status: false, statusText: 'Not yours' } }) });
        await mountPanel();
        await rowOf('Groceries').findAll('.np__ra')[3].trigger('click');
        await wrapper.get('.np__cbtn--danger').trigger('click');
        await flushPromises();
        expect(rowTitles()).toHaveLength(3);
        expect(toast.error).toHaveBeenCalledWith('Not yours', expect.anything());
    });

    it('returns to the list when the open note is deleted', async () => {
        await mountPanel();
        await rowOf('Groceries').trigger('click');
        await wrapper.get('.np__eaction--danger').trigger('click');
        await wrapper.get('.np__cbtn--danger').trigger('click');
        await flushPromises();
        expect(wrapper.find('.np__htitleinput').exists()).toBe(false);
        expect(rowTitles()).toEqual(['Call the bank', 'Zebra ideas']);
    });

    it('does not save a pending edit of a note that was deleted', async () => {
        await mountPanel();
        await rowOf('Groceries').trigger('click');
        await wrapper.get('.np__etext').setValue('changed');
        await wrapper.get('.np__eaction--danger').trigger('click');
        await wrapper.get('.np__cbtn--danger').trigger('click');
        await flushPromises();
        vi.advanceTimersByTime(2000);
        await flushPromises();
        expect(calls('patch')).toHaveLength(0);
    });
});

describe('NotepadPanel convert to task', () => {
    it('opens the converter for the note and closes it again', async () => {
        await mountPanel();
        await rowOf('Groceries').findAll('.np__ra')[1].trigger('click');
        expect(wrapper.get('.convert b').text()).toBe('Groceries');
        await wrapper.get('.cv-close').trigger('click');
        expect(wrapper.find('.convert').exists()).toBe(false);
    });

    it('keeps the note after conversion', async () => {
        await mountPanel();
        await rowOf('Groceries').findAll('.np__ra')[1].trigger('click');
        await wrapper.get('.cv-done').trigger('click');
        await flushPromises();
        expect(wrapper.find('.convert').exists()).toBe(false);
        expect(rowTitles()).toContain('Groceries');
    });
});

describe('NotepadPanel reopening and text', () => {
    it('starts from the active list again when it is closed and reopened', async () => {
        await mountPanel();
        await rowOf('Groceries').trigger('click');
        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });
        await flushPromises();
        expect(wrapper.find('.np__htitleinput').exists()).toBe(false);
        expect(wrapper.findAll('.np__row')).toHaveLength(3);
    });

    it('has no bare words in its template', () => {
        const template = source.slice(source.indexOf('<template>'), source.indexOf('<script'));
        const noComments = template.replace(/<!--[\s\S]*?-->/g, '');
        const bareText = [...noComments.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1].trim()).filter(Boolean);
        expect(bareText).toEqual([]);
        expect([...noComments.matchAll(/\s(?:placeholder|alt|aria-label)="([^"]+)"/g)]).toEqual([]);
    });
});
