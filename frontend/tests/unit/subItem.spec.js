import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from '@vue/compiler-sfc';
import { defineComponent, h, ref } from 'vue';

const { apiRequest, toast, store, router, route, perms, counts } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    store: {
        getters: {
            'settings/companyUsers': [{ userId: 'user-1' }],
            'settings/companyOwnerDetail': { userId: 'owner-1' },
            'projectData/projects': { data: [] },
        },
        commit: vi.fn(),
    },
    router: { push: vi.fn() },
    route: { params: {}, query: { tab: 'ProjectBoardView' } },
    perms: { granted: new Set() },
    counts: { sprint: 0, folder: 0 },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route, useRouter: () => router }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        checkPermission: (key) => (perms.granted.has(key) ? true : null),
        showCounts: ({ key }) => ({ count: counts[key], styles: {} }),
    }),
    useGetterFunctions: () => ({ getUser: () => ({ id: 'user-1', Employee_Name: 'Me' }) }),
}));

import * as env from '@/config/env';
import SubItem from '@/components/molecules/SubItem/SubItem.vue';

const DropDownStub = defineComponent({
    props: ['title', 'id', 'mode'],
    emits: ['isVisible'],
    render() {
        return h('div', { class: 'dd', 'data-title': this.title }, [
            h('button', { class: 'dd-toggle', onClick: () => this.$emit('isVisible', true) }, this.$slots.button?.()),
            h('div', { class: 'dd-options' }, this.$slots.options?.()),
        ]);
    },
});
const OptionStub = defineComponent({ render() { return h('div', { class: 'opt', role: 'menuitem' }, this.$slots.default?.()); } });
const SidebarStub = defineComponent({
    name: 'ConfirmationSidebar',
    props: ['modelValue', 'title', 'message', 'acceptButton', 'acceptButtonClass', 'confirmationString', 'showSpinner'],
    emits: ['confirm', 'update:modelValue'],
    render() { return h('div', { class: 'sidebar', 'data-open': String(this.modelValue), 'data-title': this.title, 'data-message': this.message, 'data-accept': this.acceptButton }); },
});
const MoveStub = defineComponent({
    name: 'MoveToFolderModal',
    props: ['modelValue', 'folders', 'currentFolderId'],
    emits: ['select', 'update:modelValue'],
    render() { return h('div', { class: 'move', 'data-open': String(this.modelValue), 'data-folders': this.folders.map((f) => f.name).join('|') }); },
});
const InputStub = defineComponent({
    name: 'SprintFolderInput',
    props: ['createSprint', 'createFolder', 'folder', 'item', 'subItems'],
    emits: ['cancel'],
    render() { return h('div', { class: 'name-input', 'data-create-folder': String(this.createFolder), 'data-item': this.item?.name || '' }); },
});
const SpinnerStub = defineComponent({ props: ['isSpinner'], render() { return h('i', { class: 'spinner-stub', 'data-on': String(this.isSpinner) }); } });
const ImportStub = defineComponent({ render() { return h('span', { class: 'import-stub' }); } });

const sprintData = (extra = {}) => ({ id: 's1', name: 'Sprint One', tasks: 7, ...extra });
const folderData = (extra = {}) => ({
    folderId: 'f1', name: 'Phase A',
    sprintsObj: { s1: { id: 's1', name: 'Nested Sprint', folderId: 'f1', tasks: 2 }, s2: { id: 's2', name: 'Gone', folderId: 'f1', deletedStatusKey: 1 } },
    ...extra,
});

let wrapper;
const mountItem = (props = {}, { archived = false, project = {}, width = 1280 } = {}) => {
    wrapper = mount(SubItem, {
        props: { data: sprintData(), ...props },
        attachTo: document.body,
        global: {
            mocks: { $route: route },
            stubs: { DropDown: DropDownStub, DropDownOption: OptionStub, ConfirmationSidebar: SidebarStub, MoveToFolderModal: MoveStub, SprintFolderInput: InputStub, Spinner: SpinnerStub, ImportTaskButton: ImportStub },
            provide: {
                $userId: ref('user-1'),
                $companyId: ref('company-1'),
                $clientWidth: ref(width),
                showArchivedProjects: ref(archived),
                selectedProject: ref({
                    _id: 'p1', ProjectName: 'Apollo', isGlobalPermission: false,
                    ProjectRequiredComponent: [{ keyName: 'ProjectBoardView' }, { keyName: 'ProjectListView', setAsDefault: true }],
                    sprintsfolders: { f1: { folderId: 'f1', name: 'Phase A' }, f2: { folderId: 'f2', name: 'Phase B' }, f3: { folderId: 'f3', name: 'Dead', deletedStatusKey: 1 } },
                    ...project,
                }),
            },
        },
    });
    return wrapper;
};
const grant = (...keys) => keys.forEach((k) => perms.granted.add(k));
const optionTexts = () => wrapper.findAll('.dd-options .opt').map((o) => o.text());
const optionByText = (text) => wrapper.findAll('.dd-options .opt').find((o) => o.text() === text);

beforeEach(() => {
    apiRequest.mockReset().mockResolvedValue({ data: { status: true, data: { id: 's1', name: 'Sprint One' } } });
    toast.success.mockReset();
    toast.error.mockReset();
    store.commit.mockReset();
    router.push.mockReset();
    perms.granted = new Set();
    route.params = {};
    route.query = { tab: 'ProjectListView' };
    counts.sprint = 0;
    counts.folder = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
});

describe('SubItem row', () => {
    it('shows the sprint name, a title for the truncated name and the task total', () => {
        mountItem();
        const name = wrapper.get('.project-sb-desc');
        expect(name.text()).toBe('Sprint One');
        expect(name.attributes('title')).toBe('Sprint One');
        expect(wrapper.get('.sptint-total').text()).toBe('7');
    });

    it('shows 0 for a sprint with a negative or missing task count', () => {
        mountItem({ data: sprintData({ tasks: -3 }) });
        expect(wrapper.get('.sptint-total').text()).toBe('0');
    });

    it('in the archived view shows the archived task count instead', () => {
        mountItem({ data: sprintData({ deletedStatusKey: 2, archiveTaskCount: 4 }) }, { archived: true });
        expect(wrapper.get('.sptint-total').text()).toBe('4');
    });

    it('shows the unread-comments badge, capped at +99', async () => {
        counts.sprint = 5;
        mountItem();
        expect(wrapper.get('.child-count-block').text()).toBe('5');
        wrapper.unmount();
        counts.sprint = 140;
        mountItem();
        expect(wrapper.get('.child-count-block').text()).toBe('+99');
    });

    it('a folder shows the badge for its lists and no task total', () => {
        counts.folder = 3;
        mountItem({ data: folderData(), folder: true });
        expect(wrapper.find('.sptint-total').exists()).toBe(false);
        expect(wrapper.get('.child-count-block').text()).toBe('3');
        expect(wrapper.find('.spinner-stub').exists()).toBe(false);
    });

    it('highlights the row of the sprint currently open', () => {
        route.params = { sprintId: 's1' };
        mountItem();
        expect(wrapper.get('.project-item').classes()).toContain('bg-light-purple-v1');
    });

    it('highlights an open folder, and a second shade when a list inside it is open', () => {
        route.params = { folderId: 'f1' };
        mountItem({ data: folderData(), folder: true });
        expect(wrapper.get('.project-item').classes()).toContain('bg-light-purple-v1');
        wrapper.unmount();
        route.params = { folderId: 'f1', sprintId: 's1' };
        mountItem({ data: folderData(), folder: true });
        expect(wrapper.get('.project-item').classes()).toContain('bg-light-purple-v2');
    });

    it('marks archived and deleted rows with their icon', () => {
        mountItem({ data: sprintData({ deletedStatusKey: 2 }) }, { archived: true });
        expect(wrapper.find('img[alt="inventoryIcon"]').exists()).toBe(true);
    });
});

describe('SubItem navigation', () => {
    it('opens a loose sprint on its current tab and tells parents to close the sidebar', async () => {
        mountItem();
        await wrapper.get('.item-left').trigger('click');
        expect(router.push).toHaveBeenCalledWith({
            name: 'ProjectSprint', params: { id: 'p1', sprintId: 's1' }, query: { tab: 'ProjectListView' },
        });
        expect(wrapper.emitted('changeProject')).toHaveLength(1);
        expect(wrapper.emitted('handleSidebarClose')).toHaveLength(1);
    });

    it('falls back to the default view when the current tab is not one of the project views', async () => {
        route.query = { tab: 'Gone', other: '1' };
        mountItem();
        await wrapper.get('.item-left').trigger('click');
        expect(router.push.mock.calls[0][0].query).toEqual({ tab: 'ProjectListView', other: '1' });
    });

    it('opens a folder and a list inside a folder on their own routes', async () => {
        mountItem({ data: folderData(), folder: true });
        await wrapper.get('.item-left').trigger('click');
        expect(router.push.mock.calls[0][0]).toMatchObject({ name: 'ProjectFolder', params: { id: 'p1', folderId: 'f1' } });
        wrapper.unmount();
        mountItem({ data: { id: 's9', name: 'In folder', folderId: 'f1' } });
        await wrapper.get('.item-left').trigger('click');
        expect(router.push.mock.calls[1][0]).toMatchObject({ name: 'ProjectFolderSprint', params: { id: 'p1', folderId: 'f1', sprintId: 's9' } });
    });
});

describe('SubItem expand and children', () => {
    it('shows the arrow only when there are lists, rotates it when expanded and emits change on click', async () => {
        mountItem({ data: folderData(), folder: true });
        const arrow = wrapper.get('.drop__arrow-div img');
        expect(arrow.attributes('style')).toContain('rotateZ(0deg)');
        await arrow.trigger('click');
        expect(wrapper.emitted('change')[0][0]).toMatchObject({ folderId: 'f1' });
        expect(wrapper.emitted('changeProject')).toBeUndefined();
        await wrapper.setProps({ isExpanded: true });
        expect(wrapper.get('.drop__arrow-div img').attributes('style')).toContain('rotateZ(90deg)');
    });

    it('has no arrow for an item without lists', () => {
        mountItem();
        expect(wrapper.find('.drop__arrow-div img').exists()).toBe(false);
    });

    it('lists the child sprints when expanded and leaves out deleted ones', () => {
        mountItem({ data: folderData(), folder: true, isExpanded: true });
        const names = wrapper.findAll('.pl-10px .project-sb-desc').map((n) => n.text());
        expect(names).toEqual(['Nested Sprint']);
    });

    it('keeps children hidden while collapsed', () => {
        mountItem({ data: folderData(), folder: true, isExpanded: false });
        expect(wrapper.find('.pl-10px').exists()).toBe(false);
    });
});

describe('SubItem permissions and menu', () => {
    it('read-only: without list or edit permission there is no menu', () => {
        mountItem();
        expect(wrapper.find('.dd').exists()).toBe(false);
    });

    it('edit permission without permission to see the list still hides the menu', () => {
        grant('project.project_sprint_name_edit');
        mountItem();
        expect(wrapper.find('.dd').exists()).toBe(false);
    });

    it('the menu button names the item for assistive technology and the dropdown carries its title', () => {
        grant('project.project_list', 'project.project_sprint_name_edit');
        mountItem();
        expect(wrapper.get('.dd').attributes('data-title')).toBe('Sprint One');
        expect(wrapper.get('.dd-toggle img').attributes('alt')).toBe('Projects.actions_for_item');
    });

    it('a sprint with every right sees rename, archive, move and delete, and only those the person may use', () => {
        grant('project.project_list', 'project.project_sprint_name_edit', 'project.sprint_archive', 'project.sprint_delete');
        mountItem();
        expect(optionTexts()).toEqual(['Projects.rename', 'Projects.archive', 'Projects.move_to_folder', 'Projects.delete']);
        wrapper.unmount();
        perms.granted = new Set(['project.project_list', 'project.sprint_archive']);
        mountItem();
        expect(optionTexts()).not.toContain('Projects.rename');
        expect(optionTexts()).not.toContain('Projects.delete');
    });

    // Move to folder is shown on folder count alone, so a person who may only delete is offered a move that edits the sprint.
    it.fails('does not offer Move to folder to someone who may only delete', () => {
        grant('project.project_list', 'project.sprint_delete');
        mountItem();
        expect(optionTexts()).toEqual(['Projects.delete']);
    });

    it('offers Move to folder only for a sprint, and lists live folders excluding deleted ones', async () => {
        grant('project.project_list', 'project.project_sprint_name_edit');
        mountItem();
        expect(optionTexts()).toContain('Projects.move_to_folder');
        await optionByText('Projects.move_to_folder').trigger('click');
        expect(wrapper.get('.move').attributes()).toMatchObject({ 'data-open': 'true', 'data-folders': 'Phase A|Phase B' });
    });

    it('a folder menu offers create-list, rename, archive and delete', () => {
        grant('project.project_list', 'project.project_sprint_create', 'project.project_folder_name_edit', 'project.folder_archive', 'project.folder_delete');
        mountItem({ data: folderData(), folder: true });
        expect(optionTexts()).toEqual(['Projects.create_new_list', 'Projects.rename', 'Projects.archive', 'Projects.delete']);
    });

    it('in the archived view the menu offers restore and delete, not rename or archive', () => {
        grant('project.project_list', 'project.sprint_restore', 'project.sprint_delete', 'project.project_sprint_name_edit', 'project.sprint_archive');
        mountItem({ data: sprintData({ deletedStatusKey: 2 }) }, { archived: true });
        expect(optionTexts()).toEqual(['Projects.restore', 'Projects.delete']);
    });

    it('hides the task total and badge while the menu is open', async () => {
        grant('project.project_list', 'project.project_sprint_name_edit');
        counts.sprint = 2;
        mountItem();
        await wrapper.get('.dd-toggle').trigger('click');
        expect(wrapper.find('.sptint-total').exists()).toBe(false);
        expect(wrapper.find('.child-count-block').exists()).toBe(false);
    });

    it('menu icon class follows the screen size', () => {
        grant('project.project_list', 'project.project_sprint_name_edit');
        mountItem({}, { width: 500 });
        expect(wrapper.get('.dd-toggle img').classes()).toContain('project-option-mobile');
    });
});

describe('SubItem rename and create', () => {
    it('Rename shows the name editor for the sprint and hides it on cancel', async () => {
        grant('project.project_list', 'project.project_sprint_name_edit');
        mountItem();
        expect(wrapper.find('.name-input').exists()).toBe(false);
        await optionByText('Projects.rename').trigger('click');
        expect(wrapper.get('.name-input').attributes('data-item')).toBe('Sprint One');
        expect(wrapper.get('.name-input').attributes('data-create-folder')).toBe('false');
        wrapper.getComponent(InputStub).vm.$emit('cancel');
        await flushPromises();
        expect(wrapper.find('.name-input').exists()).toBe(false);
    });

    it('renaming a folder opens the folder editor', async () => {
        grant('project.project_list', 'project.project_folder_name_edit');
        mountItem({ data: folderData(), folder: true });
        await optionByText('Projects.rename').trigger('click');
        expect(wrapper.get('.name-input').attributes('data-create-folder')).toBe('true');
    });

    it('Create new list expands the folder and opens the editor', async () => {
        grant('project.project_list', 'project.project_sprint_create');
        mountItem({ data: folderData(), folder: true });
        await optionByText('Projects.create_new_list').trigger('click');
        expect(wrapper.emitted('change')[0][0]).toMatchObject({ folderId: 'f1', isNewClicked: true });
        expect(wrapper.find('.name-input').exists()).toBe(true);
    });
});

describe('SubItem archive, delete and restore', () => {
    const sidebar = () => wrapper.get('.sidebar');
    const confirm = async () => { wrapper.getComponent(SidebarStub).vm.$emit('confirm'); await flushPromises(); };

    it('archive asks for confirmation with archive wording, then archives the sprint and confirms', async () => {
        grant('project.project_list', 'project.sprint_archive');
        mountItem();
        expect(sidebar().attributes('data-open')).toBe('false');
        await optionByText('Projects.archive').trigger('click');
        expect(sidebar().attributes()).toMatchObject({ 'data-open': 'true', 'data-title': 'Projects.archive', 'data-message': 'conformationmsg.archive', 'data-accept': 'Projects.archive' });
        await confirm();
        const [method, url, body] = apiRequest.mock.calls[0];
        expect([method, url]).toEqual(['patch', `${env.SPRINT}/s1`]);
        expect(body).toMatchObject({ type: 'updateSprint', projectId: 'p1', updateObject: { $set: { deletedStatusKey: 2 } } });
        expect(store.commit).toHaveBeenCalledWith('projectData/mutateSprints', expect.objectContaining({ op: 'modified' }));
        expect(toast.success).toHaveBeenCalledWith('Toast.Sprint archived successfully', expect.anything());
        expect(wrapper.emitted('updateFolderAndSprint')[0]).toEqual([{ id: 's1', name: 'Sprint One' }, 'Sprint']);
        expect(sidebar().attributes('data-open')).toBe('false');
    });

    it('delete uses delete wording and soft-deletes with key 1', async () => {
        grant('project.project_list', 'project.sprint_delete');
        mountItem();
        await optionByText('Projects.delete').trigger('click');
        expect(sidebar().attributes()).toMatchObject({ 'data-title': 'Projects.delete', 'data-message': 'conformationmsg.delete' });
        await confirm();
        expect(apiRequest.mock.calls[0][2].updateObject).toEqual({ $set: { deletedStatusKey: 1 } });
        expect(toast.success).toHaveBeenCalledWith('Toast.Sprint deleted successfully', expect.anything());
    });

    it('archiving a folder goes to the folder route', async () => {
        grant('project.project_list', 'project.folder_archive');
        mountItem({ data: folderData(), folder: true });
        await optionByText('Projects.archive').trigger('click');
        await confirm();
        const [, url, body] = apiRequest.mock.calls[0];
        expect(url).toBe(`${env.FOLDER}/f1`);
        expect(body).toMatchObject({ type: 'updateFolder', sprints: ['s1'] });
        expect(store.commit).toHaveBeenCalledWith('projectData/mutateFolders', expect.anything());
        expect(toast.success).toHaveBeenCalledWith('Toast.Folder archived successfully', expect.anything());
    });

    it('archiving a list nested in a folder is sent as a sprint update', async () => {
        grant('project.project_list', 'project.sprint_archive');
        mountItem({ data: { id: 's9', name: 'In folder', folderId: 'f1' } });
        await optionByText('Projects.archive').trigger('click');
        await confirm();
        const [, url, body] = apiRequest.mock.calls[0];
        expect(url).toBe(`${env.SPRINT}/s9`);
        expect(body.type).toBe('updateSprint');
    });

    it('restore patches key 0 straight away and says it restored', async () => {
        grant('project.project_list', 'project.sprint_restore');
        mountItem({ data: sprintData({ deletedStatusKey: 2 }) }, { archived: true });
        await optionByText('Projects.restore').trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls[0][2].updateObject).toEqual({ $set: { deletedStatusKey: 0 } });
        expect(toast.success).toHaveBeenCalledWith('Toast.Sprint restored successfully', expect.anything());
    });

    it('a refusal (HTTP 200, status false) shows the server message and does not touch the store', async () => {
        grant('project.project_list', 'project.sprint_archive');
        apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Not allowed', data: {} } });
        mountItem();
        await optionByText('Projects.archive').trigger('click');
        await confirm();
        expect(toast.error).toHaveBeenCalledWith('Not allowed', expect.anything());
        expect(toast.success).not.toHaveBeenCalled();
        expect(store.commit).not.toHaveBeenCalled();
        expect(sidebar().attributes('data-open')).toBe('false');
    });

    it('a refusal without a message falls back to the generic error key', async () => {
        grant('project.project_list', 'project.sprint_archive');
        apiRequest.mockResolvedValue({ data: { status: false } });
        mountItem();
        await optionByText('Projects.archive').trigger('click');
        await confirm();
        expect(toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
    });

    it('a network error shows the generic error and closes the sidebar', async () => {
        grant('project.project_list', 'project.sprint_archive');
        apiRequest.mockRejectedValue(new Error('offline'));
        mountItem();
        await optionByText('Projects.archive').trigger('click');
        await confirm();
        expect(toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
        expect(sidebar().attributes('data-open')).toBe('false');
        expect(wrapper.getComponent(SidebarStub).props('showSpinner')).toBe(false);
    });
});

describe('SubItem move to folder', () => {
    const openAndSelect = async (folder) => {
        grant('project.project_list', 'project.project_sprint_name_edit');
        mountItem({ data: sprintData({ folderId: 'f2', folderName: 'Phase B' }) });
        await optionByText('Projects.move_to_folder').trigger('click');
        wrapper.getComponent(MoveStub).vm.$emit('select', folder);
        await flushPromises();
    };

    it('moves the sprint into the chosen folder, confirms and closes the picker', async () => {
        await openAndSelect({ id: 'f1', name: 'Phase A' });
        const [method, url, body] = apiRequest.mock.calls[0];
        expect([method, url]).toEqual(['patch', `${env.SPRINT}/s1`]);
        expect(body.updateObject).toEqual({ $set: { folderId: 'f1', folderName: 'Phase A' } });
        expect(body.historyData).toEqual({ type: 'moved' });
        expect(store.commit).toHaveBeenCalledWith('projectData/relocateSprint', { data: expect.anything(), oldFolderId: 'f2' });
        expect(toast.success).toHaveBeenCalledWith('Toast.Sprint updated successfully', expect.anything());
        expect(wrapper.get('.move').attributes('data-open')).toBe('false');
    });

    it('moving back to the root sends no folder', async () => {
        await openAndSelect(null);
        expect(apiRequest.mock.calls[0][2].updateObject).toEqual({ $set: { folderId: null, folderName: '' } });
    });

    it('shows an error and closes the picker when the move fails or throws', async () => {
        apiRequest.mockResolvedValue({ data: { status: false } });
        await openAndSelect({ id: 'f1', name: 'Phase A' });
        expect(toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
        expect(wrapper.get('.move').attributes('data-open')).toBe('false');
        apiRequest.mockRejectedValue(new Error('x'));
        wrapper.getComponent(MoveStub).vm.$emit('select', null);
        await flushPromises();
        expect(toast.error).toHaveBeenCalledTimes(2);
    });
});

describe('SubItem favourites', () => {
    const star = () => wrapper.get('img[alt="favourite star"]');

    it('shows a filled star for a favourite and an empty one otherwise, and none in the archived list', () => {
        mountItem({ data: sprintData({ favouriteTasks: [{ userId: 'user-1' }] }) });
        const filled = star().attributes('src');
        wrapper.unmount();
        mountItem();
        expect(star().attributes('src')).not.toBe(filled);
        wrapper.unmount();
        mountItem({ isShowArchived: true });
        expect(wrapper.find('img[alt="favourite star"]').exists()).toBe(false);
    });

    it('clicking the star favourites without opening the sprint', async () => {
        mountItem({ subItems: [sprintData()] });
        await star().trigger('click');
        await flushPromises();
        const [method, url, body] = apiRequest.mock.calls[0];
        expect([method, url]).toEqual(['put', `/api/v1/${env.PROJECTSPRINTUPDATE}/s1`]);
        expect(body).toEqual({ updateObject: { favouriteTasks: { userId: 'user-1' } }, key: '$addToSet' });
        expect(toast.success).toHaveBeenCalledWith('Toast.Added_to_favourite', expect.anything());
        expect(router.push).not.toHaveBeenCalled();
    });

    it('clicking the star of a favourite removes it', async () => {
        const data = sprintData({ favouriteTasks: [{ userId: 'user-1' }] });
        mountItem({ data, subItems: [data] });
        await star().trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls[0][2].key).toBe('$pull');
        expect(toast.success).toHaveBeenCalledWith('Toast.Removed_from_favourite', expect.anything());
    });

    // The catch branch only logs: the spinner keeps spinning and the person is told nothing.
    it.fails('tells the person and stops the spinner when favouriting fails', async () => {
        apiRequest.mockRejectedValue(new Error('offline'));
        mountItem({ subItems: [sprintData()] });
        await star().trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Toast.something_went_wrong', expect.anything());
        expect(wrapper.get('.spinner-stub').attributes('data-on')).toBe('false');
    });

    it('shows the spinner while the request is pending', async () => {
        apiRequest.mockReturnValue(new Promise(() => {}));
        mountItem({ subItems: [sprintData()] });
        await star().trigger('click');
        expect(wrapper.get('.spinner-stub').attributes('data-on')).toBe('true');
    });

    it('sorts favourite lists first when only favourites are wanted', () => {
        const data = folderData({ sprintsObj: {
            a: { id: 'a', name: 'Plain', createdAt: { seconds: 5 } },
            b: { id: 'b', name: 'Starred', createdAt: { seconds: 1 }, favouriteTasks: [{ userId: 'user-1' }] },
        } });
        mountItem({ data, folder: true, isExpanded: true, filterFavorites: true });
        expect(wrapper.findAll('.pl-10px .project-sb-desc').map((n) => n.text())).toEqual(['Starred', 'Plain']);
    });
});

describe('SubItem keyboard access', () => {
    // The row and star are click-only div/img elements: no role, no tabindex, no key handler.
    it.fails('the row that opens a sprint can be reached and activated with the keyboard', async () => {
        mountItem();
        const row = wrapper.get('.item-left');
        expect(row.attributes('tabindex')).toBeDefined();
        await row.trigger('keydown', { key: 'Enter' });
        expect(router.push).toHaveBeenCalled();
    });
});

describe('SubItem copy', () => {
    const source = readFileSync(resolve(__dirname, '../../src/components/molecules/SubItem/SubItem.vue'), 'utf8');
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

    // Icon alts (inventoryIcon, deleteIcon, favourite star, ...) are hard-coded English and are announced by screen readers.
    it.fails('has no hard-coded visible text or attributes in the template', () => {
        expect(bareCopy()).toEqual([]);
    });

    it('menu entries and confirmation copy are rendered from i18n keys', () => {
        grant('project.project_list', 'project.project_sprint_name_edit', 'project.sprint_archive', 'project.sprint_delete');
        mountItem();
        optionTexts().forEach((text) => expect(text).toMatch(/^Projects\.[a-z_]+$/));
        expect(wrapper.get('.sidebar').attributes('data-title')).toMatch(/^Projects\./);
    });
});
