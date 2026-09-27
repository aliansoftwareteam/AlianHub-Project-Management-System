import taskClass from '@/utils/TaskOperations'
import { apiRequest } from "@/services";
import * as env from "@/config/env";

export const byTagName = (a, b) => {
    const left = a.tagName.toLowerCase();
    const right = b.tagName.toLowerCase();
    return left < right ? -1 : (right < left ? 1 : 0);
}

export const taskTagChips = (projectTags, taskTagIds) => (projectTags || [])
    .filter((tag) => (taskTagIds || []).includes(tag.uid))
    .sort(byTagName);

export const createTag = async (ids, payload) => {
    const axiosData = {
        "id": ids.projectId,
        "items": payload,
        "operation": "push"
    };
    await apiRequest("post", env.API_TAGS, axiosData).catch((error) => {
        console.error("Error in create project tag: ", error);
    })
}

export const addTaskTag  = (ids, payload) => {
     return new Promise((resolve, reject) => {
        try {
            taskClass.updateTags({
                companyId: ids.companyId,
                projectId: ids.projectId,
                sprintId: ids.sprintId,
                taskId: ids.taskId,
                tagsArray: ids.tagsArray,
                tagId: payload,
                operation: 'add'})
            .then(() => {
                resolve()
            }).catch((err)=>{console.error("ERROR",err);})
        } 
        catch(error) {
            reject(true)
        }  
    })
}

export const updateTag = async (ids, oldValue, newValue) => {

    let keyName = null;
    if (oldValue.tagName !== newValue.tagName) {
        keyName = "tagName";
    } else {
        keyName = "tagColor";
    }

    const axiosData = {
        "id": ids.projectId,
        "items": { 
            "id": newValue.uid,
            "tagName": newValue.tagName,
            "tagColor": newValue.tagColor
        },
        "operation": "update",
        "key": keyName
    };
    await apiRequest("post", env.API_TAGS, axiosData).catch((error) => {
        console.error("Error in update project tag: ", error);
    })
}

export const deleteTag = async (ids, value) => {
    const axiosData = {
        "id": ids.projectId,
        "items": { id: value.uid },
        "operation": "delete"
    };
    await apiRequest("post", env.API_TAGS, axiosData).catch((error) => {
        console.error("Error in delete project tag: ", error);
    })
}

export const removeTaskTag  = (ids, payload) => {
    return new Promise((resolve, reject) => {
        try {
            taskClass.updateTags({ 
                companyId: ids.companyId,
                projectId: ids.projectId,
                sprintId: ids.sprintId,
                taskId: ids.taskId,
                tagsArray: ids.tagsArray,
                tagId: payload,
                operation: 'remove'
            }).then(() =>{
                resolve()
            })
            .catch((err)=>{
                console.error("ERROR",err);
                reject()
            })
        } 
        catch(error) {
            reject(true)
        }  
    })

    
}