import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: [] })), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/components/organisms/TaskInSidebar/TaskInSidebar.vue', () => ({ default: { name: 'TaskInSidebar', render: () => null } }));

import MoveToFolderModal from '@/components/molecules/MoveToFolder/MoveToFolderModal.vue';
import SideBarSprintFolderData from '@/components/organisms/SideBarSprintFolderData/SideBarSprintFolderData.vue';
import { listsOf } from '@/components/organisms/QuickCreateTask/quickCreateTask';
import { listsOfProject } from '@/utils/aiTargets';
import { sprintOptionsOf } from '@/components/organisms/WorkspaceImport/workspaceImportState';
import { listLabel, nestedFolders } from '@/utils/folderTree';

const sprint = (id, extra = {}) => ({ id, _id: id, name: `List ${id}`, deletedStatusKey: 0, ...extra });
const entry = (id, name, extra = {}) => ({ folderId: id, _id: id, id, name, sprintsObj: {}, deletedStatusKey: 0, parentFolderId: null, ...extra });

const project = {
    _id: 'p1',
    sprintsObj: { r1: sprint('r1') },
    sprintsfolders: {
        design: entry('design', 'Design', { sprintsObj: { d1: sprint('d1', { folderId: 'design' }) } }),
        icons: entry('icons', 'Icons', { parentFolderId: 'design', sprintsObj: { i1: sprint('i1', { folderId: 'icons' }) } }),
        old: entry('old', 'Old', { deletedStatusKey: 2, sprintsObj: { o1: sprint('o1', { folderId: 'old' }) } }),
        oldSub: entry('oldSub', 'Old sub', { parentFolderId: 'old', deletedStatusKey: 6, sprintsObj: { o2: sprint('o2', { folderId: 'oldSub' }) } })
    }
};

const mounted = [];
const show = (component, props) => {
    const wrapper = mount(component, { props });
    mounted.push(wrapper);
    return wrapper;
};
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

describe('the label of a list in a picker', () => {
    it('reads folder / subfolder / list', () => {
        expect(listLabel({ name: 'Sprint 1' })).toBe('Sprint 1');
        expect(listLabel({ name: 'Sprint 1', folderName: 'Icons' })).toBe('Icons / Sprint 1');
        expect(listLabel({ name: 'Sprint 1', folderName: 'Icons', folderPath: 'Design / Icons' })).toBe('Design / Icons / Sprint 1');
    });
});

describe('the move-to-folder picker', () => {
    const folders = nestedFolders(project.sprintsfolders).map((folder) => ({ id: folder.folderId, name: folder.name, depth: folder.depth }));

    it('lists each subfolder under its folder, set in from it', () => {
        const wrapper = show(MoveToFolderModal, { modelValue: true, folders, currentFolderId: 'icons' });
        const rows = wrapper.findAll('.mtf__item:not(.mtf__item--root)');
        expect(rows.map((row) => row.find('.mtf__name').text())).toEqual(['Design', 'Icons']);
        expect(rows.map((row) => row.classes('mtf__item--sub'))).toEqual([false, true]);
        expect(rows[1].classes('mtf__item--active')).toBe(true);
    });

    it('answers the folder that is picked, and null for the top level', async () => {
        const wrapper = show(MoveToFolderModal, { modelValue: true, folders, currentFolderId: 'icons' });
        await wrapper.findAll('.mtf__item:not(.mtf__item--root)')[0].trigger('click');
        await wrapper.find('.mtf__item--root').trigger('click');
        expect(wrapper.emitted('select')).toEqual([[folders[0]], [null]]);
    });

    it('says what is being moved and names the top level when it is told', () => {
        const wrapper = show(MoveToFolderModal, { modelValue: true, folders: [], currentFolderId: null, hint: 'Pick where Icons goes', rootLabel: 'Top level' });
        expect(wrapper.text()).toContain('Pick where Icons goes');
        expect(wrapper.find('.mtf__item--root .mtf__name').text()).toBe('Top level');
    });
});

describe('the folder rows of the convert and move sidebars', () => {
    it('show a subfolder by its path and keep its own name as data', () => {
        const [, icons] = nestedFolders(project.sprintsfolders);
        const wrapper = show(SideBarSprintFolderData, { data: icons, folder: true, selectedProjectData: project });
        expect(wrapper.find('.sbf__name').text()).toBe('Design / Icons');
        expect(icons.name).toBe('Icons');
    });

    it('show a top-level folder and a list by name', () => {
        expect(show(SideBarSprintFolderData, { data: project.sprintsfolders.design, folder: true, selectedProjectData: project }).find('.sbf__name').text()).toBe('Design');
        expect(show(SideBarSprintFolderData, { data: sprint('r1'), selectedProjectData: project }).find('.sbf__name').text()).toBe('List r1');
    });
});

describe('the lists a picker offers', () => {
    const folderDocs = [
        { _id: 'design', name: 'Design', deletedStatusKey: 0, parentFolderId: null },
        { _id: 'icons', name: 'Icons', deletedStatusKey: 0, parentFolderId: 'design' },
        { _id: 'old', name: 'Old', deletedStatusKey: 2, parentFolderId: null },
        { _id: 'oldSub', name: 'Old sub', deletedStatusKey: 6, parentFolderId: 'old' },
        { _id: 'underOld', name: 'Under old', deletedStatusKey: 0, parentFolderId: 'old' }
    ];
    const sprintDocs = [
        { _id: 'r1', name: 'Root list', deletedStatusKey: 0 },
        { _id: 'i1', name: 'Icon list', deletedStatusKey: 0, folderId: 'icons' },
        { _id: 'o2', name: 'Old list', deletedStatusKey: 0, folderId: 'oldSub' },
        { _id: 'u1', name: 'Under old list', deletedStatusKey: 0, folderId: 'underOld' }
    ];

    it('gives the create dialog the path to show and the immediate folder to store', () => {
        const lists = listsOf(sprintDocs, folderDocs);
        expect(lists.map((list) => list.id)).toEqual(['r1', 'i1']);
        expect(lists[1]).toMatchObject({ folderId: 'icons', folderName: 'Icons', folderPath: 'Design / Icons' });
        expect(listLabel(lists[1])).toBe('Design / Icons / Icon list');
        expect(listLabel(lists[0])).toBe('Root list');
    });

    it('gives the AI targets the path and leaves out lists under an archived folder', () => {
        const lists = listsOfProject(project);
        expect(lists.map((list) => list.id)).toEqual(['r1', 'd1', 'i1']);
        expect(lists[2]).toMatchObject({ folderId: 'icons', folderName: 'Icons', folderPath: 'Design / Icons' });
    });

    it('gives the import dialog the path of every list in a folder', () => {
        const options = sprintOptionsOf(project);
        const byId = Object.fromEntries(options.map((option) => [option.id, option]));
        expect(byId.i1).toMatchObject({ folderId: 'icons', folderPath: 'Design / Icons' });
        expect(byId.d1.folderPath).toBe('Design');
        expect(byId.r1.folderPath).toBeUndefined();
    });
});
