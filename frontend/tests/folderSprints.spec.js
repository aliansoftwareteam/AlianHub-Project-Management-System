import { describe, expect, it } from 'vitest';
import { folderSprintList, projectSprintList } from '@/views/Projects/folderSprints';

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

const sprintOf = (id, deletedStatusKey = 0) => ({ id, _id: id, name: `Sprint ${id}`, deletedStatusKey });
const tree = {
    parent: { folderId: 'parent', name: 'Parent', parentFolderId: null, sprintsObj: { p1: sprintOf('p1') } },
    sub: { folderId: 'sub', name: 'Sub', parentFolderId: 'parent', sprintsObj: { c1: sprintOf('c1'), c2: sprintOf('c2', 2) } },
    subArchivedAlone: { folderId: 'subArchivedAlone', name: 'Sub archived alone', parentFolderId: 'parent', deletedStatusKey: 2, sprintsObj: { a1: sprintOf('a1') } },
    old: { folderId: 'old', name: 'Old', parentFolderId: null, deletedStatusKey: 2, sprintsObj: { o1: sprintOf('o1') } },
    oldSub: { folderId: 'oldSub', name: 'Old sub', parentFolderId: 'old', deletedStatusKey: 6, sprintsObj: { o2: sprintOf('o2') } },
    oldSubAlone: { folderId: 'oldSubAlone', name: 'Old sub alone', parentFolderId: 'old', deletedStatusKey: 2, sprintsObj: { o3: sprintOf('o3') } },
    orphan: { folderId: 'orphan', name: 'Orphan', parentFolderId: 'deleted-and-not-listed', deletedStatusKey: 2, sprintsObj: { x1: sprintOf('x1') } },
    gone: { folderId: 'gone', name: 'Gone', parentFolderId: null, deletedStatusKey: 1, sprintsObj: {} },
    underGone: { folderId: 'underGone', name: 'Under gone', parentFolderId: 'gone', deletedStatusKey: 6, sprintsObj: { x2: sprintOf('x2') } },
};
const ids = (list) => list.map((item) => item.id);

describe('a folder page with subfolders', () => {
    it('lists the folder\'s own sprints, then those of its live subfolders', () => {
        expect(ids(folderSprintList({ folders: tree, folderId: 'parent', includeSprint: liveOnly }))).toEqual(['p1', 'c1']);
    });

    it('lists only its own sprints on a subfolder link, and picks the one a folder-sprint link names', () => {
        expect(ids(folderSprintList({ folders: tree, folderId: 'sub', includeSprint: liveOnly }))).toEqual(['c1']);
        expect(ids(folderSprintList({ folders: tree, folderId: 'sub', sprintId: 'c1' }))).toEqual(['c1']);
    });

    it('gives an archived folder\'s row the sprints of the subfolders archived with it', () => {
        const [row] = folderSprintList({ folders: tree, folderId: 'old', showArchived: true });
        expect(row).toMatchObject({ id: 'old', isFolder: true, deletedStatusKey: 2 });
        expect(Object.keys(row.archivedSprintList).sort()).toEqual(['o1', 'o2']);
    });

    it('shows nothing for a subfolder whose parent is deleted or missing, archived view or not', () => {
        ['orphan', 'underGone'].forEach((folderId) => {
            expect(folderSprintList({ folders: tree, folderId, showArchived: true })).toEqual([]);
            expect(folderSprintList({ folders: tree, folderId, showArchived: false })).toEqual([]);
            expect(folderSprintList({ folders: tree, folderId, sprintId: 'x1' })).toEqual([]);
        });
    });

    it('shows nothing on the link of a subfolder that is archived with its parent', () => {
        expect(folderSprintList({ folders: tree, folderId: 'oldSub', showArchived: true })).toEqual([]);
        expect(folderSprintList({ folders: tree, folderId: 'oldSub', showArchived: false })).toEqual([]);
    });
});

describe('the project page list of sprints', () => {
    const project = { sprintsObj: { r1: sprintOf('r1'), r2: sprintOf('r2', 2) }, sprintsfolders: tree };

    it('lists root sprints, then the sprints of live folders and live subfolders', () => {
        expect(ids(projectSprintList({ project, showArchived: false, includeSprint: liveOnly }))).toEqual(['r1', 'p1', 'c1']);
    });

    it('adds each archived folder as one row when archived items are shown, and never an orphan', () => {
        const list = projectSprintList({ project, showArchived: true, includeSprint: liveOnly });
        expect(list.filter((item) => item.isFolder).map((item) => item.id)).toEqual(['subArchivedAlone', 'old', 'oldSubAlone']);
        expect(Object.keys(list.find((item) => item.id === 'old').archivedSprintList).sort()).toEqual(['o1', 'o2']);
        expect(ids(list)).not.toContain('x1');
        expect(ids(list)).not.toContain('x2');
    });

    it('reads a project with no folders', () => {
        expect(projectSprintList({ project: { sprintsObj: { r1: sprintOf('r1') } }, showArchived: false })).toEqual([sprintOf('r1')]);
        expect(projectSprintList({ project: null, showArchived: false })).toEqual([]);
    });
});
