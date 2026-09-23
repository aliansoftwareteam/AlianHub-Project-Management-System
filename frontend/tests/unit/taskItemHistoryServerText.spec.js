import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import fs from 'fs';
import path from 'path';

const { apiRequest, updateTags } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    updateTags: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: apiRequest }));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateTags } }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ makeUniqueId: () => 'u1', checkPermission: () => true, checkApps: () => true, sanitizeInput: (value) => value }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: 'Ada', companyOwnerId: 'owner-1' }) }),
}));
vi.mock('vuex', () => ({
    createStore: () => ({ getters: {}, dispatch: vi.fn(), commit: vi.fn() }),
    useStore: () => ({ getters: { 'settings/companyOwnerDetail': { userId: 'owner-1' } }, commit: vi.fn() }),
}));
vi.mock('@/store/index', () => ({ default: { getters: {}, commit: vi.fn() } }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));

import * as env from '@/config/env';
import TagChip from '@/components/atom/TagChip/TagChip.vue';
import { createTag, addTaskTag } from '@/components/molecules/TagList/helper.js';

const SRC = path.resolve(__dirname, '../../src');
const posted = () => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && [env.HANDLE_HISTORY, env.HANDLE_NOTIFICATION].includes(url));

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(() => Promise.resolve({ status: 200, data: { status: true } }));
    updateTags.mockReset();
    updateTags.mockImplementation(() => Promise.resolve({ status: true }));
});

describe('task item changes leave their history text to the server', () => {
    it.each([
        'components/molecules/TagList/CreateTagPopup.vue',
        'components/atom/TagChip/TagChip.vue',
        'components/molecules/CheckList/CheckList.vue',
        'plugins/customFieldView/component/molecules/customFieldViewColumn/customFieldListViewColumn.vue',
    ])('%s posts no history or notification text', (file) => {
        const source = fs.readFileSync(path.join(SRC, file), 'utf8');
        expect(source).not.toMatch(/HANDLE_HISTORY|HANDLE_NOTIFICATION/);
    });

    it('a custom field value saved from the task detail posts no history text', () => {
        const source = fs.readFileSync(path.join(SRC, 'components/molecules/TaskDetailTab/TaskDetailTab.vue'), 'utf8');
        expect(source).not.toContain("'Project_Category'");
    });

    it('removing a tag from a task saves the tag and posts no text', async () => {
        const ids = { companyId: 'company-1', projectId: 'project-1', sprintId: 'sprint-1', taskId: 'task-1', tagsArray: ['t1'] };
        const wrapper = mount(TagChip, {
            props: { data: { uid: 't1', tagName: 'Urgent', tagColor: '#f00', tagBgColor: '#f0035' }, ids, tagsArray: [], taskId: 'task-1', sprintId: 'sprint-1', taskName: 'Fix login' },
            global: { stubs: { DropDown: true, ConfirmationSidebar: true, InputText: true } },
        });
        await wrapper.find('img.tagHover__icon-close').trigger('click');
        await flushPromises();

        expect(updateTags).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1', tagId: 't1', operation: 'remove' }));
        expect(posted()).toEqual([]);
    });

    it('a new tag is saved on the project before it is added to the task, so the server can name it', async () => {
        const ids = { companyId: 'company-1', projectId: 'project-1', sprintId: 'sprint-1', taskId: 'task-1' };
        const order = [];
        apiRequest.mockImplementation(async () => { order.push('project tag'); return { status: 200 }; });
        updateTags.mockImplementation(async () => { order.push('task tag'); return { status: true }; });

        await createTag(ids, { uid: 't2', tagName: 'New' }).then(() => addTaskTag(ids, 't2'));
        await flushPromises();
        expect(order).toEqual(['project tag', 'task tag']);
        expect(posted()).toEqual([]);

        const popup = fs.readFileSync(path.join(SRC, 'components/molecules/TagList/CreateTagPopup.vue'), 'utf8');
        expect(popup).toMatch(/createTag\(ids\.value,\s*obj\)\.then\(/);
    });
});
