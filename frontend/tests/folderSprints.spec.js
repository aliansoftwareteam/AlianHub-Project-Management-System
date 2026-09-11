import { describe, expect, it } from 'vitest';
import { folderSprintList } from '@/views/Projects/folderSprints';

const live = { id: 's1', name: 'Live sprint', deletedStatusKey: 0, _id: 's1' };
const archived = { id: 's2', name: 'Archived sprint', deletedStatusKey: 2, _id: 's2' };
const folders = {
    f1: { folderId: 'f1', name: 'Folder', sprintsObj: { s1: live, s2: archived } },
    f2: { folderId: 'f2', name: 'Archived folder', deletedStatusKey: 2, sprintsObj: { s1: live } },
};
const liveOnly = (sprint) => !sprint.deletedStatusKey;

describe('folderSprintList (PRJ-07)', () => {
    it('returns no sprints instead of throwing while a cold deep link has no folders yet', () => {
        expect(folderSprintList({ folders: undefined, folderId: 'f1' })).toEqual([]);
        expect(folderSprintList({ folders: undefined, folderId: 'f1', sprintId: 's1' })).toEqual([]);
        expect(folderSprintList({ folders: {}, folderId: 'missing', includeSprint: liveOnly })).toEqual([]);
    });

    it('lists the folder\'s sprints that pass the filter on a folder link', () => {
        expect(folderSprintList({ folders, folderId: 'f1', includeSprint: liveOnly })).toEqual([live]);
    });

    it('picks the one sprint a folder-sprint link names', () => {
        expect(folderSprintList({ folders, folderId: 'f1', sprintId: 's2' })).toEqual([archived]);
        expect(folderSprintList({ folders, folderId: 'f1', sprintId: 'nope' })).toEqual([]);
    });

    it('shows an archived folder as one row only when archived items are shown', () => {
        expect(folderSprintList({ folders, folderId: 'f2', showArchived: false })).toEqual([]);
        expect(folderSprintList({ folders, folderId: 'f2', showArchived: true })).toEqual([
            { name: 'Archived folder', id: 'f2', isExpanded: false, archivedSprintList: { s1: live }, items: [], deletedStatusKey: 2, isFolder: true },
        ]);
    });
});
