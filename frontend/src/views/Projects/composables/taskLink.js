/* The address of a task's own page, resolved through the router so it follows the route table. */
export function taskUrl(router, { companyId, project, task }) {
    const folderId = task.folderObjId || "";
    const params = { cid: companyId || project?.CompanyId, id: project?._id, sprintId: task.sprintId, taskId: task._id };
    if (folderId) params.folderId = folderId;
    try {
        const { href } = router.resolve({ name: folderId ? "ProjectFolderSprintTask" : "ProjectSprintTask", params });
        return new URL(href, window.location.href).toString();
    } catch (error) {
        return "";
    }
}
