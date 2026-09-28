import taskClass from "@/utils/TaskOperations";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { projectDataOf } from "@/utils/aiTargets";

const RETRY_MS = 1500;

const newItemId = () => Math.random().toString(36).slice(2, 8);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* One checklist named `heading` holding the steps, through the same write the Suggest checklists
 * flow uses. Resolves to the undo, which removes exactly those items. */
export async function addStepsAsChecklist({ taskOf, steps, heading, companyId, userData, projectName = "" }) {
    const task = taskOf();
    const head = { id: newItemId(), name: heading, isChecked: false, isExpand: false };
    const items = steps.map((name) => ({ id: newItemId(), name, isChecked: false, isExpand: false, parentId: head.id }));
    const checklistArray = [head, ...items];
    await taskClass.updateAiChecklist({ companyId, taskId: task._id, checklistArray, userData, sprintId: task.sprintId, projectId: task.ProjectID });
    const ids = checklistArray.map((item) => item.id);
    return () => {
        const current = taskOf();
        return taskClass.updateChecklistsv2({
            data: ids,
            localUpdateArray: (current.checklistArray || []).filter((item) => !ids.includes(item.id)),
            projectId: current.ProjectID,
            taskId: current._id,
            sprintId: current.sprintId,
            companyId,
            ops: "checklistremove",
            taskData: current,
            historyObj: {
                key: "checklistremove",
                Employee_Name: userData.Employee_Name,
                userId: userData.id,
                name: heading,
                taskName: current.TaskName,
                projectName,
                extractedData: { name: heading, subItemNames: [heading, ...steps] }
            }
        });
    };
}

async function trash(task, context) {
    const send = () => taskClass.updateArchiveDelete({ ...context, sprintId: task.sprintId, task, deletedStatusKey: 1 });
    try {
        await send();
    } catch (error) {
        // The server creates the tasks one after another after it answers, so an early undo can outrun the last one.
        await wait(RETRY_MS);
        await send();
    }
}

/* Tasks (type "task") or subtasks (type "subTask") through the create path the AI subtask and
 * task suggestions already use. Resolves to what was created and the undo that sends it to trash. */
export async function createTasksFromTitles({ titles, type, parentTask, sprintObj, project, companyId, userId, userData }) {
    const projectData = projectDataOf(project);
    const response = await taskClass.createSubTaskWithAi({
        companyId,
        userId,
        subTitles: titles.map((title) => ({ title })),
        sprintObj,
        projectData,
        userData,
        parentTask,
        type
    });
    const created = Array.isArray(response?.data) ? response.data : [];
    const undo = () => Promise.all(created.map((task) => trash(task, { companyId, projectData, userData })));
    return { created, undo };
}

const escapeText = (text) => String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export async function postTaskComment(task, text) {
    const response = await apiRequest("post", env.API_COMMENTS, {
        data: {
            message: escapeText(text),
            type: /https?:\/\//i.test(text) ? "link" : "text",
            project: false,
            isDeleted: false,
            objId: {
                projectId: String(task.ProjectID),
                sprintId: String(task.sprintId),
                taskId: String(task._id),
                ...(task.folderObjId ? { folderId: String(task.folderObjId) } : {})
            }
        }
    });
    if (!response?.data?.status) throw new Error(response?.data?.statusText || "comment");
    return response.data.data;
}
