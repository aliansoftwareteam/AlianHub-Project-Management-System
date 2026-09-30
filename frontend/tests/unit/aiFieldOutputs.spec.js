import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable/aiAvailability', async () => {
    const { ref: vueRef } = await import('vue');
    return { aiUsable: vueRef(true), canUseAi: () => true };
});

import {
    AI_OUTPUTS, aiDraftFrom, aiFieldPayload, aiOutputOf, isAiField, newAiDraft, templatesFor, validateAiDraft
} from '@/views/Projects/composables/aiFields';
import { aiFieldFill, closeAiFill, openAiFill } from '@/composable/aiFieldFill';
import AiFieldFillDialog from '@/components/molecules/AiFieldFill/AiFieldFillDialog.vue';
import AiFieldPanel from '@/plugins/customFieldView/component/organisms/FieldBuilder/AiFieldPanel.vue';
import AiFieldMark from '@/components/atom/AiFieldMark/AiFieldMark.vue';
import CustomFieldCell from '@/views/Projects/components/columns/CustomFieldCell.vue';

const OPTIONS = [{ id: 'o1', label: 'Backend', color: '#34495E' }, { id: 'o2', label: 'Design', color: '#34495E' }];
const base = { type: 'task', isDelete: true, global: true };
const ai = (extra) => ({ enabled: true, template: 'custom', prompt: 'Fill it', reads: ['title'], autoRefill: false, language: '', ...extra });

const labelsField = { ...base, _id: 'fl', fieldTitle: 'Areas', fieldType: 'dropdown', fieldOptions: OPTIONS, fieldAi: ai({ output: 'labels', template: 'labels' }) };
const ratingField = { ...base, _id: 'fr', fieldTitle: 'Risk', fieldType: 'number', fieldAi: ai({ output: 'rating' }) };
const numberField = { ...base, _id: 'fn', fieldTitle: 'Hours', fieldType: 'number', fieldAi: ai({ output: 'number', min: 0, max: 40, decimals: 1, outOfRange: 'reject' }) };
const dateField = { ...base, _id: 'fd', fieldTitle: 'Launch', fieldType: 'date', fieldAi: ai({ output: 'date', dateRule: 'after_start' }) };

const ok = (data) => Promise.resolve({ status: 200, data: { status: true, data } });
const draftFor = (output, extra = {}) => ({ ...newAiDraft(), fieldTitle: 'F', output, template: templatesFor(output)[0], prompt: 'Fill it', ...extra });

beforeEach(() => {
    apiRequest.mockReset();
    closeAiFill();
});

describe('choosing what an AI field outputs', () => {
    it('offers long text, one option, labels, a number, a rating and a date', () => {
        expect(AI_OUTPUTS).toEqual(['textarea', 'dropdown', 'labels', 'number', 'rating', 'date']);
        expect(templatesFor('labels')).toEqual(['labels', 'custom']);
        expect(templatesFor('number')).toEqual(['custom']);
        expect(templatesFor('rating')).toEqual(['custom']);
        expect(templatesFor('date')).toEqual(['custom']);
    });

    it('treats number and date fields set up for AI as AI fields', () => {
        [labelsField, ratingField, numberField, dateField].forEach((field) => expect(isAiField(field)).toBe(true));
        expect(aiOutputOf(labelsField)).toBe('labels');
        expect(aiOutputOf(ratingField)).toBe('rating');
        expect(aiOutputOf(numberField)).toBe('number');
        expect(aiOutputOf({ ...base, fieldType: 'dropdown', fieldAi: ai({ template: 'category' }) })).toBe('dropdown');
    });

    it('shows the settings each output needs', async () => {
        const wrapper = mount(AiFieldPanel, { props: { modelValue: newAiDraft(), errors: {} } });
        expect(wrapper.findAll('[data-ai-output]').map((b) => b.attributes('data-ai-output'))).toEqual(AI_OUTPUTS);

        await wrapper.find('[data-ai-output="number"]').trigger('click');
        const number = wrapper.emitted('update:modelValue').at(-1)[0];
        expect(number).toEqual(expect.objectContaining({ output: 'number', template: 'custom' }));
        await wrapper.setProps({ modelValue: number });
        expect(wrapper.find('#ai-field-min').exists()).toBe(true);
        expect(wrapper.find('#ai-field-max').exists()).toBe(true);
        expect(wrapper.find('#ai-field-decimals').exists()).toBe(true);
        expect(wrapper.find('[data-ai-out-of-range="reject"]').exists()).toBe(true);

        await wrapper.setProps({ modelValue: draftFor('date') });
        expect(wrapper.find('#ai-field-min').exists()).toBe(false);
        expect(wrapper.find('#ai-field-date-rule').exists()).toBe(true);

        await wrapper.setProps({ modelValue: draftFor('labels', { options: [{ id: '', label: '' }] }) });
        expect(wrapper.findAll('.afp__option')).toHaveLength(1);

        await wrapper.setProps({ modelValue: draftFor('rating') });
        expect(wrapper.find('#ai-field-min').exists()).toBe(false);
        expect(wrapper.find('#ai-field-date-rule').exists()).toBe(false);
    });

    it('checks the range and decimals of a number', () => {
        const t = (key) => key;
        expect(validateAiDraft(draftFor('number', { min: '10', max: '2' }), t).range).toBeTruthy();
        expect(validateAiDraft(draftFor('number', { min: 'ten' }), t).range).toBeTruthy();
        expect(validateAiDraft(draftFor('number', { decimals: '9' }), t).decimals).toBeTruthy();
        expect(validateAiDraft(draftFor('number', { min: '0', max: '40', decimals: '1' }), t)).toEqual({});
        expect(validateAiDraft(draftFor('labels', { options: [] }), t).options).toBeTruthy();
    });

    it('saves each output on the field type that renders it', () => {
        const number = aiFieldPayload(draftFor('number', { min: '0', max: '40', decimals: '1', outOfRange: 'reject' }));
        expect(number).toEqual(expect.objectContaining({ fieldType: 'number', fieldMinimum: '0', fieldMaximum: '40' }));
        expect(number.fieldAi).toEqual(expect.objectContaining({ output: 'number', min: 0, max: 40, decimals: 1, outOfRange: 'reject' }));

        const open = aiFieldPayload(draftFor('number'));
        expect(open.fieldAi).toEqual(expect.objectContaining({ min: null, max: null, decimals: null, outOfRange: 'clamp' }));

        const rating = aiFieldPayload(draftFor('rating'));
        expect(rating).toEqual(expect.objectContaining({ fieldType: 'number', fieldMinimum: '1', fieldMaximum: '5' }));
        expect(rating.fieldAi.output).toBe('rating');

        const labels = aiFieldPayload(draftFor('labels', { options: [{ id: 'o1', label: 'Backend' }] }));
        expect(labels.fieldType).toBe('dropdown');
        expect(labels.fieldAi.output).toBe('labels');
        expect(labels.fieldOptions.map((o) => o.label)).toEqual(['Backend']);

        const date = aiFieldPayload(draftFor('date', { dateRule: 'after_start' }));
        expect(date).toEqual(expect.objectContaining({ fieldType: 'date', fieldPastFuture: ['Past', 'Future'], fieldDaysDisable: [] }));
        expect(date.fieldAi).toEqual(expect.objectContaining({ output: 'date', dateRule: 'after_start' }));

        expect(aiFieldPayload(newAiDraft()).fieldAi.output).toBe('text');
    });

    it('reads a saved number or date field back into the draft', () => {
        expect(aiDraftFrom(numberField)).toEqual(expect.objectContaining({ output: 'number', template: 'custom', min: '0', max: '40', decimals: '1', outOfRange: 'reject' }));
        expect(aiDraftFrom(dateField)).toEqual(expect.objectContaining({ output: 'date', dateRule: 'after_start' }));
        expect(aiDraftFrom(ratingField).output).toBe('rating');
    });
});

describe('the preview of a typed value', () => {
    const mountDialog = () => mount(AiFieldFillDialog, { props: { teleport: false }, attachTo: document.body });
    const previewWith = async (field, proposal) => {
        apiRequest.mockImplementation(() => ok({ proposals: [{ taskId: 't1', proposalId: 'p1', empty: false, ...proposal }] }));
        const wrapper = mountDialog();
        openAiFill(field, ['t1']);
        await flushPromises();
        return wrapper;
    };

    it('shows labels as the option chips', async () => {
        const wrapper = await previewWith(labelsField, { fieldValue: ['o1', 'o2'], text: 'Backend, Design' });
        expect(wrapper.findAll('[data-ai-chip]').map((chip) => chip.text())).toEqual(['Backend', 'Design']);
        wrapper.unmount();
    });

    it('shows a rating as stars with its number for screen readers', async () => {
        const wrapper = await previewWith(ratingField, { fieldValue: '4', text: '4' });
        const rating = wrapper.find('[data-ai-rating]');
        expect(rating.attributes('aria-label')).toBe('AiFields.rating_value');
        expect(rating.text()).toBe('★★★★☆');
        wrapper.unmount();
    });

    it('shows a date in the workspace date format', async () => {
        const wrapper = await previewWith(dateField, { fieldValue: '2026-10-04T18:30:00.000Z', text: '2026-10-05' });
        expect(wrapper.find('[data-ai-date]').text()).toBe('05/10/2026');
        wrapper.unmount();
    });

    it('says an answer did not fit and retries that task alone', async () => {
        let calls = 0;
        apiRequest.mockImplementation(() => {
            calls += 1;
            return calls === 1
                ? ok({ proposals: [{ taskId: 't1', taskName: 'Login', proposalId: null, empty: true, invalid: true, reason: 'out_of_range', fieldValue: '', text: '' }] })
                : ok({ proposals: [{ taskId: 't1', taskName: 'Login', proposalId: 'p2', empty: false, fieldValue: '12', text: '12' }] });
        });
        const wrapper = mountDialog();
        openAiFill(numberField, ['t1']);
        await flushPromises();
        expect(wrapper.text()).toContain('AiFields.empty_out_of_range');
        expect(wrapper.find('[data-ai-fill-confirm]').attributes('disabled')).toBeDefined();

        await wrapper.find('[data-ai-retry]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('post', '/api/v2/custom-fields/fn/ai/preview', { taskIds: ['t1'] });
        expect(aiFieldFill.proposals[0]).toEqual(expect.objectContaining({ proposalId: 'p2', text: '12' }));
        expect(wrapper.find('[data-ai-retry]').exists()).toBe(false);
        expect(wrapper.find('[data-ai-fill-confirm]').attributes('disabled')).toBeUndefined();
        wrapper.unmount();
    });
});

describe('a task whose last AI fill did not fit', () => {
    const failedTask = {
        _id: 't1',
        customField: { fr: { fieldValue: '2', _id: 'fr' } },
        aiFieldFills: { fr: { at: '2026-09-28T10:00:00.000Z', by: 'u1', trigger: 'manual', failed: { at: '2026-09-29T10:00:00.000Z', reason: 'invalid', trigger: 'auto' } } }
    };

    it('says it could not be filled and offers a retry', async () => {
        const wrapper = mount(AiFieldMark, { props: { def: ratingField, task: failedTask, canFill: true } });
        const mark = wrapper.find('[data-ai-mark]');
        expect(mark.attributes('data-ai-failed')).toBeDefined();
        expect(mark.attributes('title')).toContain('AiFields.fill_failed_on');
        expect(wrapper.find('[data-ai-fill]').attributes('aria-label')).toBe('AiFields.retry_fill');

        apiRequest.mockImplementation(() => ok({ proposals: [] }));
        await wrapper.find('[data-ai-fill]').trigger('click');
        expect(aiFieldFill.open).toBe(true);
        expect(aiFieldFill.taskIds).toEqual(['t1']);
    });

    it('stops saying so once a later fill fits', () => {
        const later = { ...failedTask, aiFieldFills: { fr: { at: '2026-09-30T10:00:00.000Z', by: 'u1', trigger: 'manual' } } };
        const mark = mount(AiFieldMark, { props: { def: ratingField, task: later, canFill: true } }).find('[data-ai-mark]');
        expect(mark.attributes('data-ai-failed')).toBeUndefined();
    });

    it('still shows the value a List or Table cell shows for a number', () => {
        const wrapper = mount(CustomFieldCell, { props: { def: ratingField, task: failedTask, editable: false } });
        expect(wrapper.find('.cfc__text').text()).toBe('2');
    });
});
