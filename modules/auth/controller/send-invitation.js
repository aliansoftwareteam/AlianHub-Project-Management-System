const config = require("../../../Config/config");
const { dbCollections } = require('../../../Config/collections');
const sendMail = require("../../service.js");
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const btoa = require('btoa');
const { SCHEMA_TYPE } = require("../../../Config/schemaType.js");
const mongoose = require("mongoose");
const { updateCompanyFun } = require("../../company/controller/update-company.js");
const { getUserByQueyFun } = require("../../users-module/controller.js");
const { updateMemberFunction } = require('../../settings/Members/controller.js');
const logger = require("../../../Config/loggerConfig.js");
const { emitListener } = require("../../company/event-controller.js");


async function batchUpdate(arr, eventId) {
    return new Promise((resolve, reject) => {
        try {
            // tasks BATCH FUNCTION
            let count = 0;
            let batch = 1;
            const perBatch = 2;
            const next = () => {
                batch++;
                loopFun();
            }

            let results = []
            const loopFun = () => {
                console.log("TOTAL: ", count, "/", arr.length, "==", ((count * 100) / arr.length).toFixed(2));
                if (((count * 100) / arr.length) < 100) {
                    emitListener(eventId, { step: ((count * 100) / arr.length).toFixed(2) });
                } else {
                    emitListener(eventId, { step: "STOP" });
                }
                if(count >= arr.length) {
                    resolve(results)
                    console.log("END");
                    return;
                } else {
                    try {
                        let promises = [];
                        const startIndex = count;
                        const endIndex = count + perBatch;
                        count = endIndex;
                        for (let i = startIndex; i < endIndex; i++) {
                            const data = arr[i];
                            // let schemaType = data && (data.private === true || data.private === false) ? SCHEMA_TYPE.SPRINTS : SCHEMA_TYPE.FOLDERS
                            if(data) {
                                promises.push(new Promise((resolve2, reject2) => {
                                    try {
                                        exports.sendInvitationEmailFun(data).then((rrData) => {
                                            resolve2(rrData);
                                        }).catch((error) => {
                                            reject2(error?.statusText || error)
                                        })
                                    } catch (error) {
                                        reject2(error?.message || error)
                                    }
                                }))
                            }
                        }
                        Promise.allSettled(promises)
                            .then((result) => {
                                const failedUpdates = result.filter(x => x.status === "rejected");

                                if (failedUpdates.length > 0) {
                                    reject(new Error(`Batch update stopped due to failure in batch ${batch}`));
                                    return;
                                }
                                results = [...results, ...result]
                                setTimeout(() => {
                                    next();
                                }, 2000);
                            })
                            .catch((error) => {
                                logger.error(`UPDATE failed batch: ${batch} > ${error.message}`);
                                reject(new Error(`Batch update failed: ${error.message}`));
                            });

                    } catch (e) {
                        console.error(`UPDATE failed batch: ${batch}`);
                        reject(new Error(`Unexpected error in batch ${batch}`));
                    }
                };
            }
            loopFun()
        } catch (error) {
            reject(error)
        }
    })
}


/**
 * Send Verification Mail Function
 * @param {Objcet} bodyData
 * @param {Object} cb
 * @returns
 */
exports.sendInvitationEmailFun = (bodyData) => {
    return new Promise((resolve, reject) => {
        try {
            let keys = ["email", "companyId", "companyName", "role", "designation"];
            let valid = "";
    
            keys.forEach((key) => {
                if(bodyData[key] === undefined || bodyData[key] === null) {
                    valid += `${key}, `
                }
            })
    
            // VALIDATE REQUEST BODY
            if(valid.length) {
                valid += "fields are required.";
                reject({status: false, statusText: new Error(valid)});
                return
            }
    
            let {email, companyId, companyName, role, designation,isResend} = bodyData;
    
            email = email.toLowerCase();
    
            if(!isResend){
                let updateObj = {
                    type:SCHEMA_TYPE.COMPANIES,
                    data: [
                        { _id : new mongoose.Types.ObjectId(companyId)},
                        {$inc: {
                            'companyData.$[elementIndex].users': 1,
                        }},
                        {
                            arrayFilters: [{ 'elementIndex.users': { $exists: true } }],
                            upsert: true
                        }
                    ]
                }
                try {
                    updateCompanyFun(SCHEMA_TYPE.GOLBAL,updateObj,"findOneAndUpdate",companyId)
                    .catch((error) => {
                        console.error(error,"ERROR:")
                    })
                } catch (error) {
                    console.error(error,"ERROR:")
                }
            }
    
            /**
             * Send Check Request Function
             * @param {String} mail - Mail Template which is need to send for email
             * @returns
            */
            const sendMailFunction = (mailObj,data) => {
                try {
                    sendMail.SendEmail(mailObj.subject, mailObj.mail, email, true, (result) => {
                        if(result.status) {
                            resolve({
                                status: true,
                                statusText: 'Invitation_mail_sent_sucessfully',
                                data
                            });
                        } else {
                            reject({
                                status: false,
                                statusText: result.error
                            });
                            exports.decreaseUserCount(companyId);
                        }
                    });
                } catch (error) {
                    reject({
                        status: false,
                        statusText: error?.message || error
                    });
                }
            };
    
            /**
             * Send Check Request Function
             * @param {String} UserId - Id of user For which We need to send invittation to company
             * @param {String} Email - Email of user For which We need to send invittation to company
             * @param {String} token - Token Which is used to verification
             * @returns
            */
            const sendCheckRequest = (email, userId, token) => {
                try {
                    let obj = {
                        type: dbCollections.COMPANY_USERS,
                        data: [
                            {
                                userEmail: email,
                            },
                        ]
                    }
                    mongoRef.MongoDbCrudOpration(companyId, obj, "findOne").then((resp)=>{
                        if (resp == null) {
                            let companyUserData = {
                                companyId: companyId,
                                userId: userId,
                                isDelete: false,
                                roleType: role,
                                status: 1,
                                userEmail: email,
                                designation: designation,
                                linkId: token,
                                sendInvitationTime: new Date(),
                            }
                            updateMemberFunction(companyId, companyUserData, "save")
                            .then((res) => {
                                const re = res.data;
        
                                if(userId === "") {
                                    let link = `${config.WEBURL}/#/invitation?companyId=${companyId}-${re._id}`;
                                    sendMailFunction(require("../../template/sendEmailInvitation")(link, companyName),re);
                                } else {
                                    let link = `${config.WEBURL}/#/verify-invitation?id=${btoa(`userId=${userId}&companyId=${companyId}&docId=${re._id}&linkId=${token}`)})}`;
                                    sendMailFunction(require("../../template/sendEmailInvitation")(link, companyName),re);
                                }
                            }).catch((error) => {
                                reject({status: false, statusText: error});
                            })
                        } else {
                            // let alreadyIn = querySnapshot.docs.filter((userDoc) => userDoc.data().status === 2 && userDoc.data().userId === userId && !userDoc.data().isDelete);
                            if (resp.status === 2 && !resp.isDelete) {
                                reject({
                                    status: false,
                                    statusText: 'User is already in the company.'
                                })
                                return;
                            }
        
                            const memberObject = [
                                {
                                    userEmail: email,
                                },
                                {
                                    $set: {
                                        status: 1,
                                        linkId: token,
                                        roleType: role,
                                        designation: designation,
                                        isDelete: false,
                                        sendInvitationTime: new Date(),
                                    }
                                },
                                {
                                    returnDocument: 'after'
                                }
                            ]
        
                            updateMemberFunction(companyId, memberObject, "findOneAndUpdate").then((response)=>{
                                const resp = response.data
                                
                                if(userId === "") {
                                    let link = `${config.WEBURL}/#/invitation?companyId=${companyId}-${resp._id}`;
                                    sendMailFunction(require("../../template/sendEmailInvitation")(link, companyName),resp);
                                } else {
                                    let link = `${config.WEBURL}/#/verify-invitation?id=${btoa(`userId=${userId}&companyId=${companyId}&docId=${resp._id}&linkId=${token}`)})}`;
                                    sendMailFunction(require("../../template/sendEmailInvitation")(link, companyName),resp);
                                }
                            }).catch((error)=>{
                                reject({status: false, statusText: error});
                            })
                        }
                    }).catch((error)=>{
                        reject({
                            status: false,
                            statusText: error
                        })
                    })
                } catch(error) {
                    reject({
                        status: false,
                        statusText: error?.message || error
                    })
                }
            }
    
    
            let query = {
                Employee_Email: email,
                isActive: true,
            }
            getUserByQueyFun(query).then((resp)=>{
                try {
                    if (resp.length > 0) {
                        const response = resp[0];
                        let temp = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                        let token = '';
                        for ( let i = 0; i < 8; i++ ) {
                            token += temp.charAt(Math.floor(Math.random() * temp.length));
                        }
        
                        let userId = response._id;
                        sendCheckRequest(email, userId, token)
                    } else {
                        sendCheckRequest(email, "", "")
                    }
                } catch (error) {
                    reject({
                        status: false,
                        statusText: error?.message || error
                    })
                }
            }).catch((error)=>{
                reject({
                    status: false,
                    statusText: error
                })
            })
        } catch (error) {
            reject({
                status: false,
                statusText: error
            })
            exports.decreaseUserCount(bodyData.companyId);
        }
    })
}


/**
 * Send Verification Mail
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.sendInvitationEmail = (req,res) => {
    try {
        let keys = ["email", "companyId", "companyName", "role", "designation"];
        let valid = "";

        keys.forEach((key) => {
            if(req.body[key] === undefined || req.body[key] === null) {
                valid += `${key}, `
            }
        })

        // VALIDATE REQUEST BODY
        if(valid.length) {
            valid += "fields are required.";
            res.send({status: false, statusText: new Error(valid)});
            return
        }

        let {email, companyId, companyName, role, designation,isResend} = req.body;

        email = email.toLowerCase();

        if(!isResend){
            let updateObj = {
                type:SCHEMA_TYPE.COMPANIES,
                data: [
                    { _id : new mongoose.Types.ObjectId(companyId)},
                    {$inc: {
                        'companyData.$[elementIndex].users': 1,
                    }},
                    {
                        arrayFilters: [{ 'elementIndex.users': { $exists: true } }],
                        upsert: true
                    }
                ]
            }
            updateCompanyFun(SCHEMA_TYPE.GOLBAL,updateObj,"findOneAndUpdate",companyId)
            .catch((error) => {
                console.error(error,"ERROR:")
            })
        }

        /**
         * Send Check Request Function
         * @param {String} mail - Mail Template which is need to send for email
         * @returns
        */
        const sendMailFunction = (mailObj,data) => {
            sendMail.SendEmail(mailObj.subject, mailObj.mail, email, true, (result) => {
                if(result.status) {
                    res.send({
                        status: true,
                        statusText: 'Invitation_mail_sent_sucessfully',
                        data
                    });
                } else {
                    res.send({
                        status: false,
                        statusText: result.error
                    });
                    exports.decreaseUserCount(companyId);
                }
            });
        };

        /**
         * Send Check Request Function
         * @param {String} UserId - Id of user For which We need to send invittation to company
         * @param {String} Email - Email of user For which We need to send invittation to company
         * @param {String} token - Token Which is used to verification
         * @returns
        */
        const sendCheckRequest = (email, userId, token) => {
            let obj = {
                type: dbCollections.COMPANY_USERS,
                data: [
                    {
                        userEmail: email,
                    },
                ]
            }
            mongoRef.MongoDbCrudOpration(companyId, obj, "findOne").then((resp)=>{
                if (resp == null) {
                    let companyUserData = {
                        companyId: companyId,
                        userId: userId,
                        isDelete: false,
                        roleType: role,
                        status: 1,
                        userEmail: email,
                        designation: designation,
                        linkId: token,
                        sendInvitationTime: new Date(),
                    }
                    updateMemberFunction(companyId, companyUserData, "save")
                    .then((res) => {
                        const re = res.data;

                        if(userId === "") {
                            let link = `${config.WEBURL}/#/invitation?companyId=${companyId}-${re._id}`;
                            sendMailFunction(require("../../template/sendEmailInvitation")(link, companyName),re);
                        } else {
                            let link = `${config.WEBURL}/#/verify-invitation?id=${btoa(`userId=${userId}&companyId=${companyId}&docId=${re._id}&linkId=${token}`)})}`;
                            sendMailFunction(require("../../template/sendEmailInvitation")(link, companyName),re);
                        }
                    }).catch((error) => {
                        res.send({status: false, statusText: error});
                    })
                } else {
                    // let alreadyIn = querySnapshot.docs.filter((userDoc) => userDoc.data().status === 2 && userDoc.data().userId === userId && !userDoc.data().isDelete);
                    if (resp.status === 2 && !resp.isDelete) {
                        res.send({
                            status: false,
                            statusText: 'User is already in the company.'
                        })
                        return;
                    }

                    const memberObject = [
                        {
                            userEmail: email,
                        },
                        {
                            $set: {
                                status: 1,
                                linkId: token,
                                roleType: role,
                                designation: designation,
                                isDelete: false,
                                sendInvitationTime: new Date(),
                            }
                        },
                        {
                            returnDocument: 'after'
                        }
                    ]

                    updateMemberFunction(companyId, memberObject, "findOneAndUpdate").then((response)=>{
                        const resp = response.data
                        
                        if(userId === "") {
                            let link = `${config.WEBURL}/#/invitation?companyId=${companyId}-${resp._id}`;
                            sendMailFunction(require("../../template/sendEmailInvitation")(link, companyName),resp);
                        } else {
                            let link = `${config.WEBURL}/#/verify-invitation?id=${btoa(`userId=${userId}&companyId=${companyId}&docId=${resp._id}&linkId=${token}`)})}`;
                            sendMailFunction(require("../../template/sendEmailInvitation")(link, companyName),resp);
                        }
                    }).catch((error)=>{
                        res.send({status: false, statusText: error});
                    })
                }
            }).catch((error)=>{
                res.send({
                    status: false,
                    statusText: error
                })
            })
        }


        let query = {
            Employee_Email: email,
            isActive: true,
        }
        getUserByQueyFun(query).then((resp)=>{
            if (resp.length > 0) {
                const response = resp[0];
                let temp = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                let token = '';
                for ( let i = 0; i < 8; i++ ) {
                    token += temp.charAt(Math.floor(Math.random() * temp.length));
                }

                let userId = response._id;
                sendCheckRequest(email, userId, token)
            } else {
                sendCheckRequest(email, "", "")
            }
        }).catch((error)=>{
            res.send({
                status: false,
                statusText: error
            })
        })
    } catch (error) {
        res.send({
            status: false,
            statusText: error
        })
        exports.decreaseUserCount(req.body.companyId);
    }
}

/**
 * Check Invitation
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.checkSendInviatation = (req,res) => {
    try {
        if (!(req.body && req.body.email)) {
            res.send({ status: false, statusText: 'email is required' });
            return;
        }
        if (!(req.body && req.body.companyId)) {
            res.send({ status: false, statusText: 'companyId is required' });
            return;
        } 
        let obj = {
            type: dbCollections.COMPANY_USERS,
            data: [
                {
                    userEmail: req.body.email,
                },
            ]
        }
        mongoRef.MongoDbCrudOpration(req.body.companyId, obj, "findOne").then((resp)=>{
            if (resp === null || resp?.status === 3) {
                res.send({
                    status: true,
                    statusText: 'All Okay',
                    furtherProceed: true
                })
            } else {
                if (resp.status === 2 && !resp.isDelete) {
                    res.send({
                        status: true,
                        statusText: 'User is already in the company.',
                        furtherProceed: false
                    })
                    return;
                } else {
                    res.send({
                        status: true,
                        statusText: 'You have already sent an invitation. Please resend invitation from members list.',
                        furtherProceed: false
                    })
                    return;
                }
            }
        }).catch((error)=>{
            res.send({
                status: false,
                statusText: error
            });
        })       
    } catch (error) {
        res.send({
            status: false,
            statusText: error
        });
    }
}

exports.decreaseUserCount = (companyId) => {
    try {
        let updateObj = {
            type:SCHEMA_TYPE.COMPANIES,
            data: [
                { _id : new mongoose.Types.ObjectId(companyId)},
                {$inc: {
                    'companyData.$[elementIndex].users': -1,
                }},
                {
                    arrayFilters: [{ 'elementIndex.users': { $exists: true } }],
                    upsert: true
                }
            ]
        }
        updateCompanyFun(SCHEMA_TYPE.GOLBAL,updateObj,"updateOne",companyId)
        .catch((error) => {
            console.error(error,"error in USER COUNT DECREMENT:");
        })
    } catch (error) {
        console.error(error,"ERROR IN DECREASE COUNT FUNCTION:");
    }
}


/**
 * importUser
 * @param {Object} req 
 * @param {Object} res 
 */
exports.importUser = (req, res) => {
    try {
        batchUpdate(req.body.users, req.body.eventId).then((rData) => {
            res.status(200).json({
                status: true,
                data: rData
            });
        }).catch((error) => {
            res.status(400).json({
                status: false,
                statusText: error?.message || error
            });
        })
    } catch (error) {
        logger.error(`Import User Try Catch Error: ${error?.message || error}`);
        res.status(400).json({
            status: false,
            statusText: error?.message || error
        });
    }
};
