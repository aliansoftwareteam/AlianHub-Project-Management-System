import { describe, expect, it } from 'vitest';
import {
    canHoldSubfolders,
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
