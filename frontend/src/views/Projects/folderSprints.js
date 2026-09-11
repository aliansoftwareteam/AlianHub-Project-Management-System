export function folderSprintList({ folders, folderId, sprintId, showArchived, includeSprint = () => true }) {
    const folder = folders?.[folderId];
    const sprints = Object.values(folder?.sprintsObj || {});

    if (sprintId && !folder?.deletedStatusKey) {
        const sprint = sprints.find((x) => x.id === sprintId);
        return sprint ? [sprint] : [];
    }

    if (folder?.deletedStatusKey === 2) {
        return showArchived
            ? [{ name: folder.name, id: folder.folderId, isExpanded: false, archivedSprintList: folder.sprintsObj || {}, items: [], deletedStatusKey: 2, isFolder: true }]
            : [];
    }

    return sprints.filter(includeSprint);
}
