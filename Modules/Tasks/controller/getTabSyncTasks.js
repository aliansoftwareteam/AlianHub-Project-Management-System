const { mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");


exports.getTabSynctTaskWithoutTable = (companyId,req) => {
    return new Promise((resolve, reject) => {
        try {
            const indName = req.body.indexName || req.body.item.indexName

            const queryParams = [
                {
                    $match: {
                        ProjectID: new mongoose.Types.ObjectId(req.body.pid),
                        sprintId: new mongoose.Types.ObjectId(req.body.sprintId),
                        updatedAt: {$gte: new Date(Number(req.body.tabLeaveTime))},
                        deletedStatusKey: 0,
                        ...((req.body.showAllTasks === undefined || req.body.showAllTasks === true || req.body.showAllTasks === 2) ? {} : {AssigneeUserId: {$in: [req.body.userId]}}),
                        ...( req.body.parentId && req.body.parentId.length ? 
                            { ParentTaskId: req.body.parentId }
                        :
                            {
                                isParentTask: true,
                                ...( req.body.item.mongoConditions?.length ? 
                                    { ...req.body.item.mongoConditions[0] }
                                :
                                req.body.item?.conditions?.length ?
                                        { ...req.body.item.conditions[0] }
                                    :
                                        {}
                                )
                            }
                        ),
                    }
                },
                { $sort: {[indName]: 1, "createdAt": 1, _id: 1}},
            ]
            const countParams = [
                {
                    $match: {
                        ProjectID: new mongoose.Types.ObjectId(req.body.pid),
                        sprintId: new mongoose.Types.ObjectId(req.body.sprintId),
                        deletedStatusKey: 0,
                        ...((req.body.showAllTasks === undefined || req.body.showAllTasks === true || req.body.showAllTasks === 2) ? {} : {AssigneeUserId: {$in: [req.body.userId]}}),
                        ...( req.body.parentId && req.body.parentId.length ? 
                            { ParentTaskId: req.body.parentId }
                        :
                            {
                                isParentTask: true,
                                ...( req.body.item.mongoConditions?.length ? 
                                    { ...req.body.item.mongoConditions[0] }
                                :
                                req.body.item?.conditions?.length ?
                                        { ...req.body.item.conditions[0] }
                                    :
                                        {}
                                )
                            }
                        ),
                    }
                },
                { $sort: {[indName]: 1, "createdAt": 1, _id: 1}},
            ]
            const finalQuery =  [
                [
                    {
                        $facet: {
                            result:[
                                ...queryParams,
                                { $skip: 0},
                            ],
                            count:[
                                ...countParams,
                                {$count: "count" }
                            ]
                        }
                    }
                ]
            ]
            
            let mongoObj = {
                type: SCHEMA_TYPE.TASKS,
                data: finalQuery
            }
            MongoDbCrudOpration(companyId, mongoObj, 'aggregate').then((response)=>{
                resolve(response);
            }).catch((error)=>{
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}


exports.getTabSynctTaskWithTable = (companyId,req) => {
    return new Promise((resolve, reject) => {
        try {
            const queryParams = [
                {
                    $match: {
                        $and: [
                            {
                                $and:[
                                    {ProjectID: {$in : [new mongoose.Types.ObjectId(req.body.pid)]}},
                                    {sprintId: {$eq :new mongoose.Types.ObjectId(req.body.sprintId)}},
                                    // BUG-032 / #86 fix: was `{ $in: [0] }` which
                                    // excluded legacy tasks that pre-date the
                                    // soft-delete field. Tasks where
                                    // `deletedStatusKey` is unset (undefined)
                                    // are still active and must be returned —
                                    // matches the pattern used by getTaskCount
                                    // (`{$in: [0, 2, undefined]}`) and the
                                    // sibling getTabSynctTaskWithoutTable.
                                    {deletedStatusKey: { $in: [0, undefined] }},
                                    {updatedAt: {$gte: new Date(Number(req.body.tabLeaveTime))},}
                                ]
                            },
                            {
                                ...( req.body.item.mongoConditions?.length ? 
                                    { ...req.body.item.mongoConditions[0] }
                                :
                                req.body.item?.conditions?.length ?
                                        { ...req.body.item.conditions[0] }
                                    :
                                        {}
                                )
                            },
                            {
                                ...(req.body?.showAllTasks !== undefined && !req.body?.showAllTasks && {
                                    $and: [
                                        {AssigneeUserId: {$in : [req.body.userId]}}
                                    ],
                                }),
                            },
                            {
                                ...(req.body.pid !== "6571e7195470e64b1203295c" ? {} : {AssigneeUserId: {$in: [req.body.userId]}}),
                            }
                        ],
                    },
                },
                {
                    $sort: req.body.sortKey ? { [req.body.sortKey.split(':')[0]]: Number(req.body.sortKey.split(':')[1]),_id:1 } : req.body.item?.indexName ? {[req.body.item.indexName]: 1} : {createdAt:1}, // Sort all records
                },
            ]
            
            let mongoObj = {
                type: SCHEMA_TYPE.TASKS,
                data: [queryParams]
            }
            MongoDbCrudOpration(companyId, mongoObj, 'aggregate').then((response)=>{
                resolve(response);
            }).catch((error)=>{
                console.error(error);
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.getTabSyncTasks = (req,res) => {
    try {
        if (!(req.body && req.body.pid)) {
            res.status(400).json({message: 'pid is required'});
            return;
        }
        if (!(req.body.sprintId)) {
            res.status(400).json({message: 'Project ID is required'});
            return;
        }
        if (req.body.istableTask === undefined) {
            res.status(400).json({message: 'istableTask ID is required'});
            return;
        }
        const companyId = req.headers['companyid']
        if (req.body.istableTask === false) {
            exports.getTabSynctTaskWithoutTable(companyId,req).then((result)=>{
                res.status(200).json(result);
            }).catch((error)=>{
                res.status(400).json({message: error.message});
            })
        } else {
            exports.getTabSynctTaskWithTable(companyId,req).then((result)=>{
                res.status(200).json(result);
            }).catch((error)=>{
                res.status(400).json({message: error.message});
            })
        }
    } catch (error) {
        console.error(error);
        res.status(400).json({message: error});
    }
}