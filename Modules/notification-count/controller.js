const mongoCm = require('../../utils/mongo-handler/mongoQueries');
const logger = require("../../Config/loggerConfig");
const { dbCollections } = require('../../Config/collections');
const socketEmitter = require('../../event/socketEventEmitter');
const { escapeRegex } = require('../../utils/escapeRegex');

// Key 1 is Project Comments
// Key 2 is update sprint count and task count
// Key 3 is update chat count
// Key 4 is update mention count
// Key 5 is update notification count


/**
 * Update Sprint And Task Count
 * @param {Object} Data - Object Which is get Frin Db
 * @param {String} CompanyId - Company Id In which Count is need to update
 * @param {String} TaskFieldName - Name of the field which is being updated
 * @param {String} SprintFieldName - Name of the field which is being updated
 * @returns {function} - Function which is return with object which contain status true or false
*                          If status is false then error is returned
 */
exports.updateSprintCount = (companyId,data, taskFieldName, sprintFieldName, parentTaskField = null, prevCount = 0, cb) => {
    try {
        let count = 0;
        const countFun = (row) => {
            if (count >= data.length) {
                cb({
                    status: true
                });
                return;
            }
            if (!row[taskFieldName]) {
                count += 1;
                countFun(data[count]);
                return;
            }
            let obj = {
                type: dbCollections.USERID,
                data: [{
                    _id: row._id
                }, {
                    $inc: {
                        // [sprintFieldName]: -Math.abs(prevCount),
                        // ...(parentTaskField ? {[parentTaskField]: -Math.abs(prevCount)} : {})
                        // [sprintFieldName]: prevCount,
                        ...(parentTaskField ? {[parentTaskField]: prevCount} : {})
                    }
                },{returnDocument: 'after'}]
            }
            mongoCm.MongoDbCrudOpration(companyId,obj,"findOneAndUpdate").then((response)=>{
                socketEmitter.emit('update', { type: "update", data: response , module: 'userIdNotification' });
                // UNSET SPRINT FIELD
                let obj = {
                    type: dbCollections.USERID,
                    data: [{
                        _id: row._id,
                        [sprintFieldName]: {
                            $lte: 0
                        }
                    }, {
                        $unset: {
                            [sprintFieldName]: ""
                        }
                    },{returnDocument: 'after'}]
                }
                mongoCm.MongoDbCrudOpration(companyId,obj,"findOneAndUpdate").then((sdata)=>{
                    socketEmitter.emit('update', { type: "update", data: sdata , module: 'userIdNotification' });
                    count += 1;
                    countFun(data[count]);
                }).catch((err) => {
                    count += 1;
                    countFun(data[count]);
                });

                if(parentTaskField) {
                    // UNSET PARENT TASK FIELD
                    obj = {
                        type: dbCollections.USERID,
                        data: [{
                            _id: row._id,
                            [parentTaskField]: {
                                $lte: 0
                            }
                        }, {
                            $unset: {
                                [parentTaskField]: ""
                            }
                        }]
                    }
                    mongoCm.MongoDbCrudOpration(companyId,obj,"findOneAndUpdate").then((ele)=>{
                        socketEmitter.emit('update', { type: "update", data: ele , module: 'userIdNotification' });
                        count += 1;
                        countFun(data[count]);
                    }).catch((err) => {
                        count += 1;
                        countFun(data[count]);
                    });
                }
            }).catch(() => {
                count += 1;
                countFun(data[count]);
            })
        }
        countFun(data[count]);
    } catch (error) {
        cb({
            status: false,
            err: error
        });
    }
}


/**
 * Update Count Function
 * @param {Array} UserIds - User Ids which is need to update
 * @param {String} CompanyId - Company Id In which Count is need to update
 * @param {Object} ManageQuery - Qury Object For Update In db
 * @returns {function} - Function which is return with object which contain status true or false
*                          If status is false then error is returned
 */
exports.updateCount = (companyId,userIds, manageQuery, cb) => {
    try {

        let count = 0;
        let countFunction = (row) => {
            if (count >= userIds.length) {
                cb({
                    status: true,
                    data: 'Count update succesfully'
                });
            } else {
                const obj = {
                    type: dbCollections.USERID,
                    data: [{
                            userId: row
                        },
                        manageQuery,
                        {returnDocument: 'after'}
                    ]
                }
                mongoCm.MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((data)=>{
                    socketEmitter.emit('update', { type: "update", data: data , module: 'userIdNotification' });
                    count++;
                    countFunction(userIds[count]);
                }).catch((err) => {
                    logger.error("Error in updateCount hook: ", err)
                    count++;
                    countFunction(userIds[count]);
                });
            }
        }
        countFunction(userIds[count]);
    } catch (error) {
        cb({
            status: false,
            err: error
        });
    }
}

/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */

exports.updateUnReadCommentsCount = (req, res) => {
    exports.updateUnReadCommentsCountFun(req).then((cData) => {
        res.send(cData);
    })
    .catch((error) => {
        res.send(error.message);
    });
};
exports.updateUnReadCommentsCountFun = (req) => {
    try {
        return new Promise((resolve, reject) => {
            if (!(req.body && req.body.companyId)) {
                reject({
                    status: false,
                    statusText: "companyId is required"
                });
                return;
            }

            // SEC (AHE-3834) — the tenant is the authenticated company (header), not a
            // client-chosen body value. Blocks mutating another company's unread counts.
            if (req.headers && req.headers['companyid'] && String(req.body.companyId) !== String(req.headers['companyid'])) {
                reject({
                    status: false,
                    statusText: "companyId mismatch"
                });
                return;
            }

            if (!(req.body && req.body.key)) {
                reject({
                    status: false,
                    statusText: "key is required"  
                });
                return;
            }

            if (req.body.key === 1 || req.body.key === 2) {
                if (!(req.body && req.body.projectId)) {
                    reject({
                        status: false,
                        statusText: "Project id is required"
                    });
                    return;
                }

                if (!(req.body && req.body.userIds && req.body.userIds.length)) {
                    reject({
                        status: false,
                        statusText: "User ids are required"
                    });
                    return;
                }
            }

            if (req.body.key === 2) {
                if (!(req.body && req.body.sprintId)) {
                    reject({
                        status: false,
                        statusText: "Sprint id is required"
                    });
                    return;
                }
                if (!(req.body && req.body.taskId)) {
                    reject({
                        status: false,
                        statusText: "Task id is required"
                    });
                    return;
                }
            }

            if (req.body.key === 3) {
                if (!(req.body && req.body.messageId)) {
                    reject({
                        status: false,
                        statusText: "Message id is required"
                    });
                    return;
                }
            }

            if (req.body.key === 4) {
                if (req.body.readAll === undefined) {
                    reject({
                        status: false,
                        statusText: "readAll id is required"
                    });
                    return;
                }
            }

            let messageCount = req.body.messageCount !== undefined ? req.body.messageCount : 1;
            let prevCount = req.body.prevCount || 0;

            if (req.body.key === 1) {
                const fieldName = `project_${req.body.projectId}_comments`;
                let manageQuery = {};
                if (req.body.read) {
                    manageQuery = {
                        $unset: {
                            [fieldName]: ""
                        }
                    }
                } else if (req.body.set) {
                    manageQuery = {
                        $set: {
                            [fieldName]: messageCount
                        }
                    }
                } else {
                    manageQuery = {
                        $inc: {
                            [fieldName]: messageCount
                        },
                    }
                }
                exports.updateCount(req.body.companyId,req.body.userIds, manageQuery, (tData) => {
                    resolve(tData);
                });
            } 
            else if (req.body.key === 2) {
                const sprintFieldName = `sprint_${req.body.projectId}_${req.body.sprintId}_comments`;
                const taskFieldName = `task_${req.body.projectId}_${req.body.sprintId}_${req.body.taskId}_comments`;
                let parentTaskField = ``;
                if(req.body.parentTaskId) {
                    parentTaskField = `parentTask_${req.body.projectId}_${req.body.sprintId}_${req.body.parentTaskId}_comments`
                }
                let manageQuery = {};
                if (req.body.read) {
                    manageQuery = {
                        $unset: {
                            [taskFieldName]: ""
                        }
                    }
                    // Get Task Count
                    let obj = {
                        type: dbCollections.USERID,
                        data: [{
                            userId: {
                                $in: req.body.userIds
                            }
                        }, {
                            [taskFieldName]: true
                        }]
                    }
                    mongoCm.MongoDbCrudOpration(req.body.companyId,obj,"find").then((data)=>{
                        if (!(data && data.length)) {
                            reject({
                                status: false,
                                statusText: "User data not found"
                            });
                            return;
                        }
                        exports.updateSprintCount(req.body.companyId,data, taskFieldName, sprintFieldName, parentTaskField, -prevCount, (cData) => {
                            if (!cData.status) {
                                resolve(cData);
                                return;
                            }
                            exports.updateCount(req.body.companyId,req.body.userIds, manageQuery, (tData) => {
                                resolve(tData);
                            });
                        });
                    }).catch((err) => {
                        reject({
                            status: false,
                            err: err
                        });
                    })
                } else if (req.body.set) {
                    const newCount = messageCount - prevCount
                    manageQuery = {
                        $set: {
                            [taskFieldName]:messageCount,
                        }
                    }

                    manageQuery["$inc"] = {
                        [sprintFieldName]: newCount,
                        ...(req.body.parentTaskId ? {[parentTaskField]: newCount} : {})
                    }

                    exports.updateCount(req.body.companyId,req.body.userIds, manageQuery, (tData) => {
                        resolve(tData);
                        if(newCount < 0){
                            try {
                                // Get Task Count
                                let obj = {
                                    type: dbCollections.USERID,
                                    data: [{
                                        [sprintFieldName]: {
                                            $lte: 0
                                        }
                                    }]
                                }
                        
                                mongoCm.MongoDbCrudOpration(companyId, obj, "find").then((data) => {
                                    if (!(data && data.length)) {
                                        return;
                                    }
                        
                                    let count = 0;
                        
                                    const updateFunction = (row) => {
                                        if (count >= data.length) {
                                            return;
                                        }
                        
                                        let updateObj = {
                                            type: dbCollections.USERID,
                                            data: [
                                                { _id: row._id },
                                                { 
                                                    $unset: { 
                                                        [sprintFieldName]: "" 
                                                    } 
                                                },
                                                { returnDocument: 'after' }
                                            ]
                                        }
                        
                                        mongoCm.MongoDbCrudOpration(companyId, updateObj, "findOneAndUpdate")
                                        .then((updatedDoc) => {
                                            socketEmitter.emit('update', { 
                                                type: "update", 
                                                data: updatedDoc, 
                                                module: 'userIdNotification' 
                                            });
                                            count += 1;
                                            updateFunction(data[count]);
                                        })
                                        .catch((error) => {
                                            logger.error(`${error} ERROR IN MONGO QUERY`);
                                            count += 1;
                                            updateFunction(data[count]);
                                        });
                                    }
                                    updateFunction(data[count]);
                                }).catch((error) => {
                                    logger.error(`${error} ERROR IN MONGO QUERY`);
                                });
                                if(req.body.parentTaskId) {
                                    // UNSET PARENT TASK FIELD
                                    let obj = {
                                        type: dbCollections.USERID,
                                        data: [{
                                            [parentTaskField]: {
                                                $lte: 0
                                            }
                                        }]
                                    }
                            
                                    mongoCm.MongoDbCrudOpration(companyId, obj, "find").then((data) => {
                                        if (!(data && data.length)) {
                                            return;
                                        }
                            
                                        let count = 0;
                            
                                        const updateFunction = (row) => {
                                            if (count >= data.length) {
                                                return;
                                            }
                            
                                            let updateObj = {
                                                type: dbCollections.USERID,
                                                data: [
                                                    { _id: row._id },
                                                    { 
                                                        $unset: { 
                                                            [parentTaskField]: "" 
                                                        } 
                                                    },
                                                    { returnDocument: 'after' }
                                                ]
                                            }
                            
                                            mongoCm.MongoDbCrudOpration(companyId, updateObj, "findOneAndUpdate")
                                            .then((updatedDoc) => {
                                                socketEmitter.emit('update', { 
                                                    type: "update", 
                                                    data: updatedDoc, 
                                                    module: 'userIdNotification' 
                                                });
                                                count += 1;
                                                updateFunction(data[count]);
                                            })
                                            .catch((err) => {
                                                logger.error(`${err} ERROR IN MONGO QUERY`);
                                                count += 1;
                                                updateFunction(data[count]);
                                            });
                                        }
                                        updateFunction(data[count]);
                                    }).catch((err) => {
                                        logger.error(`${err} ERROR IN MONGO QUERY`);
                                    });
                                }
                            } catch (error) {
                                logger.error(`Error updating ${error}`)
                            }
                        }
                    });
                } else {
                    manageQuery = {
                        $inc: {
                            // [sprintFieldName]: messageCount,
                            [taskFieldName]: messageCount,
                            ...(req.body.parentTaskId ? {[parentTaskField]: messageCount} : {})
                        }
                    }

                    exports.updateCount(req.body.companyId,req.body.userIds, manageQuery, (tData) => {
                        resolve(tData);
                    });
                }
            } else if (req.body.key === 3) {
                const fieldName = `message_${req.body.messageId}_counts`;
                let manageQuery = {};
                if (req.body.read) {
                    manageQuery = {
                        $unset: {
                            [fieldName]: ""
                        }
                    }
                }  else if (req.body.set) {
                    manageQuery = {
                        $set: {
                            [fieldName]: messageCount
                        }
                    }
                } else {
                    manageQuery = {
                        $inc: {
                            [fieldName]: messageCount
                        }
                    }
                }
                exports.updateCount(req.body.companyId,req.body.userIds, manageQuery, (tData) => {
                    resolve(tData);
                });
            } else if (req.body.key === 4) {
                const fieldName = `mention_counts`;
                let manageQuery = {};
                if (req.body.readAll) {
                    manageQuery = {
                        $unset: {
                            [fieldName]: ""
                        }
                    }
                } else {
                    if (req.body.read) {
                        manageQuery = {
                            $inc: {
                                [fieldName]: -1
                            }
                        }
                    } else {
                        manageQuery = {
                            $inc: {
                                [fieldName]: 1
                            }
                        }
                    }
                }
                exports.updateCount(req.body.companyId,req.body.userIds, manageQuery, (tData) => {
                    if (req.body.readAll === false && req.body.read === true) {
                        exports.updateMentionCount(req.body.companyId,req.body.userIds,fieldName, (cdata) => {
                            resolve(cdata);
                        })
                    } else {
                        resolve(tData);
                    }
                });
            } else if (req.body.key === 5) {
                const fieldName = `notification_counts`;
                let manageQuery = {};
                if (req.body.readAll) {
                    manageQuery = {
                        $unset: {
                            [fieldName]: ""
                        }
                    }
                } else {
                    if (req.body.read) {
                        manageQuery = {
                            $inc: {
                                [fieldName]: -1
                            }
                        }
                    } else {
                        manageQuery = {
                            $inc: {
                                [fieldName]: 1
                            }
                        }
                    }
                }
                exports.updateCount(req.body.companyId,req.body.userIds, manageQuery, (tData) => {
                    if (req.body.readAll === false && req.body.read === true) {
                        exports.updateMentionCount(req.body.companyId,req.body.userIds,fieldName, (cdata) => {
                            resolve(cdata);
                        })
                    } else {
                        resolve(tData);
                    }
                });
            }
            else {
                resolve({
                    status: true
                });
            }
        })
    } catch (error) {
        reject({
            status: false,
            err: error
        })
    }
};


/**
 * Update Mention Count Function
 * @param {Array} UserIds - User Ids which is need to update
 * @param {String} CompanyId - Company Id In which Count is need to update
 * @param {Object} FieldName - Name of the field which is needed to update
 * @returns {function} - Function which is return with object which contain status true or false
*                          If status is false then error is returned
 */
exports.updateMentionCount = (companyId,userIds,fieldName,cb) => {
    try {
        let obj = {
            type: dbCollections.USERID,
            data: [{
                userId: {
                    $in: userIds
                }
            }]
        }
        mongoCm.MongoDbCrudOpration(companyId,obj,"find").then((data)=>{
            if (!(data && data.length)) {
                cb({
                    status: false,
                    statusText: "User data not found"
                });
                return;
            }
            let count = 0;
            let UpdateuserIds = [];
            let countFunction = (row) => {
                if (count >= data.length) {
                    if (UpdateuserIds.length) {
                        let manageQuery = {
                            $unset: {
                                [fieldName]: ""
                            }
                        }
                        exports.updateCount(companyId,UpdateuserIds, manageQuery, (tData) => {
                            cb(tData);
                        });
                    } else {
                        cb({
                            status: true,
                            statusText: "Update Successfully"
                        })
                    }
                    return;
                } else {
                    if (row[fieldName] <= 0) {
                        UpdateuserIds.push(row.userId)
                        count++;
                        countFunction(data[count]);
                    } else {
                        count++;
                        countFunction(data[count]);
                    }
                }
            }
            countFunction(data[count]);
        }).catch((err) => {
            cb({
                status: false,
                err: err
            });
        })
    } catch (error) {
        cb({
            status: false,
           statusText: `Error: ${error}`
        })
    }
}


async function batchUpdate(task, cid) {
    return new Promise((resolve, reject) => {
        try {
            // tasks BATCH FUNCTION
            let count = 0;
            let batch = 1;
            const perBatch = 10;
            const next = () => {
                batch++;
                loopFun();
            }

            let results = []
            const loopFun = () => {
                if(count >= task.length) {
                    resolve(task)
                    return;
                } else {
                    try {
                        let promises = [];
                        const startIndex = count;
                        const endIndex = count + perBatch;
                        count = endIndex;

                        for (let i = startIndex; i < endIndex; i++) {
                            const data = task[i]

                            if(data) {
                                promises.push(new Promise((resolve2, reject2) => {
                                    try {
                                        let query = {
                                            type: data.collection,
                                            data: data.data
                                        };
                                        mongoCm.MongoDbCrudOpration(cid, query, "updateOne")
                                        .then((res) => {
                                            res.query = query;
                                            resolve2(res);
                                        })
                                        .catch((error) => {
                                            reject2(error)
                                        })
                                    } catch (error) {
                                        reject2(error)
                                    }
                                }))
                            }
                        }

                        Promise.allSettled(promises)
                        .then((result) => {
                            result.filter((x) => x.status === "rejected").forEach((x) => {
                                logger.error(`UPDATE failed for: ${x.value}`)
                            })
                            results = [...results, ...result]
                            setTimeout(() => {
                                next();
                            }, 200);
                        })
                        .catch((error) => {
                            logger.error(`UPDATE failed batch: ${batch} > ${error.message}`);
                            next();
                        })
                    } catch (e) {
                        console.error(`UPDATE failed batch: ${batch}`)
                    }
                }
            }
            loopFun()
        } catch (error) {
            reject(error)
        }
    })
}

exports.unsetAllCounts = (companyId, projectId = "", sprintId = "", options = {searchKey: ""}) => {
    return new Promise((resolve, reject) => {
        try {
            const {searchKey: preKey} = options;
            let searchKey = "";

            if(preKey) {
                searchKey = preKey;
            } else {
                searchKey = "task_";
                if(projectId) {
                    searchKey += `${projectId}_`;
                }
                if(sprintId) {
                    searchKey += `${sprintId}_`;
                }
            }

            const getQuery = [
                {
                    $addFields: {
                    matchingFields: {
                            $filter: {
                                input: { $objectToArray: "$$ROOT" },
                                as: "field",
                                cond: {
                                    $and: [
                                        { $regexMatch: { input: "$$field.k", regex: escapeRegex(searchKey) } },
                                        { $gte: ["$$field.v", 0] }
                                    ]
                                }
                            }
                        }
                    }
                },
                {
                    $match: {
                        $and: [
                            {
                                "matchingFields.0": { $exists: true }
                            }
                        ]
                    }
                }
            ]

            mongoCm.MongoDbCrudOpration(companyId, {type: dbCollections.USERID, data: [getQuery]}, "aggregate")
            .then((res) => {
                if(res) {
                    const data = res.map((x) => {
                        const obj = {
                            collection: dbCollections.USERID,
                            data: [
                                {_id: x._id}
                            ]
                        }

                        const deleteKeys = {}

                        Object.keys(x || {}).forEach(key => {
                            if(key.includes(searchKey)) {
                                deleteKeys[key] = 0;
                            }
                        })

                        obj.data.push({
                            $unset: {
                                ...deleteKeys
                            }
                        })

                        return obj
                    })

                    batchUpdate(data, companyId)
                    .then((result) => {
                        resolve({statusText: "success", data: result});
                    })
                    .catch((err) => {
                        reject(err)
                    })
                } else {
                    reject("No records");
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

exports.unsetFieldForMultipleDocuments = (companyId, sprintFieldName, cb) => {
    try {
        let obj = {
            type: dbCollections.USERID,
            data: [{
                [sprintFieldName]: {
                    $lte: 0
                }
            }]
        }

        mongoCm.MongoDbCrudOpration(companyId, obj, "find").then((data) => {
            if (!(data && data.length)) {
                cb({
                    status: true,
                    statusText: "No documents to update"
                });
                return;
            }

            let count = 0;
            let updatedDocuments = [];

            const updateFunction = (row) => {
                if (count >= data.length) {
                    cb({
                        status: true,
                        data: updatedDocuments
                    });
                    return;
                }

                let updateObj = {
                    type: dbCollections.USERID,
                    data: [
                        { _id: row._id },
                        { 
                            $unset: { 
                                [sprintFieldName]: "" 
                            } 
                        },
                        { returnDocument: 'after' }
                    ]
                }

                mongoCm.MongoDbCrudOpration(companyId, updateObj, "findOneAndUpdate")
                .then((updatedDoc) => {
                    socketEmitter.emit('update', { 
                        type: "update", 
                        data: updatedDoc, 
                        module: 'userIdNotification' 
                    });

                    updatedDocuments.push(updatedDoc);
                    count += 1;
                    updateFunction(data[count]);
                })
                .catch((err) => {
                    logger.error(`Mongo Update Error: ${err}`);
                    count += 1;
                    updateFunction(data[count]);
                });
            }
            updateFunction(data[count]);
        }).catch((err) => {
            cb({
                status: false,
                err: err
            });
        });
    } catch (error) {
        cb({
            status: false,
            err: error
        });
    }
}