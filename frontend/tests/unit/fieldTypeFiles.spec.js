/* Task 046 slice A1.2 — a files custom field. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import en from '@/locales/en';

const { apiRequest, apiRequestWithoutCompnay, signedUrl, toast, quota } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    signedUrl: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    quota: vi.fn(() => true)
}));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'uid', checkBucketStorage: quota }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: `User ${id}` }), getTeam: () => ({}) })
}));
vi.mock('@/composable/commonFunction', () => ({ storageHelper: () => ({ handleStorageImageRequest: signedUrl }) }));
vi.mock('@/utils/storageQueryBuild.js', () => ({
    storageQueryBuilder: (type, bucketId, path) => (type === 'upload'
        ? { route: '/upload' }
        : { route: `/remove/${bucketId}?filepath=${path}`, method: 'delete', data: {} }),
    generateFileName: (name) => `77_${name}`
}));

import { fieldFilePath } from '@fieldTypes/files';
import { fieldTypeUi } from '@/plugins/customFieldView/fieldTypes';
import FilesFieldValue from '@/plugins/customFieldView/fieldTypes/FilesFieldValue.vue';
import CustomFieldCell from '@/views/Projects/components/columns/CustomFieldCell.vue';
import CustomFieldRender from '@/plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue';
import FieldBuilder from '@/plugins/customFieldView/component/organisms/FieldBuilder/FieldBuilder.vue';
import { FIELD_TYPES, customFieldPayload, customFieldText, emptyFieldDetail, shownFieldValues } from '@/views/Projects/composables/projectCustomFields';
import {
    comparisonsFor, customFieldGroups, customFilterCondition, customFilterOptions, customGroupOptions, customSortValue, isSortableField, valuePath
} from '@/views/Projects/composables/customFieldQuery';
import { sortChoices } from '@/views/Projects/composables/viewSort';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];
config.global.mocks = {};

const FILES = 'f1'.repeat(12);
const TASK = 'a1'.repeat(12);
const PROJECT = 'b1'.repeat(12);
const COMPANY = 'c1'.repeat(12);
const def = { _id: FILES, fieldType: 'files', fieldTitle: 'Contracts', fieldFilesMax: 3, fieldFilesKind: 'any', isDelete: true, type: 'task', global: true };
const keyOf = (name) => fieldFilePath({ projectId: PROJECT, taskId: TASK, fieldId: FILES, name });
const entry = (name, type = 'application/pdf', size = 2048) => ({ key: keyOf(name), name, size, type, uploadedBy: 'u1', uploadedAt: '2026-10-01T10:00:00.000Z' });
const task = (fieldValue = [entry('spec.pdf'), entry('photo.png', 'image/png', 3 * 1024 * 1024)]) => ({
    _id: TASK, ProjectID: PROJECT, TaskTypeKey: 1, customField: { [FILES]: { _id: FILES, fieldValue } }
});

const getters = {
    'settings/finalCustomFields': () => [def],
    'settings/customFields': () => [],
    'settings/selectedCompany': () => ({ planFeature: { customFields: true } }),
    'settings/AllTaskType': () => ({ settings: [] }),
    'settings/taskType': () => [],
    'settings/companyUsers': () => [],
    'settings/teams': () => [],
    'projectData/tasks': () => ({}),
    'projectData/alltasks': () => []
};
const store = createStore({ getters, mutations: { 'settings/mutateFinalCustomFields': () => {} } });
const global = {
    plugins: [store],
    provide: { $companyId: ref(COMPANY), $clientWidth: ref(1280), $dateFormat: ref('DD/MM/YYYY'), selectedProject: ref({ _id: PROJECT }), $userId: ref('u1') },
    stubs: { AiFieldMark: true, TaskTypeIcon: true, UpgradePlan: true, CustomFieldsSidebarComponent: true, AiFieldPanel: true }
};
const shown = (props = {}) => mount(FilesFieldValue, { props: { def, value: task().customField[FILES].fieldValue, task: task(), label: 'Contracts', ...props }, global, attachTo: document.body });
const file = (name, type = 'application/pdf') => new File(['x'.repeat(8)], name, { type });
const pick = async (wrapper, files) => {
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: files, configurable: true });
    await input.trigger('change');
    await flushPromises();
};

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
    signedUrl.mockReset();
    signedUrl.mockResolvedValue({ url: 'https://signed.example/file', downloadUrl: 'https://signed.example/file&download=true' });
    toast.success.mockReset();
    toast.error.mockReset();
    quota.mockReset();
    quota.mockReturnValue(true);
});

describe('the files type in the web app', () => {
    it('is a field type with an icon, a value component and settings', () => {
        expect(FIELD_TYPES).toContain('files');
        expect(fieldTypeUi('files')).toMatchObject({ icon: 'paperclip', needsTask: true, value: expect.anything(), settings: expect.anything() });
    });

    it('turns the files it holds into the value the server stores, or refuses them', () => {
        expect(customFieldPayload(def, [entry('a.pdf')])).toEqual({ fieldValue: [entry('a.pdf')], _id: FILES });
        expect(customFieldPayload(def, [entry('a.pdf'), entry('b.pdf'), entry('c.pdf'), entry('d.pdf')])).toEqual({ invalid: true });
        expect(customFieldPayload({ ...def, fieldFilesKind: 'images' }, [entry('a.pdf')])).toEqual({ invalid: true });
        expect(customFieldPayload(def, [{ ...entry('a.pdf'), key: 'https://example.com/a.pdf' }])).toEqual({ invalid: true });
        expect(emptyFieldDetail(def)).toEqual({ fieldValue: [], _id: FILES });
        expect(customFieldText(def, task())).toBe('spec.pdf, photo.png');
    });

    it('filters by "is set" and "is empty", and is never grouped or sorted', () => {
        expect(customFilterOptions([def]).map((option) => option.fieldType)).toEqual(['files']);
        expect(comparisonsFor('files').map((item) => item.value)).toEqual([':set', ':empty']);
        const row = { name: { value: `customField.${FILES}`, type: 'custom', fieldType: 'files', filterOn: valuePath(FILES) }, comparison: { value: ':empty' }, values: [] };
        expect(customFilterCondition(row)).toEqual({ [valuePath(FILES)]: { $in: [null, '', []] } });
        expect(customGroupOptions([def])).toEqual([]);
        expect(customFieldGroups(def)).toEqual([]);
        expect(isSortableField(def)).toBe(false);
        expect(isSortableField({ _id: 'x', fieldType: 'text' })).toBe(true);
        expect(customSortValue(def, task())).toBeNull();
        expect(sortChoices([def, { _id: 'e5'.repeat(12), fieldType: 'text', fieldTitle: 'Note' }]).filter((choice) => choice.label).map((choice) => choice.label)).toEqual(['Note']);
    });

    it('shows on a Board card when it holds files', () => {
        const columns = [{ id: `cf:${FILES}`, label: 'Contracts', field: def }];
        expect(shownFieldValues(columns, task()).map((item) => [item.label, item.text])).toEqual([['Contracts', 'spec.pdf, photo.png']]);
        expect(shownFieldValues(columns, task([]))).toEqual([]);
    });
});

describe('a files value in the task panel', () => {
    it('shows a thumbnail for an image and a name and size row for other files', async () => {
        const wrapper = shown();
        await flushPromises();
        const rows = wrapper.findAll('[data-file]');
        expect(rows).toHaveLength(2);
        expect(rows[0].find('img').exists()).toBe(false);
        expect(rows[0].text()).toContain('spec.pdf');
        expect(rows[0].text()).toContain('2 KB');
        expect(rows[1].get('img').attributes('src')).toBe('https://signed.example/file');
        expect(rows[1].text()).toContain('3 MB');
        expect(signedUrl).toHaveBeenCalledWith({ companyId: COMPANY, data: { url: keyOf('photo.png') } });
        wrapper.unmount();
    });

    it('opens a file through a signed link, in a new tab that cannot reach the opener', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const wrapper = shown();
        await wrapper.get('[data-file-open]').trigger('click');
        await flushPromises();
        expect(signedUrl).toHaveBeenCalledWith({ companyId: COMPANY, data: { url: keyOf('spec.pdf') } });
        expect(open).toHaveBeenCalledWith('https://signed.example/file', '_blank', 'noopener,noreferrer');
        open.mockRestore();
        wrapper.unmount();
    });

    it('is read-only without the right', () => {
        const wrapper = shown();
        expect(wrapper.find('input[type="file"]').exists()).toBe(false);
        expect(wrapper.find('[data-file-remove]').exists()).toBe(false);
        wrapper.unmount();
    });

    it('uploads a picked file into the folder of this task and field, then adds it to the value', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, statusText: keyOf('77_notes.pdf') } });
        const wrapper = shown({ editable: true });
        await pick(wrapper, [file('notes.pdf')]);
        const [method, route, form, kind] = apiRequestWithoutCompnay.mock.calls[0];
        expect([method, route, kind]).toEqual(['post', '/upload', 'form']);
        expect(form.get('companyId')).toBe(COMPANY);
        expect(form.get('path')).toBe(keyOf('77_notes.pdf'));
        expect(form.get('file').name).toBe('notes.pdf');
        const [next] = wrapper.emitted('change')[0];
        expect(next).toHaveLength(3);
        expect(next[2]).toEqual({ key: keyOf('77_notes.pdf'), name: 'notes.pdf', size: 8, type: 'application/pdf' });
        wrapper.unmount();
    });

    it('takes dropped files the same way', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, statusText: keyOf('77_drop.pdf') } });
        const wrapper = shown({ editable: true, value: [] });
        await wrapper.get('[data-files-drop]').trigger('drop', { dataTransfer: { files: [file('drop.pdf')] } });
        await flushPromises();
        expect(wrapper.emitted('change')[0][0].map((item) => item.name)).toEqual(['drop.pdf']);
        wrapper.unmount();
    });

    it('shows the server\'s reason when an upload is refused, and adds nothing', async () => {
        apiRequestWithoutCompnay.mockRejectedValue({ response: { data: { status: false, statusText: 'File too large. Maximum size is 10 MB.' } } });
        const wrapper = shown({ editable: true });
        await pick(wrapper, [file('huge.pdf')]);
        expect(toast.error).toHaveBeenCalledWith('File too large. Maximum size is 10 MB.', expect.anything());
        expect(wrapper.emitted('change')).toBeUndefined();
        wrapper.unmount();
    });

    it('stops before uploading when the plan\'s storage is full', async () => {
        quota.mockReturnValue(false);
        const wrapper = shown({ editable: true });
        await pick(wrapper, [file('notes.pdf')]);
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('holds no more than the field\'s cap, and only the kinds it allows', async () => {
        const full = shown({ editable: true, value: [entry('a.pdf'), entry('b.pdf'), entry('c.pdf')] });
        expect(full.find('input[type="file"]').exists()).toBe(false);
        expect(full.text()).toContain(en.FieldTypes.files_full.replace('{max}', '3'));
        full.unmount();

        const images = shown({ editable: true, def: { ...def, fieldFilesKind: 'images' }, value: [] });
        expect(images.get('input[type="file"]').attributes('accept')).toContain('.png');
        await pick(images, [file('notes.pdf')]);
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(en.FieldTypes.files_kind_refused_images, expect.anything());
        images.unmount();
    });

    it('removes a file only after a confirm, deleting the stored file as task attachments do', async () => {
        apiRequest.mockResolvedValue({ data: { status: true } });
        const wrapper = shown({ editable: true });
        await wrapper.findAll('[data-file-remove]')[0].trigger('click');
        expect(apiRequest).not.toHaveBeenCalled();
        expect(wrapper.emitted('change')).toBeUndefined();
        await wrapper.get('[data-file-remove-confirm]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('delete', `/remove/${COMPANY}?filepath=${keyOf('spec.pdf')}`, {});
        expect(wrapper.emitted('change')[0][0].map((item) => item.name)).toEqual(['photo.png']);
        wrapper.unmount();
    });

    it('keeps the file when the confirm is declined', async () => {
        const wrapper = shown({ editable: true });
        await wrapper.findAll('[data-file-remove]')[0].trigger('click');
        await wrapper.get('[data-file-remove-cancel]').trigger('click');
        expect(apiRequest).not.toHaveBeenCalled();
        expect(wrapper.findAll('[data-file]')).toHaveLength(2);
        wrapper.unmount();
    });

    it('sits in the task panel with the other fields and hands a change up as the value to store', async () => {
        apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, statusText: keyOf('77_notes.pdf') } });
        const wrapper = mount(CustomFieldRender, { props: { task: task(), editPermission: true }, global });
        await vi.waitFor(() => expect(wrapper.find('[data-field-type="files"]').exists()).toBe(true), { timeout: 4000 });
        await pick(wrapper, [file('notes.pdf')]);
        const [field, value] = wrapper.emitted('fieldValue')[0];
        expect(field._id).toBe(FILES);
        expect(value).toHaveLength(3);
        wrapper.unmount();
    });
});

describe('a files value in a List or Table cell', () => {
    const cell = (data = task(), editable = true) => mount(CustomFieldCell, { props: { def, task: data, editable }, global, attachTo: document.body });

    it('is a count chip that opens a small list of the files', async () => {
        const wrapper = cell();
        const chip = wrapper.get('[data-files-chip]');
        expect(chip.text()).toContain('2');
        expect(chip.attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('[data-file]').exists()).toBe(false);
        await chip.trigger('click');
        expect(chip.attributes('aria-expanded')).toBe('true');
        expect(wrapper.findAll('[data-file]').map((row) => row.text())).toEqual([expect.stringContaining('spec.pdf'), expect.stringContaining('photo.png')]);
        await wrapper.get('[data-files-list]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('[data-file]').exists()).toBe(false);
        wrapper.unmount();
    });

    it('offers to add a file from the list when it may be edited, and nothing to change when it may not', async () => {
        const editable = cell(task([]));
        await editable.get('[data-files-chip]').trigger('click');
        expect(editable.find('input[type="file"]').exists()).toBe(true);
        editable.unmount();

        const readOnly = cell(task(), false);
        await readOnly.get('[data-files-chip]').trigger('click');
        expect(readOnly.find('input[type="file"]').exists()).toBe(false);
        expect(readOnly.find('[data-file-remove]').exists()).toBe(false);
        readOnly.unmount();

        expect(cell(task([]), false).find('[data-files-chip]').exists()).toBe(false);
    });
});

describe('the field builder', () => {
    const saved = () => apiRequest.mock.calls.find(([method]) => method === 'post')?.[2]?.updateObject;

    it('offers the files type and saves its cap and allowed kinds', async () => {
        apiRequest.mockImplementation((method) => Promise.resolve(method === 'get' ? { data: { data: { names: [] } } } : { status: 200, data: { _id: 'new' } }));
        const wrapper = mount(FieldBuilder, { global });
        await wrapper.get('[data-field-type-option="files"]').trigger('click');
        await wrapper.get('#fb-title').setValue('Invoices');
        await wrapper.get('[data-files-max]').setValue('5');
        await wrapper.get('[data-files-kind]').setValue('documents');
        await wrapper.get('.fb__save').trigger('click');
        await flushPromises();
        expect(saved()).toMatchObject({ fieldTitle: 'Invoices', fieldType: 'files', fieldFilesMax: 5, fieldFilesKind: 'documents' });
    });

    it('refuses a cap outside 1 to 20 before asking the server', async () => {
        apiRequest.mockImplementation((method) => Promise.resolve(method === 'get' ? { data: { data: { names: [] } } } : { status: 200, data: { _id: 'new' } }));
        const wrapper = mount(FieldBuilder, { global });
        await wrapper.get('[data-field-type-option="files"]').trigger('click');
        await wrapper.get('#fb-title').setValue('Invoices');
        await wrapper.get('[data-files-max]').setValue('40');
        await wrapper.get('.fb__save').trigger('click');
        await flushPromises();
        expect(saved()).toBeUndefined();
        expect(wrapper.text()).toContain(en.FieldTypes.files_settings_error);
    });
});
