const { convert } = require('html-to-text');
const config = require('../../../Config/config');
const logger = require("../../../Config/loggerConfig")
const { dbCollections } = require('../../../Config/collections');
const { SCHEMA_TYPE } = require("../../../Config/schemaType")
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const { sendFCMNotification } = require("./send-notification")
const fs = require('fs');
const path = require('path');
var brandSettings = null; 
const filePath = path.join(__dirname, '../../../brandSettings.json');

exports.sendNotificationHandler = (notitificationData) => {
    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        brandSettings = fileContent ? JSON.parse(fileContent) : null;
    }
    return new Promise(async (resolve, reject) => {
        try {
            if (notitificationData.length > 0) {                
                // Use Promise.allSettled instead of Promise.all
                const results = await Promise.allSettled(
                    notitificationData.map(item => this.sendNotificationBody(item))
                );
                
                const successCount = results.filter(r => r.status === 'fulfilled').length;
                const failureCount = results.filter(r => r.status === 'rejected').length;
                                
                resolve({
                    total: results.length,
                    successful: successCount,
                    failed: failureCount,
                    results: results
                });
                
            } else {
                resolve([])
            }
        } catch (error) {
            logger.error(`Email Notification Step One Catch error: ${error.message}`);
            reject(error)
        }
    })
};

exports.sendNotificationBody = (body) => {
    return new Promise(async (resolve, reject) => {
        try {
            const options = {
                selectors: [
                    { selector: 'img', format: 'skip' },
                ]
            };
            const text = convert(body.message, options);
            const topicName = "fcmNotification"
            let actionUrl = "";
            var { folderId = "", sprintId = "", projectId = "", companyId = '', taskId = "" } = body
            if (body?.type?.toLowerCase() === "project") {
                if (folderId !== undefined && folderId !== null && folderId !== '') {
                    if (sprintId !== undefined && sprintId !== null && sprintId !== '') {
                        actionUrl = `${body.companyId}/project/${projectId}/fs/${folderId}/${sprintId}`
                    } else {
                        actionUrl = `${body.companyId}/project/${projectId}/f/${folderId}`
                    }
                } else if (sprintId !== undefined && sprintId !== null && sprintId !== '') {
                    actionUrl = `${body.companyId}/project/${projectId}/s/${sprintId}`
                } else {
                    actionUrl = `${body.companyId}/project/${projectId}/p?tab=ProjectDetail`
                }
            } else if(body?.type?.toLowerCase() === "chat"){
                actionUrl = `${body.companyId}/chat/${projectId}/${taskId}`;
            } else {
                if (folderId !== undefined && folderId !== null && folderId !== '') {
                    actionUrl = `${body.companyId}/project/${projectId}/fs/${folderId}/${sprintId}/${taskId}${body.key === "logged_hours_notification" ? '?tab=ProjectListView&taskTab=TimeLog' : body.key === "comments_I'm_@mentioned_in" ? '?tab=ProjectListView&detailTab=comment' : ''}`
                } else {
                    actionUrl = `${body.companyId}/project/${projectId}/s/${sprintId}/${taskId}${body.key === "logged_hours_notification" ? '?tab=ProjectListView&taskTab=TimeLog' : body.key === "comments_I'm_@mentioned_in" ? "?tab=ProjectListView&detailTab=comment" : ''}`
                }
            }

            if (body?.type === "project" && body.key === "comments_I'm_@mentioned_in") {
                actionUrl = `${body.companyId}/project/${projectId}/p?tab=Comments`;
            } 
            var payload = {}
            if (body?.type == "chat") {
                let Image;
                
                if (body?.Employee_profileImage) {
                    Image = body?.Employee_profileImage;
                } else {
                    Image = ``;
                }
                
                payload = {
                    notification: {
                        title: `${body.User_Employee_Name} - ${'Chat Notification'}` || `${brandSettings && brandSettings.productName ? brandSettings.productName :'Alian-Hub'} - ${'Chat Notification'}`,
                        body: changeText(text),
                        click_action: `${config.WEBURL}/#/${actionUrl}`,
                        // icon: Image,  // Commented out the image part because adding a user image in the FCM notification was not working
                        nId: body.notificationId,
                        uId: body.receiverID,
                        domainURL: process.env.APIURL,
                        cId: body.companyId,
                        key: body.key === "comments_I'm_@mentioned_in" ? "mentions" : "notifications",
                        commentsId: body.comments_id || ""
                    },
                    tokens: body.webTokens,
                    sound: 'default',
                }
            } else {
                var notificationTitle = body.type === 'project' ? 'Project Notification' : 'Task Notification'
                payload = {
                    notification: {
                        title: `${brandSettings && brandSettings.productName ? brandSettings.productName :'Alian Hub'} - ${notificationTitle}`,
                        body: changeText(text),
                        click_action: `${config.WEBURL}/#/${actionUrl}`,
                        nId: body.notificationId,
                        uId: body.receiverID,
                        domainURL: process.env.APIURL,
                        cId: body.companyId,
                        key: body.key === "comments_I'm_@mentioned_in" ? "mentions" : "notifications",
                        commentsId: body.comments_id || ""
                    },
                    tokens: body.webTokens,
                    sound: 'default',
                }
            }
            // PROPERLY HANDLE FCM AND CLEANUP
            try {
                const response = await sendFCMNotification(payload);
                // Handle cleanup operations with proper error handling
                await this.performCleanup(body, true); // success cleanup
                resolve(response);
            } catch (fcmError) {
                console.error('FCM Error:', fcmError);
                // Handle cleanup operations even on FCM failure
                await this.performCleanup(body, false); // failure cleanup
                reject(fcmError);
            }
            
        } catch (error) {            
            // Handle cleanup on any error
            await this.performCleanup(body, false);
            reject(error);
        }
    });
};

// Helper function for cleanup operations
exports.performCleanup = async (body, isSuccess) => {
    
    try {
        // Remove document with detailed error handling
        try {
            const removeResult = await this.removeDocument(body);
        } catch (removeError) {
            console.error('✗ Error removing document:', removeError.message);
        }
        
        // Update document with detailed error handling
        try {
            const updateResult = await this.UpdateDocument(body);
        } catch (updateError) {
            console.error('✗ Error updating document:', updateError.message);
        }
                
    } catch (cleanupError) {
        console.error('=== Overall cleanup error ===', cleanupError);
    }
};

function changeText(msg) {
    const mentionRegex = /@\[[\w ]+?\]\(\w{4,30}\)/gi;
    let mentions = msg.match(mentionRegex);

    if (mentions !== null) {
        mentions.forEach((mention) => {
            msg = msg.replace(mention, `@${mention.split("]")[0].replace("@[", "")}`)
        })
    }
    return msg;
}
exports.removeDocument = (data) => {
    return new Promise((resolve, reject) => {
        try {            
            if (!data._id) {
                const error = new Error('Missing _id for document removal');
                console.error('removeDocument error:', error.message);
                return reject(error);
            }

            let obj = {
                type: SCHEMA_TYPE.NOTIFICATIONS,
                collection: SCHEMA_TYPE.NOTIFICATIONS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(data._id)
                    },
                ]
            }
            
            MongoDbCrudOpration(dbCollections.GLOBAL, obj, "deleteOne")
                .then((res) => {
                    resolve(res);
                })
                .catch((error) => {
                    console.error('MongoDB removeDocument error:', error);
                    logger.error("Error removing document:", error);
                    reject(error);
                });
                
        } catch (error) {
            console.error('removeDocument outer catch error:', error);
            logger.error("removeDocument catch error:", error);
            reject(error);
        }
    });
}

exports.UpdateDocument = (data) => {
    return new Promise((resolve, reject) => {
        try {
            
            if (!data.notificationId) {
                const error = new Error('Missing notificationId for document update');
                console.error('UpdateDocument error:', error.message);
                return reject(error);
            }
            
            if (!data.companyId) {
                const error = new Error('Missing companyId for document update');
                console.error('UpdateDocument error:', error.message);
                return reject(error);
            }

            let obj = {
                type: SCHEMA_TYPE.NOTIFICATIONS,
                collection: SCHEMA_TYPE.NOTIFICATIONS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(data.notificationId)
                    },
                    { notificationStatus: "completed" }
                ]
            }
            
            MongoDbCrudOpration(data.companyId, obj, "updateOne")
                .then((res) => {
                    resolve(res);
                })
                .catch((error) => {
                    console.error('MongoDB UpdateDocument error:', error);
                    logger.error("Error updating document:", error);
                    reject(error);
                });
                
        } catch (error) {
            console.error('UpdateDocument outer catch error:', error);
            logger.error("UpdateDocument catch error:", error);
            reject(error);
        }
    });
}