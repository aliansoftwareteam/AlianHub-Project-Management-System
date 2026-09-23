import { useCustomComposable} from "@/composable";
import * as env from '@/config/env';
import { apiRequest, apiRequestWithoutCompnay } from "../../../services";
import {storageQueryBuilder} from '@/utils/storageQueryBuild.js';
import { useToast } from "vue-toast-notification"
const $toast = useToast();
const { makeUniqueId } = useCustomComposable();
import { i18n } from "@/locales/main";
import { isAgentComment } from "@/utils/commentSide";
const t = i18n.global.t;



export const checkFile = (files = [], fileExtentionsArray = []) => {
    let fileExtentions = fileExtentionsArray.map((e)=>{
        if(e.name) {
            return e.name;
        } else {
            return e;
        }
    });
    return new Promise((resolve, reject) => {
        try {
            let mediaFiles = []

            if(!files.length){
                return;
            }

            let mb = 300;

            let valid = false
            let validSize = false;
            let fileType = "";

            files.forEach((file) => {
                let fileExt = file.name.split(".").pop();

                if(file.type.includes("image")){
                    valid = true;
                    fileType = "image";
                } else if(file.type.includes("audio")) {
                    valid = true;
                    fileType = "audio";
                } else if(file.type.includes("video")) {
                    valid = true;
                    fileType = "video";
                } else if(file.type === "application/pdf") {
                    valid = true;
                    fileType = "pdf";
                } else if(fileExt == 'csv' || fileExt == "xlsx" || fileExt == "xls" ){
                    valid = true;
                    fileType = 'excel';
                } else if(fileExt == 'ods'){
                    valid = true;
                    fileType = 'ods';
                } else if(fileExt == 'docx' || fileExt == 'doc' ){
                    valid = true;
                    fileType = 'word';
                } else if(fileExt == 'odt'){
                    valid = true;
                    fileType = 'odt';
                } else if(fileExt == 'ppt' || fileExt == 'pptx'){
                    valid = true;
                    fileType = 'ppt';
                } else if(fileExt == 'html' || fileExt == 'htm'){
                    valid = true;
                    fileType = 'html';
                } else if(fileExt == 'txt'){
                    valid = true;
                    fileType = 'plain';
                } else if(fileExt == 'xd'){
                    valid = true;
                    fileType = 'xd';
                } else if(fileExt == 'psd'){
                    valid = true;
                    fileType = 'psd';
                } else if(fileExt == 'ai'){
                    valid = true;
                    fileType = 'ai';
                } else if(fileExt == 'zip' || fileExt == 'rar'){
                    valid = true;
                    fileType = 'zip';
                } else if(fileExt == 'eps'){
                    valid = true;
                    fileType = 'eps';
                } else if(fileExt == 'js'){
                    valid = true;
                    fileType = 'js';
                } else if(fileExt == 'css'){
                    valid = true;
                    fileType = 'css';
                } else if(fileExt == 'php'){
                    valid = true;
                    fileType = 'php';
                } else if(fileExt == 'sql'){
                    valid = true;
                    fileType = 'sql';
                } else if(fileExt == 'pub'){
                    valid = true;
                    fileType = 'pub';
                } else if(fileExt == 'apk'){
                    valid = true;
                    fileType = 'apk';
                } else if(fileExt == 'aab'){
                    valid = true;
                    fileType = 'aab';
                } else if(fileExt == 'key'){
                    valid = true;
                    fileType = 'key';
                } else if(fileExt == 'ppk'){
                    valid = true;
                    fileType = 'ppk';
                } else if(fileExt == 'pem'){
                    valid = true;
                    fileType = 'pem';
                } else if(fileExtentions.includes((!fileExt.startsWith('.') ? ('.'+fileExt) : fileExt))) {
                    valid = true;
                    fileType = 'other'
                }

                if(file.size <= mb * 1000000) {
                    validSize = true
                }

                if(valid && validSize) {
                    mediaFiles.push({data: file, name: file.name, fileType: fileType});
                } else {
                    let msg = ""
                    if(!valid) {
                        msg = file.name + ' ' +`${ t('Toast.File_type_not_supported')}`;
                    } else if(!validSize) {
                        msg = file.name+ `${t('Toast.file_size_is_larger_than_FILE_SIZE_mb').replace("FILE_SIZE", mb)}`;
                    }
                    $toast.error(msg, {position: "top-right"});
                }

                if(mediaFiles.length) {
                    resolve(mediaFiles);
                }
            });
        } catch (error) {
            reject(error);
        }
    })
}

export const renderFiles = (file, userId) => {
    return new Promise((resolve, reject) => {
        try {
            const reader = new FileReader();
            let messageObj = {};

            reader.onload = (e) => {
                messageObj = {
                    isSending: makeUniqueId(),
                    reply: {},
                    replyMessageId: "",
                    message: "",
                    mediaURL: e.target.result,
                    mediaName: file.name,
                    mediaOriginalName: file.mediaOriginalName,
                    mediaSize: file.data.size,
                    type: file.fileType,
                    hasReply: false,
                    id: "",
                    createdAt: {seconds: new Date().getTime()/1000},
                    updatedAt: {seconds: new Date().getTime()/1000},
                    isDeleted: false,
                    userId: userId,

                    sent: true,
                }

                resolve(messageObj);
            }
            reader.readAsDataURL(file.data)
        } catch (error) {
            reject(error);
        }
    })
}

export const bakeMessage = async ({messageData, edited}) => {
    return new Promise((resolve, reject) => {
        try {
            let messageObject={
                ...messageData,
                isDeleted: false,

                hasReply: false,
                type: messageData.type || "text",
                message: messageData.message,
                mediaURL: messageData.mediaURL !== undefined ? messageData.mediaURL : "",
                mediaName: messageData.mediaName !== undefined ? messageData.mediaName : "",
                mediaSize: messageData.mediaSize !== undefined ? messageData.mediaSize : 0,

                mentionIds: [],
            }

            if(Object.keys(messageData.reply).length) {
                messageObject.hasReply = true;
                let keys = [ "id", "mediaName", "mediaOriginalName", "mediaSize", "mediaURL", "message", "type", "createdAt", "userId"];
                keys.forEach((key) => {
                    if(key === "createdAt") {
                        messageObject[`reply_${key}`] = edited ? messageData.reply.createdAt : messageData.reply.createdAt.seconds;
                    } else if(key === "mediaSize") {
                        messageObject[`reply_${key}`] = messageData.reply.mediaSize;
                    } else {
                        messageObject[`reply_${key}`] = messageData.reply[key];
                    }
                })
            } else {
                let keys = [ "id", "mediaName", "mediaSize", "mediaOriginalName", "mediaURL", "message", "type", "createdAt", "userId"];
                keys.forEach((key) => {
                    if(key === "createdAt" || key === "mediaSize") {
                        messageObject[`reply_${key}`] = 0;
                    } else {
                        messageObject[`reply_${key}`] = "";
                    }
                })
            }

            resolve(messageObject);
        } catch (error) {
            reject(error);
        }
    })
}

export const sendMessage = async ({messageData, edited}) => {
    return new Promise((resolve, reject) => {
        try {
            // apiRequestWithoutCompnay("get", `/api/v1/getTime?zone=${timeZone}`).then((res) => {
                if(!edited) {
                    delete messageData.reply;
                    const params = {
                        data: {
                            ...messageData,
                            // createdAt: new Date(res.data),
                            // updatedAt: new Date(res.data)
                        }
                    }
                    apiRequest('post', `${env.API_COMMENTS}`, params).then((response) => {
                        if(response.data.status) {
                            const data = response.data.data
                            resolve({...messageData, _id: data._id, id: data._id});
                        }
                    })
                    .catch((error) => {
                        reject(error)
                    })
                } else {
                    const messageId = messageData._id;
                    delete messageData._id;
                    // messageData.createdAt = new Date(messageData.createdAt);
                    // messageData.updatedAt = new Date(res.data);

                    const params = {
                        id: messageId,
                        data: { ...messageData },
                        isProjectComment : messageData.project
                    }
                    apiRequest('put', `${env.API_COMMENTS}`, params).then((response) => {
                        if(response.data.status) {
                            resolve(messageData);
                        }
                    })
                    .catch((error) => {
                        reject(error)
                    })
                }
            // })
        } catch (error) {
            reject(error);
        }
    })
}

export const uploadToWasabi = (imageFile, path, companyId) => {
    return new Promise((resolve, reject) => {
        try {
            const filePath = path;

            const apiFormData = new FormData();
            apiFormData.append("companyId", companyId);
            apiFormData.append("path", filePath);
            apiFormData.append("file", imageFile);
            apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, apiFormData, "form")
            .then((response) => {
                if(response.data.status) {
                    resolve(response.data.statusText);
                } else {
                    resolve("");
                }
            })
            .catch((error) => {
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

export const deleteFromWasabi = (path, companyId) => {
    return new Promise((resolve, reject) => {
        try {
            let axiousObject = storageQueryBuilder('delete',companyId,path);
            apiRequest(axiousObject.method, axiousObject.route, axiousObject.data)
            .then((response) => {
                if(!response.data.status) {
                    reject(response.data.statusText);
                    console.error("ERROR in delete wasabi image: ", response.data.statusText);
                } else {
                    resolve(response.data.statusText)
                }
            })
            .catch((error) => {
                reject(error)
            })
        } catch (error) {
            reject(error)
        }
    })
}

export function sendSupportMail(message, productName) {
    apiRequestWithoutCompnay("post", env.SUPPORT_MAIL, { message, productName })
        .catch((error) => {
            console.error("ERROR in send support mail: ", error);
        })
}

// --------------- Conditions to Show/Hide user Info ---------------
function sameTime(data, data2){
    return data && new Date(data.createdAt).setSeconds(0, 0) && new Date(data.createdAt).setSeconds(0, 0) === new Date(data2.createdAt).setSeconds(0, 0);
}
function sameUser(data, data2){
    return data && data.userId && data.userId === data2.userId && isAgentComment(data) === isAgentComment(data2);
}
export const showUserInfo = (data, data2 = null) => {
    let show = true

    if(data.sent) {
        show = false;
    } else if(!data.sent && data2) {
        if(sameTime(data2, data) && sameUser(data2, data)) {
            show = false;
        }
    }
    return show;
}
export const showMessageTime = (data, data2 = null) => {
    let show = true

    if(data.sent && data2) {
        if(sameTime(data2, data) && sameUser(data2, data)) {
            show = false;
        }
    } else if(!data.sent && data2) {
        if(sameTime(data2, data) && sameUser(data2, data)) {
            show = false;
        }
    }
    return show;
}
// --------------- Conditions to Show/Hide user Info END ---------------