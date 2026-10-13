import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, openTask } = vi.hoisted(() => ({ apiRequest: vi.fn(), openTask: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable/exportDownload', () => ({ downloadExport: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({ storageHelper: () => ({ handleStorageImageRequest: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask }));

import FormSubmissions from '@/views/Projects/FormsView/FormSubmissions.vue';

const openable = { id: 't1', projectId: 'p1', sprintId: 's1', folderId: 'f1' };
const submission = (id, over) => ({ _id: id, submittedAt: '2026-09-01T10:00:00Z', taskKey: '', task: null, values: {}, files: {}, ...over });

const mountWith = async (submissions) => {
    apiRequest.mockResolvedValue({ data: { status: true, data: { columns: [], submissions, total: submissions.length, page: 1, pages: 1 } } });
    const wrapper = mount(FormSubmissions, { props: { formId: 'form-1' } });
    await flushPromises();
    return wrapper;
};

describe('form responses open the task they created', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        openTask.mockReset();
    });

    it('opens the task panel from the key, with where the task lives now', async () => {
        const wrapper = await mountWith([submission('a', { taskKey: 'OPN-1', task: openable })]);
        const link = wrapper.find('[data-test="form-task-link"]');
        expect(link.text()).toBe('OPN-1');
        await link.trigger('click');
        expect(openTask).toHaveBeenCalledWith({ companyId: 'company-1', projectId: 'p1', sprintId: 's1', folderId: 'f1', taskId: 't1' });
    });

    it('shows the key as plain text, with no request, when the task cannot be opened', async () => {
        const wrapper = await mountWith([submission('a', { taskKey: 'OPN-2' }), submission('b', { taskKey: 'OPN-3', task: openable })]);
        const cells = wrapper.findAll('td.fs__task');
        expect(cells[0].text()).toBe('OPN-2');
        expect(cells[0].find('button').exists()).toBe(false);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(wrapper.find('.fs__err').exists()).toBe(false);
    });
});
