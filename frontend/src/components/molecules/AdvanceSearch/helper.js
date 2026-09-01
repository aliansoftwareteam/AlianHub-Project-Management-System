import { inject } from "vue";
import { firstId, taskOpenPath } from '@/utils/taskOpenProjectId';

export function filterFun() {
    const urlRegex = inject("$urlRegex");
    function generateTaskURL(obj,companyId,action){
        try {
            return new Promise((resolve, reject) => {
                try{
                    const path = taskOpenPath({
                        companyId,
                        projectId: obj && firstId(obj.ProjectID, obj.projectId),
                        sprintId: obj && firstId(obj.sprintId, obj.SprintId),
                        taskId: obj && firstId(obj._id, obj.taskId),
                        folderId: firstId(action ? (obj && obj.folderId) : (obj && obj.folderObjId)),
                    });
                    if (!path) {
                        resolve('');
                        return;
                    }
                    resolve(`${window.location.origin}/#${path}`);
                } catch (e) {
                    reject(e)
                    console.error(e);
                }
            });
        }catch (e) {
            console.error(e);
        }
    }
    // linkify
    function linkCheck(str){
        try {
            return new Promise((resolve, reject) => {
                try{
                    let string = str;
                    let result = [];
                    if (str != '' && str != undefined) {
                        result = string.match(urlRegex.value);
                    }
                    resolve([...new Set(result)]);
                } catch (e) {
                    reject(e)
                    console.error(e);
                }
            });
        }catch (e) {
            console.error(e);
        }
    }
    return {
        generateTaskURL,
        linkCheck
    }
}