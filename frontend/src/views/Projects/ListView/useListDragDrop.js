import { useStore } from "vuex";
import Cookies from "js-cookie";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useUpdateTasks } from "@/views/Projects/helper.js";

const GAP = 65536;

/* Reordering and cross-group drops for the redesigned list rows. Same contract
 * as the legacy ItemList: the group field is written through updateTaskByGroup
 * and the sort index through /api/v1/taskIndex, so a row dragged in either view
 * lands in the same place. */
export function useListDragDrop() {
    const { commit } = useStore();
    const { updateTaskByGroup } = useUpdateTasks();

    function groupPayload(item, groupType, stamp) {
        const token = { user: groupType === 0 ? Cookies.get("accessToken") : localStorage.getItem("updateToken"), timeStamp: stamp };
        if (groupType === 0) {
            return {
                status: { text: item.name, key: item.key, type: item.type },
                statusType: item.type,
                statusKey: item.key,
                updateToken: token,
                islocalSnapStop: true
            };
        }
        if (groupType === 1) {
            return {
                AssigneeUserId: item.value ? item.value.split("_") : [],
                updateToken: token,
                islocalSnapStop: true
            };
        }
        if (groupType === 2) {
            return { Task_Priority: item.value, updateToken: token, islocalSnapStop: true, Updated_At: new Date() };
        }
        return {
            DueDate: item.searchValue ? new Date(item.searchValue * 1000) : null,
            updateToken: token,
            islocalSnapStop: true,
            Updated_At: new Date()
        };
    }

    function nextIndex(rows, index, indexName) {
        if (rows.length <= 1) return 0;
        if (index === 0) return rows[1][indexName] - GAP;
        if (index + 1 === rows.length) return rows[rows.length - 2][indexName] + GAP;
        return (rows[index - 1][indexName] + rows[index + 1][indexName]) / 2;
    }

    function applyDrag({ event, item, groupType, rows, project }) {
        const move = event?.added || event?.moved;
        if (!move?.element?._id) return;
        if (item.value === "NO_DUE_DATE" || item.value === "NEXT") return;

        const element = move.element;
        const index = move.newIndex;
        const task = rows.find((row) => row._id === element._id) || element;
        const stamp = new Date().getTime();
        const updateData = groupPayload(item, groupType, stamp);

        if (event.added) {
            updateTaskByGroup(element, item, groupType).catch((error) => console.error("ERROR in list drop: ", error));
        }

        const tempIndex = nextIndex(rows, index, item.indexName);
        const relevantIndex = rows.length > 1 ? rows[index === 0 ? 1 : index - 1][item.indexName] : 0;

        apiRequest("post", env.UPDATA_TASK_INDEX, {
            relevantIndex,
            projectId: task.ProjectID,
            companyId: task.CompanyId,
            taskId: task._id,
            isFirst: index === 0,
            isFirstWithRecord: index === 0 && rows.length > 1,
            indexName: item.indexName,
            sprintId: task.sprintId,
            relevantKey: item.searchValue,
            searchKey: item.searchKey,
            taskKey: task.TaskKey,
            updateData
        })
        .then(() => {
            commit("projectData/mutateTaskForDragAndDrop", {
                pid: project._id,
                sprintId: task.sprintId,
                task: { ...task, ...updateData, [item.indexName]: tempIndex, updateTimeStamp: stamp }
            });
        })
        .catch((error) => console.error("ERROR in list task index: ", error));
    }

    return { applyDrag };
}
