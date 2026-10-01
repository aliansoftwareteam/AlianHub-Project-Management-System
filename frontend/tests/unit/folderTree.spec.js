import { describe, expect, it } from 'vitest';
import {
    canHoldSubfolders,
    folderContents,
    folderMoveTargets,
    folderPathLabel,
    folderTrail,
    isLiveFolder,
    isOrphanFolder,
    nestedFolders,
    subfoldersOf
} from '@/utils/folderTree';

const entry = (id, name, extra = {}) => ({ folderId: id, _id: id, id, name, sprintsObj: {}, deletedStatusKey: 0, parentFolderId: null, ...extra });

const folders = {
    design: entry('design', 'Design'),
    icons: entry('icons', 'Icons', { parentFolderId: 'design' }),
    ops: entry('ops', 'Ops'),
    old: entry('old', 'Old', { deletedStatusKey: 2 }),
    withOld: entry('withOld', 'With old', { parentFolderId: 'old', deletedStatusKey: 6 }),
    gone: entry('gone', 'Gone', { deletedStatusKey: 1 }),
    underGone: entry('underGone', 'Under gone', { parentFolderId: 'gone', deletedStatusKey: 2 }),
    lost: entry('lost', 'Lost', { parentFolderId: 'not-in-the-list', deletedStatusKey: 6 })
};

const names = (list) => list.map((folder) => folder.name);

describe('the folder tree rules', () => {
    it('names a folder by its path', () => {
        expect(folderPathLabel(folders, 'design')).toBe('Design');
        expect(folderPathLabel(folders, 'icons')).toBe('Design / Icons');
        expect(folderPathLabel(folders, 'nope')).toBe('');
        expect(folderTrail(folders, 'icons').map((folder) => folder.folderId)).toEqual(['design', 'icons']);
        expect(folderTrail(folders, 'design').map((folder) => folder.folderId)).toEqual(['design']);
        expect(folderTrail(folders, undefined)).toEqual([]);
    });

    it('reads the same from the list the API returns', () => {
        const list = [{ _id: 'a', name: 'A' }, { _id: 'b', name: 'B', parentFolderId: 'a' }];
        expect(folderPathLabel(list, 'b')).toBe('A / B');
        expect(names(nestedFolders(list))).toEqual(['A', 'B']);
    });

    it('treats a subfolder whose parent is deleted or missing as an orphan', () => {
        expect(isOrphanFolder(folders, folders.underGone)).toBe(true);
        expect(isOrphanFolder(folders, folders.lost)).toBe(true);
        expect(isOrphanFolder(folders, folders.icons)).toBe(false);
        expect(isOrphanFolder(folders, folders.withOld)).toBe(false);
        expect(isOrphanFolder(folders, folders.design)).toBe(false);
    });

    it('counts a subfolder as live only under a live parent', () => {
        expect(isLiveFolder(folders, folders.icons)).toBe(true);
        expect(isLiveFolder(folders, folders.withOld)).toBe(false);
        expect(isLiveFolder(folders, entry('x', 'X', { parentFolderId: 'old' }))).toBe(false);
        expect(isLiveFolder(folders, folders.old)).toBe(false);
    });

    it('lists live folders with each subfolder after its parent, labelled by path', () => {
        const nested = nestedFolders(folders);
        expect(nested.map((folder) => [folder.name, folder.depth, folder.path])).toEqual([
            ['Design', 0, 'Design'],
            ['Icons', 1, 'Design / Icons'],
            ['Ops', 0, 'Ops']
        ]);
        expect(nested[1].folderId).toBe('icons');
    });

    it('finds the subfolders of a folder', () => {
        expect(names(subfoldersOf(folders, 'design'))).toEqual(['Icons']);
        expect(subfoldersOf(folders, 'ops')).toEqual([]);
    });

    it('lets only a live top-level folder hold subfolders', () => {
        expect(canHoldSubfolders(folders, folders.design)).toBe(true);
        expect(canHoldSubfolders(folders, folders.icons)).toBe(false);
        expect(canHoldSubfolders(folders, folders.old)).toBe(false);
    });

    it('offers live top-level folders as move targets, and none to a folder that holds subfolders', () => {
        expect(names(folderMoveTargets(folders, folders.ops))).toEqual(['Design']);
        expect(names(folderMoveTargets(folders, folders.icons))).toEqual(['Design', 'Ops']);
        expect(folderMoveTargets(folders, folders.design)).toEqual([]);
    });

    it('lets a folder whose only subfolder is deleted move', () => {
        const map = { a: entry('a', 'A'), b: entry('b', 'B', { parentFolderId: 'a', deletedStatusKey: 1 }), c: entry('c', 'C') };
        expect(names(folderMoveTargets(map, map.a))).toEqual(['C']);
    });
});

describe('what goes with a folder when it is archived or deleted', () => {
    const docs = [
        { _id: 'design', name: 'Design', deletedStatusKey: 0 },
        { _id: 'icons', name: 'Icons', deletedStatusKey: 0, parentFolderId: 'design' },
        { _id: 'fonts', name: 'Fonts', deletedStatusKey: 2, parentFolderId: 'design' },
        { _id: 'ops', name: 'Ops', deletedStatusKey: 0 }
    ];
    const list = (id, folderId, tasks, extra = {}) => ({ _id: id, name: id, folderId, tasks, deletedStatusKey: 0, ...extra });
    const sprints = [
        list('d1', 'design', 4),
        list('d2', 'design', 1, { deletedStatusKey: 2 }),
        list('i1', 'icons', 3),
        list('i2', 'icons', 0),
        list('f1', 'fonts', 9),
        list('o1', 'ops', 7),
        list('root', undefined, 5)
    ];

    it('counts the live subfolders, the live lists in the folder and in them, and their tasks', () => {
        expect(folderContents({ folders: docs, sprints }, 'design')).toEqual({ subfolders: 1, lists: 3, tasks: 7, tasksKnown: true });
        expect(folderContents({ folders: docs, sprints }, 'icons')).toEqual({ subfolders: 0, lists: 2, tasks: 3, tasksKnown: true });
    });

    it('counts nothing in an empty folder', () => {
        expect(folderContents({ folders: [{ _id: 'empty', name: 'Empty', deletedStatusKey: 0 }], sprints }, 'empty')).toEqual({ subfolders: 0, lists: 0, tasks: 0, tasksKnown: true });
    });

    it('says when a list does not carry its task count', () => {
        const unknown = [list('d1', 'design', 4), { _id: 'd3', name: 'd3', folderId: 'design', deletedStatusKey: 0 }];
        expect(folderContents({ folders: docs, sprints: unknown }, 'design')).toMatchObject({ lists: 2, tasksKnown: false });
    });
});
