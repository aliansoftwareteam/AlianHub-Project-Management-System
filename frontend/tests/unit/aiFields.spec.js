import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import taskSelection from '@/store/TaskSelection';

const { apiRequest, aiUsableRef } = vi.hoisted(() => ({ apiRequest: vi.fn(), aiUsableRef: { ref: null } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable/aiAvailability', async () => {
    const { ref: vueRef } = await import('vue');
    const usable = vueRef(true);
    aiUsableRef.ref = usable;
    return { aiUsable: usable, canUseAi: () => usable.value };
});
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: () => ({ generateMany: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `User ${id}` }) })
}));
vi.mock('@/components/atom/CalenderCompo/CalenderCompo.vue', () => ({
    default: { name: 'CalenderCompo', template: '<div />' }
}));

import {
    AI_READ_PARTS, aiDraftFrom, aiFieldPayload, aiFillOf, isAiField, newAiDraft, templatesFor, validateAiDraft
} from '@/views/Projects/composables/aiFields';
import { aiFieldFill, closeAiFill, openAiFill } from '@/composable/aiFieldFill';
import AiFieldFillDialog from '@/components/molecules/AiFieldFill/AiFieldFillDialog.vue';
import AiFieldPanel from '@/plugins/customFieldView/component/organisms/FieldBuilder/AiFieldPanel.vue';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';
import CustomFieldCell from '@/views/Projects/components/columns/CustomFieldCell.vue';
import AiFieldColumnHead from '@/views/Projects/components/columns/AiFieldColumnHead.vue';

const summaryField = {
    _id: 'f1', fieldTitle: 'Summary', fieldType: 'textarea', type: 'task', isDelete: true, global: true,
    fieldAi: { enabled: true, template: 'summary', reads: ['title', 'description'], autoRefill: false, language: '', prompt: '' }
};
const plainField = { _id: 'f2', fieldTitle: 'Notes', fieldType: 'textarea', type: 'task', isDelete: true, global: true };

const ok = (data) => Promise.resolve({ status: 200, data: { status: true, data } });

beforeEach(() => {
    apiRequest.mockReset();
    aiUsableRef.ref.value = true;
    closeAiFill();
});

describe('AI field config in the field builder', () => {
    it('offers the text templates on long text and category or custom on a dropdown', () => {
        expect(templatesFor('textarea')).toEqual(['summary', 'progress_update', 'translation', 'action_items', 'custom']);
        expect(templatesFor('dropdown')).toEqual(['category', 'custom']);
        expect(AI_READ_PARTS).toEqual(['title', 'description', 'comments', 'subtasks']);
    });

    it('starts as a long text summary reading title and description, auto-refill off', () => {
        expect(newAiDraft()).toEqual(expect.objectContaining({
            fieldTitle: '', output: 'textarea', template: 'summary', reads: ['title', 'description'], autoRefill: false, options: []
        }));
    });

    it('asks for what each template needs', () => {
        const t = (key) => key;
        expect(validateAiDraft({ ...newAiDraft(), fieldTitle: '' }, t).fieldTitle).toBeTruthy();
        expect(validateAiDraft({ ...newAiDraft(), fieldTitle: 'Fr', template: 'translation', language: '' }, t).language).toBeTruthy();
        expect(validateAiDraft({ ...newAiDraft(), fieldTitle: 'C', template: 'custom', prompt: ' ' }, t).prompt).toBeTruthy();
        expect(validateAiDraft({ ...newAiDraft(), fieldTitle: 'Area', output: 'dropdown', template: 'category', options: [] }, t).options).toBeTruthy();
        expect(validateAiDraft({ ...newAiDraft(), fieldTitle: 'S', reads: [] }, t).reads).toBeTruthy();
        expect(validateAiDraft({ ...newAiDraft(), fieldTitle: 'Summary' }, t)).toEqual({});
    });

    it('saves a long text or dropdown field carrying its AI config', () => {
        const text = aiFieldPayload({ ...newAiDraft(), fieldTitle: 'Summary', autoRefill: true });
        expect(text).toEqual(expect.objectContaining({
            fieldTitle: 'Summary', fieldType: 'textarea', type: 'task',
            fieldAi: { enabled: true, template: 'summary', language: '', prompt: '', reads: ['title', 'description'], autoRefill: true }
        }));
        const dropdown = aiFieldPayload({ ...newAiDraft(), fieldTitle: 'Area', output: 'dropdown', template: 'category', options: [{ id: 'o1', label: 'Backend' }, { id: '', label: ' Design ' }, { label: '' }] });
        expect(dropdown.fieldType).toBe('dropdown');
        expect(dropdown.fieldOptions.map((o) => o.label)).toEqual(['Backend', 'Design']);
        expect(dropdown.fieldOptions.every((o) => o.id && o.value)).toBe(true);
    });

    it('reads a saved field back into the draft', () => {
        const draft = aiDraftFrom({ ...summaryField, fieldAi: { ...summaryField.fieldAi, template: 'translation', language: 'French' } });
        expect(draft).toEqual(expect.objectContaining({ _id: 'f1', fieldTitle: 'Summary', output: 'textarea', template: 'translation', language: 'French' }));
    });

    it('switches the template list with the output and keeps a valid template', async () => {
        const wrapper = mount(AiFieldPanel, { props: { modelValue: newAiDraft(), errors: {} } });
        expect(wrapper.findAll('[data-ai-template]').map((b) => b.attributes('data-ai-template'))).toEqual(templatesFor('textarea'));
        await wrapper.find('[data-ai-output="dropdown"]').trigger('click');
        const emitted = wrapper.emitted('update:modelValue').at(-1)[0];
        expect(emitted.output).toBe('dropdown');
        expect(emitted.template).toBe('category');
    });

    it('shows the language only for translation and the prompt box always', async () => {
        const wrapper = mount(AiFieldPanel, { props: { modelValue: newAiDraft(), errors: {} } });
        expect(wrapper.find('#ai-field-language').exists()).toBe(false);
        expect(wrapper.find('#ai-field-prompt').exists()).toBe(true);
        await wrapper.setProps({ modelValue: { ...newAiDraft(), template: 'translation' } });
        expect(wrapper.find('#ai-field-language').exists()).toBe(true);
    });
});

describe('fill preview', () => {
    const mountDialog = () => mount(AiFieldFillDialog, { props: { teleport: false }, attachTo: document.body });

    it('previews one task and writes only after Apply', async () => {
        apiRequest.mockImplementation((method, url) => {
            if (url.endsWith('/ai/preview')) return ok({ proposals: [{ taskId: 't1', proposalId: 'p1', text: 'Proposed summary', empty: false }] });
            if (url.endsWith('/ai/apply')) return ok({ applied: ['t1'], refused: [] });
            return ok({});
        });
        const wrapper = mountDialog();
        openAiFill(summaryField, ['t1']);
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/custom-fields/f1/ai/preview', { taskIds: ['t1'] });
        expect(wrapper.text()).toContain('Proposed summary');
        expect(apiRequest.mock.calls.some(([, url]) => url.endsWith('/ai/apply'))).toBe(false);

        await wrapper.find('[data-ai-fill-confirm]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/custom-fields/f1/ai/apply', { proposalIds: ['p1'] });
        expect(aiFieldFill.open).toBe(false);
        wrapper.unmount();
    });

    it('previews a sample of a bulk fill, then runs the job and shows its progress', async () => {
        vi.useFakeTimers();
        let polls = 0;
        apiRequest.mockImplementation((method, url) => {
            if (url.endsWith('/ai/preview')) return ok({ proposals: [{ taskId: 't1', proposalId: 'p1', text: 'One', empty: false }, { taskId: 't2', proposalId: 'p2', text: 'Two', empty: false }, { taskId: 't3', proposalId: null, text: '', empty: true, reason: 'no_fit' }] });
            if (url.endsWith('/ai/jobs')) return ok({ _id: 'j1', status: 'queued', total: 4, processed: 0 });
            if (url.endsWith('/ai/jobs/j1')) {
                polls += 1;
                return ok(polls > 1 ? { _id: 'j1', status: 'done', total: 4, processed: 4, filled: 3, skipped: 1 } : { _id: 'j1', status: 'running', total: 4, processed: 2, filled: 2, skipped: 0 });
            }
            return ok({});
        });
        const wrapper = mountDialog();
        openAiFill(summaryField, ['t1', 't2', 't3', 't4']);
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/custom-fields/f1/ai/preview', { taskIds: ['t1', 't2', 't3'] });
        expect(wrapper.findAll('[data-ai-proposal]')).toHaveLength(3);

        await wrapper.find('[data-ai-fill-confirm]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/custom-fields/f1/ai/jobs', { taskIds: ['t1', 't2', 't3', 't4'], proposalIds: ['p1', 'p2'] });

        await vi.advanceTimersByTimeAsync(1600);
        await flushPromises();
        expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('2');

        await vi.advanceTimersByTimeAsync(1600);
        await flushPromises();
        expect(aiFieldFill.job.status).toBe('done');
        expect(wrapper.text()).toContain('AiFields.job_done');
        vi.useRealTimers();
        wrapper.unmount();
    });

    it('shows the stop reason when a cap ends the job', async () => {
        vi.useFakeTimers();
        apiRequest.mockImplementation((method, url) => {
            if (url.endsWith('/ai/preview')) return ok({ proposals: [{ taskId: 't1', proposalId: 'p1', text: 'One', empty: false }] });
            if (url.endsWith('/ai/jobs')) return ok({ _id: 'j2', status: 'queued', total: 5, processed: 0 });
            return ok({ _id: 'j2', status: 'stopped', stopReason: 'daily_limit', total: 5, processed: 2, filled: 2, skipped: 0 });
        });
        const wrapper = mountDialog();
        openAiFill(summaryField, ['t1', 't2', 't3', 't4', 't5']);
        await flushPromises();
        await wrapper.find('[data-ai-fill-confirm]').trigger('click');
        await flushPromises();
        await vi.advanceTimersByTimeAsync(1600);
        await flushPromises();
        expect(wrapper.text()).toContain('AiFields.stop_daily_limit');
        vi.useRealTimers();
        wrapper.unmount();
    });

    it('says AI is off instead of calling the model', async () => {
        aiUsableRef.ref.value = false;
        const wrapper = mountDialog();
        openAiFill(summaryField, ['t1']);
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('AiFields.ai_off');
        wrapper.unmount();
    });

    it('closes with Escape', async () => {
        apiRequest.mockImplementation(() => ok({ proposals: [] }));
        const wrapper = mountDialog();
        openAiFill(summaryField, ['t1']);
        await flushPromises();
        await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
        expect(aiFieldFill.open).toBe(false);
        wrapper.unmount();
    });
});

describe('bulk menu', () => {
    const project = { _id: 'p1', isGlobalPermission: true, apps: [], taskStatusData: [], sprintsObj: {}, tagsArray: [], AssigneeUserId: [] };
    const mountBar = (fields = [summaryField, plainField]) => {
        const store = createStore({
            modules: {
                taskSelection: { ...taskSelection, state: () => ({ selectedTaskIds: ['t1', 't2'], lastAnchorId: null, activeView: 'list', activeProjectId: 'p1' }) },
                projectData: { namespaced: true, state: () => ({ tasks: {}, searchedTasks: [] }) },
                settings: {
                    namespaced: true,
                    getters: {
                        companyUsers: () => [],
                        companyOwnerDetail: () => ({ userId: 'owner' }),
                        companyPriority: () => [],
                        finalCustomFields: () => fields,
                        selectedCompany: () => ({ planFeature: { customFields: true } })
                    }
                }
            }
        });
        return mount(ListBulkBar, { props: { project }, global: { plugins: [store], stubs: { ConfirmationSidebar: true } } });
    };

    it('lists each AI field in the AI menu and opens the fill for the selected tasks', async () => {
        const wrapper = mountBar();
        await wrapper.find('.lv2-bulk__btn--ai').trigger('click');
        const items = wrapper.findAll('[data-ai-field-fill]');
        expect(items.map((item) => item.attributes('data-ai-field-fill'))).toEqual(['f1']);
        await items[0].trigger('click');
        expect(aiFieldFill.open).toBe(true);
        expect(aiFieldFill.field._id).toBe('f1');
        expect(aiFieldFill.taskIds).toEqual(['t1', 't2']);
    });

    it('shows no fill items without an AI field', async () => {
        const wrapper = mountBar([plainField]);
        await wrapper.find('.lv2-bulk__btn--ai').trigger('click');
        expect(wrapper.findAll('[data-ai-field-fill]')).toHaveLength(0);
    });
});

describe('AI field cells and column head', () => {
    const task = { _id: 't1', customField: { f1: { fieldValue: 'Filled text', _id: 'f1' } }, aiFieldFills: { f1: { at: '2026-09-28T10:00:00.000Z', by: 'u1', trigger: 'manual' } } };

    it('marks an AI value and says when it was filled', () => {
        const wrapper = mount(CustomFieldCell, { props: { def: summaryField, task, editable: true } });
        const mark = wrapper.find('[data-ai-mark]');
        expect(mark.exists()).toBe(true);
        expect(mark.attributes('title')).toContain('AiFields.filled_by_ai');
        expect(aiFillOf(task, summaryField).trigger).toBe('manual');
        expect(isAiField(summaryField)).toBe(true);
        expect(isAiField(plainField)).toBe(false);
    });

    it('offers Fill with AI on an editable cell and opens the preview for that task', async () => {
        apiRequest.mockImplementation(() => ok({ proposals: [] }));
        const wrapper = mount(CustomFieldCell, { props: { def: summaryField, task: { _id: 't9', customField: {} }, editable: true } });
        const button = wrapper.find('[data-ai-fill]');
        expect(button.attributes('aria-label')).toBe('AiFields.fill_with_ai');
        await button.trigger('click');
        expect(aiFieldFill.open).toBe(true);
        expect(aiFieldFill.taskIds).toEqual(['t9']);
    });

    it('leaves plain fields and read-only cells without the fill button', () => {
        expect(mount(CustomFieldCell, { props: { def: plainField, task, editable: true } }).find('[data-ai-fill]').exists()).toBe(false);
        expect(mount(CustomFieldCell, { props: { def: summaryField, task, editable: false } }).find('[data-ai-fill]').exists()).toBe(false);
    });

    it('fills every task in the view or only the empty ones from the column menu', async () => {
        const tasks = [task, { _id: 't2', customField: {} }, { _id: 't3', customField: { f1: { fieldValue: '' } } }];
        const wrapper = mount(AiFieldColumnHead, { props: { field: summaryField, tasks, editable: true }, attachTo: document.body });
        await wrapper.find('[data-ai-column-menu]').trigger('click');
        const [all, empty] = wrapper.findAll('[role="menuitem"]');
        expect(all.text()).toContain('AiFields.fill_all');
        await empty.trigger('click');
        expect(aiFieldFill.taskIds).toEqual(['t2', 't3']);
        wrapper.unmount();
    });
});

describe('the dialog state', () => {
    it('keeps nothing between two fills', async () => {
        apiRequest.mockImplementation(() => ok({ proposals: [{ taskId: 't1', proposalId: 'p1', text: 'x', empty: false }] }));
        openAiFill(summaryField, ['t1']);
        await flushPromises();
        closeAiFill();
        expect(aiFieldFill).toEqual(expect.objectContaining({ open: false, field: null, taskIds: [], proposals: [], job: null }));
    });
});
