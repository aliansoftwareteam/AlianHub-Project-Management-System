const mongoCm = require('../../utils/mongo-handler/mongoQueries');
const logger = require("../../Config/loggerConfig");
const { dbCollections } = require('../../Config/collections');
const socketEmitter = require('../../event/socketEventEmitter');
const { escapeRegex } = require('../../utils/escapeRegex');
const { pinSessionTenant } = require('../../Config/tenant');
const { parentCountFields } = require('./unreadParents');

// Key 1 is Project Comments
// Key 2 is update sprint count and task count
// Key 3 is update chat count
// Key 4 is update mention count
// Key 5 is update notification count


/* A null document would blank the client's whole count store, so only a real one is broadcast. */
const emitCounts = (doc) => {
    if (doc) socketEmitter.emit('update', { type: "update", data: doc , module: 'userIdNotification' });
};

const unsetSpentCount = async (companyId, filter, field) => {
    emitCounts(await mongoCm.MongoDbCrudOpration(companyId, {
        type: dbCollections.USERID,
        data: [{ ...filter, [field]: { $lte: 0 } }, { $unset: { [field]: "" } }, { returnDocument: 'after' }]
    }, "findOneAndUpdate"));
};

/* Changes the count each task above a row holds for it, in every counter document that holds a
 * count for the row itself, and drops a count that reached zero. */
const changeParentCounts = async (companyId, rows, taskFieldName, sprintFieldName, parentFields, amountOf) => {
    if (!parentFields.length) return;
    for (const row of rows) {
        if (!row[taskFieldName]) continue;
        try {
            const by = amountOf(row);
            // eslint-disable-next-line no-await-in-loop
            emitCounts(await mongoCm.MongoDbCrudOpration(companyId, {
                type: dbCollections.USERID,
                data: [{ _id: row._id }, { $inc: Object.fromEntries(parentFields.map((field) => [field, by])) }, { returnDocument: 'after' }]
            }, "findOneAndUpdate"));
            for (const field of [sprintFieldName, ...parentFields]) {
                // eslint-disable-next-line no-await-in-loop
                await unsetSpentCount(companyId, { _id: row._id }, field);
            }
        } catch (error) {
            logger.error(`${error} ERROR IN PARENT COUNT UPDATE`);
        }
    }
};

/* `parentTaskField` is one count field or several: one for each task above the row. */
exports.updateSprintCount = (companyId,data, taskFieldName, sprintFieldName, parentTaskField = null, prevCount = 0, cb) => {
    changeParentCounts(companyId, data || [], taskFieldName, sprintFieldName, [].concat(parentTaskField || []).filter(Boolean), () => prevCount)
        .then(() => cb({ status: true }))
        .catch((error) => cb({ status: false, err: error }));
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
                        // upsert: a user has no counter document until something
                        // first counts for them, and this collection is empty for a
                        // company that has never had one written. Without it every
                        // count write matched nothing, changed nothing, and STILL
                        // reported "Count update succesfully" — so unread badges
                        // (incoming messages, mark-as-unread, mentions) silently
                        // did nothing at all for that user.
                        {returnDocument: 'after', upsert: true, setDefaultsOnInsert: true}
                    ]
                }
                mongoCm.MongoDbCrudOpration(companyId, obj, "findOneAndUpdate").then((data)=>{
                    // A null document would blank the client's whole count store, so
                    // only broadcast a real one.
                    if (data) {
                        socketEmitter.emit('update', { type: "update", data: data , module: 'userIdNotification' });
                    }
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

// The people a new comment reaches have their counts raised by the server when it is saved, so a client
// only ever changes its own.
const changesOwnCount = (body) => Boolean(body.read || body.set || body.readAll);

/* Chat and notification counts are raised only by the server. */
const CLIENT_BUMP_KEYS = [1, 2, 4];

const countTargets = (req, res) => {
    const body = req.body || {};
    const claimed = Array.isArray(body.userIds) ? body.userIds.filter(Boolean).map(String) : [];
    if (claimed.some((id) => id !== String(req.uid))) {
        res.status(403).send({ status: false, statusText: 'You can only change your own unread counts.' });
        return null;
    }
    if (changesOwnCount(body)) return [String(req.uid)];
    if (!CLIENT_BUMP_KEYS.includes(body.key)) {
        res.status(403).send({ status: false, statusText: 'Only comment and mention counts can be raised here.' });
        return null;
    }
    return claimed;
};

exports.updateUnReadCommentsCount = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return;
        const userIds = countTargets(req, res);
        if (!userIds) return;
        if (!userIds.length) {
            res.send({ status: true, data: 'No recipients in this company' });
            return;
        }
        const step = changesOwnCount(req.body) ? {} : { messageCount: 1 };
        res.send(await applyUnreadCount(companyId, { ...req.body, userIds, ...step }));
    } catch (error) {
        // Rejections are { status: false, statusText } objects without a message; answering them 200 with an
        // empty body made a refused write look like a stored one.
        const rejected = error && error.status === false;
        res.status(rejected ? 400 : 500).json({
            status: false,
            statusText: (error && (error.statusText || error.message)) || 'Failed to update unread count',
        });
    }
};

const countsOf = (companyId, filter, projection) => mongoCm.MongoDbCrudOpration(companyId, {
    type: dbCollections.USERID,
    data: projection ? [filter, projection] : [filter]
}, "find");

/* A task's unread count, kept with a count on every task above it: its parent, and the root. */
const applyTaskCount = async (companyId, body, messageCount, prevCount) => {
    const sprintFieldName = `sprint_${body.projectId}_${body.sprintId}_comments`;
    const taskFieldName = `task_${body.projectId}_${body.sprintId}_${body.taskId}_comments`;
    const parentFields = await parentCountFields(companyId, body);
    const onEachParent = (by) => Object.fromEntries(parentFields.map((field) => [field, by]));
    const update = (manageQuery) => new Promise((resolve) => { exports.updateCount(companyId, body.userIds, manageQuery, resolve); });

    if (body.read) {
        const rows = await countsOf(companyId, { userId: { $in: body.userIds } }, { [taskFieldName]: true })
            .catch((err) => Promise.reject({ status: false, err }));
        if (!(rows && rows.length)) return Promise.reject({ status: false, statusText: "User data not found" });
        /* By what is stored, not by the count the reader sends: the tasks above must lose exactly what this row gave them. */
        await changeParentCounts(companyId, rows, taskFieldName, sprintFieldName, parentFields, (row) => -Number(row[taskFieldName]));
        return update({ $unset: { [taskFieldName]: "" } });
    }

    if (body.set) {
        const newCount = messageCount - prevCount;
        /* The sprint count is not raised here: nothing lowers it and nothing shows it. */
        const result = await update({
            $set: { [taskFieldName]: messageCount },
            ...(parentFields.length ? { $inc: onEachParent(newCount) } : {})
        });
        if (newCount < 0) {
            for (const field of [sprintFieldName, ...parentFields]) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const spent = await countsOf(companyId, { [field]: { $lte: 0 } });
                    for (const row of spent || []) {
                        // eslint-disable-next-line no-await-in-loop
                        await unsetSpentCount(companyId, { _id: row._id }, field);
                    }
                } catch (error) {
                    logger.error(`${error} ERROR IN MONGO QUERY`);
                }
            }
        }
        return result;
    }

    return update({ $inc: { [taskFieldName]: messageCount, ...onEachParent(messageCount) } });
};

const applyUnreadCount = (companyId, body) => {
    try {
        return new Promise((resolve, reject) => {
            if (!companyId) {
                reject({
                    status: false,
                    statusText: "companyId is required"
                });
                return;
            }

            if (!body.key) {
                reject({
                    status: false,
                    statusText: "key is required"  
                });
                return;
            }

            if (body.key === 1 || body.key === 2) {
                if (!body.projectId) {
                    reject({
                        status: false,
                        statusText: "Project id is required"
                    });
                    return;
                }

                if (!(body.userIds && body.userIds.length)) {
                    reject({
                        status: false,
                        statusText: "User ids are required"
                    });
                    return;
                }
            }

            if (body.key === 2) {
                if (!body.sprintId) {
                    reject({
                        status: false,
                        statusText: "Sprint id is required"
                    });
                    return;
                }
                if (!body.taskId) {
                    reject({
                        status: false,
                        statusText: "Task id is required"
                    });
                    return;
                }
            }

            if (body.key === 3) {
                if (!body.messageId) {
                    reject({
                        status: false,
                        statusText: "Message id is required"
                    });
                    return;
                }
            }

            if (body.key === 4) {
                if (body.readAll === undefined) {
                    reject({
                        status: false,
                        statusText: "readAll id is required"
                    });
                    return;
                }
            }

            let messageCount = body.messageCount !== undefined ? body.messageCount : 1;
            let prevCount = body.prevCount || 0;

            if (body.key === 1) {
                const fieldName = `project_${body.projectId}_comments`;
                let manageQuery = {};
                if (body.read) {
                    manageQuery = {
                        $unset: {
                            [fieldName]: ""
                        }
                    }
                } else if (body.set) {
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
                exports.updateCount(companyId,body.userIds, manageQuery, (tData) => {
                    resolve(tData);
                });
            } 
            else if (body.key === 2) {
                applyTaskCount(companyId, body, messageCount, prevCount).then(resolve).catch(reject);
            } else if (body.key === 3) {
                const fieldName = `message_${body.messageId}_counts`;
                let manageQuery = {};
                if (body.read) {
                    manageQuery = {
                        $unset: {
                            [fieldName]: ""
                        }
                    }
                }  else if (body.set) {
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
                exports.updateCount(companyId,body.userIds, manageQuery, (tData) => {
                    resolve(tData);
                });
            } else if (body.key === 4) {
                const fieldName = `mention_counts`;
                let manageQuery = {};
                if (body.readAll) {
                    manageQuery = {
                        $unset: {
                            [fieldName]: ""
                        }
                    }
                } else {
                    if (body.read) {
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
                exports.updateCount(companyId,body.userIds, manageQuery, (tData) => {
                    if (body.readAll === false && body.read === true) {
                        exports.updateMentionCount(companyId,body.userIds,fieldName, (cdata) => {
                            resolve(cdata);
                        })
                    } else {
                        resolve(tData);
                    }
                });
            } else if (body.key === 5) {
                const fieldName = `notification_counts`;
                let manageQuery = {};
                if (body.readAll) {
                    manageQuery = {
                        $unset: {
                            [fieldName]: ""
                        }
                    }
                } else {
                    if (body.read) {
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
                exports.updateCount(companyId,body.userIds, manageQuery, (tData) => {
                    if (body.readAll === false && body.read === true) {
                        exports.updateMentionCount(companyId,body.userIds,fieldName, (cdata) => {
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
        return Promise.reject({
            status: false,
            err: error
        })
    }
};

// For server-side callers, which build the body themselves from ids they have already resolved.
exports.updateUnReadCommentsCountFun = ({ body = {} } = {}) => applyUnreadCount(body.companyId, body);


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