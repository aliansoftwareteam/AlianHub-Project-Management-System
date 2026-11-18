import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from '@vue/compiler-sfc';
import { ref } from 'vue';

const { apiRequest, apiRequestWithoutCompnay, toast, store } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    store: {
        getters: {
            'users/users': [
                { _id: 'user-1', Employee_Name: 'Me Myself' },
                { _id: 'user-2', Employee_Name: 'Ben Ito' },
            ],
        },
    },
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/utils/storageQueryBuild.js', () => ({
    storageQueryBuilder: () => ({ route: '/upload' }),
    generateFileName: (name) => `stored-${name}`,
}));

import ReminderModal from '@/components/molecules/GeneralReminder/ReminderModal.vue';

let wrapper;
const find = (selector) => wrapper.find(selector);
const chips = () => wrapper.findAll('.gr__chip');
const createButton = () => find('.gr__create');

const mountModal = async (props = {}) => {
    wrapper = mount(ReminderModal, {
        props: { modelValue: false, ...props },
        attachTo: document.body,
        global: { provide: { $userId: ref('user-1'), $companyId: ref('company-1') } },
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
};

beforeEach(() => {
    apiRequest.mockReset().mockResolvedValue({ data: { status: true, data: { _id: 'r-new' } } });
    apiRequestWithoutCompnay.mockReset().mockResolvedValue({ data: { status: true, statusText: 'key/file.png' } });
    toast.success.mockReset();
    toast.error.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
});

describe('ReminderModal create flow', () => {
    it('renders nothing while closed and a labelled dialog once opened', async () => {
        wrapper = mount(ReminderModal, { props: { modelValue: false } });
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
        await wrapper.setProps({ modelValue: true });
        const dialog = wrapper.get('[role="dialog"]');
        expect(dialog.attributes('aria-modal')).toBe('true');
        expect(dialog.attributes('aria-label')).toBe('Reminders.title');
        expect(wrapper.get('.gr__title').text()).toBe('Reminders.title');
    });

    it('shows i18n keys for placeholder, close title and footer, and focuses the name field', async () => {
        await mountModal();
        const name = find('.gr__name');
        expect(name.attributes('placeholder')).toBe('Reminders.name_placeholder');
        expect(find('.gr__close').attributes('title')).toBe('Reminders.close');
        expect(find('.gr__clip').attributes('title')).toBe('Reminders.attach');
        expect(find('.gr__adddesc').text()).toBe('Reminders.add_description');
        expect(createButton().text()).toBe('Reminders.create');
        expect(document.activeElement).toBe(name.element);
    });

    it('keeps Create disabled until a non-blank name is typed, and Enter in the name field does nothing while blank', async () => {
        await mountModal();
        expect(createButton().attributes('disabled')).toBeDefined();
        await find('.gr__name').setValue('   ');
        expect(createButton().attributes('disabled')).toBeDefined();
        await find('.gr__name').trigger('keyup.enter');
        expect(apiRequest).not.toHaveBeenCalled();
        await find('.gr__name').setValue('Call Ana');
        expect(createButton().attributes('disabled')).toBeUndefined();
    });

    it('creates the reminder, announces success, emits created and closes', async () => {
        await mountModal();
        await find('.gr__name').setValue('  Call Ana  ');
        await createButton().trigger('click');
        await flushPromises();

        const [method, url, payload] = apiRequest.mock.calls[0];
        expect([method, url]).toEqual(['post', '/api/v1/general-reminders']);
        expect(payload).toMatchObject({ title: 'Call Ana', notifyBefore: 0, attachments: [], userId: 'user-1' });
        expect(payload).not.toHaveProperty('assignedTo');
        expect(new Date(payload.remindAt).getTime()).toBeGreaterThan(Date.now());
        expect(toast.success).toHaveBeenCalledWith('Reminders.created', expect.anything());
        expect(wrapper.emitted('created')[0]).toEqual([{ _id: 'r-new' }]);
        expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([false]);
    });

    it('saves on Enter in the name field', async () => {
        await mountModal();
        await find('.gr__name').setValue('Pay rent');
        await find('.gr__name').trigger('keyup.enter');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted('created')).toHaveLength(1);
    });

    it('shows the server message and stays open when the API refuses', async () => {
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Quota reached' } });
        await mountModal();
        await find('.gr__name').setValue('Pay rent');
        await createButton().trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Quota reached', expect.anything());
        expect(wrapper.emitted('created')).toBeUndefined();
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        expect(createButton().attributes('disabled')).toBeUndefined();
    });

    it('falls back to the generic failure key when the request throws', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        await mountModal();
        await find('.gr__name').setValue('Pay rent');
        await createButton().trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Reminders.failed', expect.anything());
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('disables Create while the request is in flight and labels it as creating', async () => {
        let finish;
        apiRequest.mockReturnValue(new Promise((done) => { finish = done; }));
        await mountModal();
        await find('.gr__name').setValue('Pay rent');
        await createButton().trigger('click');
        expect(createButton().text()).toBe('Reminders.creating');
        expect(createButton().attributes('disabled')).toBeDefined();
        await createButton().trigger('click');
        expect(apiRequest).toHaveBeenCalledTimes(1);
        finish({ data: { status: true, data: {} } });
        await flushPromises();
    });
});

describe('ReminderModal fields', () => {
    it('reveals the description box and focuses it', async () => {
        await mountModal();
        await find('.gr__adddesc').trigger('click');
        await flushPromises();
        const area = find('.gr__desc');
        expect(area.attributes('placeholder')).toBe('Reminders.description_placeholder');
        expect(find('.gr__adddesc').exists()).toBe(false);
        await area.setValue('Bring the contract');
        await find('.gr__name').setValue('Call Ana');
        await createButton().trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls[0][2].description).toBe('Bring the contract');
    });

    it('date presets change the label and close with Done', async () => {
        await mountModal();
        await chips()[0].trigger('click');
        expect(find('.gr__pop').exists()).toBe(true);
        const presets = wrapper.findAll('.gr__preset');
        expect(presets.map((p) => p.text())).toEqual(['Reminders.today', 'Reminders.tomorrow', 'Reminders.next_week']);
        await presets[1].trigger('click');
        expect(chips()[0].text()).toMatch(/^Reminders\.tomorrow, /);
        await find('.gr__popdone').trigger('click');
        expect(find('.gr__pop').exists()).toBe(false);
    });

    it('a cleared date shows the set-date prompt and blocks saving', async () => {
        await mountModal();
        await chips()[0].trigger('click');
        await find('.gr__dtinput').setValue('');
        expect(chips()[0].text()).toBe('Reminders.set_date');
        await find('.gr__name').setValue('x');
        expect(createButton().attributes('disabled')).toBeDefined();
    });

    it('lets the person pick another user and sends assignedTo; the current user is not listed', async () => {
        await mountModal();
        expect(chips()[1].text()).toContain('Reminders.for_me');
        expect(chips()[1].find('.gr__avatar').text()).toBe('Reminders.me_initial');
        await chips()[1].trigger('click');
        const options = wrapper.findAll('.gr__opt').map((o) => o.text());
        expect(options).toEqual(['Reminders.for_me', 'Ben Ito']);
        await wrapper.findAll('.gr__opt')[1].trigger('click');
        expect(chips()[1].text()).toContain('Ben Ito');
        expect(chips()[1].find('.gr__avatar').text()).toBe('B');
        await find('.gr__name').setValue('Review PR');
        await createButton().trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls[0][2].assignedTo).toBe('user-2');
    });

    it('notify presets, custom minutes and "don\'t notify" update the chip and payload', async () => {
        await mountModal();
        expect(chips()[2].text()).toBe('Reminders.notify_me');
        await chips()[2].trigger('click');
        expect(find('.gr__poptitle').text()).toBe('Reminders.notify_me');
        await wrapper.findAll('.gr__opt')[2].trigger('click');
        expect(chips()[2].text()).toBe('Reminders.one_hour_before');

        await chips()[2].trigger('click');
        const custom = wrapper.findAll('.gr__opt').find((o) => o.text() === 'Reminders.custom');
        await custom.trigger('click');
        await find('.gr__custominput').setValue(45);
        expect(find('.gr__custom').text()).toContain('Reminders.minutes_before');
        await find('.gr__custom .gr__popdone').trigger('click');
        expect(chips()[2].text()).toBe('45 Reminders.minutes_before');

        await chips()[2].trigger('click');
        await wrapper.findAll('.gr__opt').at(-1).trigger('click');
        expect(chips()[2].text()).toBe('Reminders.dont_notify');
        await find('.gr__name').setValue('x');
        await createButton().trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls[0][2].notifyBefore).toBe(-1);
    });

    it('ignores a custom value of zero', async () => {
        await mountModal();
        await chips()[2].trigger('click');
        await wrapper.findAll('.gr__opt').find((o) => o.text() === 'Reminders.custom').trigger('click');
        await find('.gr__custominput').setValue(0);
        await find('.gr__custom .gr__popdone').trigger('click');
        expect(chips()[2].text()).toBe('Reminders.notify_me');
    });

    it('clicking inside the dialog outside a popover closes the open popover', async () => {
        await mountModal();
        await chips()[1].trigger('click');
        expect(find('.gr__pop').exists()).toBe(true);
        await find('.gr__title').trigger('click');
        expect(find('.gr__pop').exists()).toBe(false);
    });
});

describe('ReminderModal attachments', () => {
    const pick = async (files) => {
        const input = find('input[type="file"]');
        Object.defineProperty(input.element, 'files', { value: files, configurable: true });
        await input.trigger('change');
    };

    it('toggles the attachment area, lists picked files and removes one', async () => {
        await mountModal();
        expect(find('.gr__attach').exists()).toBe(false);
        await find('.gr__clip').trigger('click');
        expect(find('.gr__clip').classes()).toContain('is-on');
        expect(find('.gr__attachhead').text()).toBe('Reminders.attachments');
        expect(find('.gr__drop').text()).toContain('Reminders.drag_files');
        expect(find('.gr__browse').text()).toBe('Reminders.browse');
        await pick([new File(['a'], 'a.png'), new File(['b'], 'b.pdf')]);
        expect(wrapper.findAll('.gr__filename').map((n) => n.text())).toEqual(['a.png', 'b.pdf']);
        const remove = wrapper.findAll('.gr__filex')[0];
        expect(remove.attributes('title')).toBe('Reminders.remove');
        await remove.trigger('click');
        expect(wrapper.findAll('.gr__filename').map((n) => n.text())).toEqual(['b.pdf']);
    });

    it('accepts dropped files and caps the list at 20', async () => {
        await mountModal();
        await find('.gr__clip').trigger('click');
        const files = Array.from({ length: 25 }, (_, i) => new File(['x'], `f${i}.txt`));
        await find('.gr__drop').trigger('drop', { dataTransfer: { files } });
        expect(wrapper.findAll('.gr__file')).toHaveLength(20);
    });

    it('uploads files first and sends their stored keys', async () => {
        await mountModal();
        await find('.gr__clip').trigger('click');
        await pick([new File(['a'], 'a.png')]);
        await find('.gr__name').setValue('With file');
        await createButton().trigger('click');
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledTimes(1);
        expect(apiRequest.mock.calls[0][2].attachments).toEqual([
            { name: 'a.png', size: 1, extension: 'png', url: 'key/file.png' },
        ]);
    });

    it('reports an upload failure and does not create the reminder', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: false, statusText: 'too big' } });
        await mountModal();
        await find('.gr__clip').trigger('click');
        await pick([new File(['a'], 'a.png')]);
        await find('.gr__name').setValue('With file');
        await createButton().trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Reminders.upload_failed', expect.anything());
        expect(apiRequest).not.toHaveBeenCalled();
        expect(createButton().text()).toBe('Reminders.create');
        expect(createButton().attributes('disabled')).toBeUndefined();
    });
});

describe('ReminderModal edit mode', () => {
    const reminder = {
        _id: 'r1',
        title: 'Renew passport',
        description: 'Take photos',
        remindAt: '2031-03-04T10:30:00.000Z',
        notifyBefore: 10,
        attachments: [{ name: 'form.pdf', size: 3, extension: 'pdf', url: 'k/form.pdf' }],
    };

    it('prefills from the reminder and shows the edit title and Save label', async () => {
        await mountModal({ reminder });
        expect(find('.gr__title').text()).toBe('Reminders.edit_title');
        expect(find('.gr__name').element.value).toBe('Renew passport');
        expect(find('.gr__desc').element.value).toBe('Take photos');
        expect(chips()[2].text()).toBe('Reminders.ten_minutes_before');
        expect(find('.gr__filename').text()).toBe('form.pdf');
        expect(createButton().text()).toBe('Reminders.save');
    });

    it('patches that reminder, keeps stored attachments without re-uploading and emits updated', async () => {
        await mountModal({ reminder });
        await find('.gr__name').setValue('Renew passport now');
        await createButton().trigger('click');
        await flushPromises();
        const [method, url, payload] = apiRequest.mock.calls[0];
        expect([method, url]).toEqual(['patch', '/api/v1/general-reminders/r1']);
        expect(payload.attachments).toEqual([{ name: 'form.pdf', size: 3, extension: 'pdf', url: 'k/form.pdf' }]);
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Reminders.updated', expect.anything());
        expect(wrapper.emitted('updated')).toHaveLength(1);
        expect(wrapper.emitted('created')).toBeUndefined();
    });

    it('starts blank again when reopened for a new reminder', async () => {
        await mountModal({ reminder });
        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ reminder: null, modelValue: true });
        expect(find('.gr__name').element.value).toBe('');
        expect(find('.gr__title').text()).toBe('Reminders.title');
    });
});

describe('ReminderModal keyboard and dismissal', () => {
    const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    it('Escape closes an open popover first, then the dialog', async () => {
        await mountModal();
        await chips()[1].trigger('click');
        escape();
        await flushPromises();
        expect(find('.gr__pop').exists()).toBe(false);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        escape();
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([false]);
    });

    it('other keys are ignored, and the listener is gone once closed', async () => {
        await mountModal();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        await wrapper.setProps({ modelValue: false });
        escape();
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('the close button and a click on the backdrop both ask to close; a click inside does not', async () => {
        await mountModal();
        await find('.gr__dialog').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        await find('.gr__close').trigger('click');
        await find('.gr__overlay').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toEqual([[false], [false]]);
    });

    it('every control is a real button reachable in tab order', async () => {
        await mountModal();
        wrapper.findAll('button').forEach((b) => {
            expect(b.attributes('type')).toBe('button');
            expect(b.attributes('tabindex')).toBeUndefined();
        });
    });
});

describe('ReminderModal copy', () => {
    const source = readFileSync(resolve(__dirname, '../../src/components/molecules/GeneralReminder/ReminderModal.vue'), 'utf8');
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

    it('has no hard-coded visible text or attributes in the template', () => {
        expect(bareCopy()).toEqual([]);
    });

    it('renders every word shown from an i18n key', async () => {
        await mountModal();
        await find('.gr__clip').trigger('click');
        const leftover = wrapper.text().replace(/Reminders\.[a-z_]+/g, '').replace(/[\s,:\d]|[ap]m/g, '');
        expect(leftover).toBe('');
    });
});
