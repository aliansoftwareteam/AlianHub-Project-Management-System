const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");
const { mongoose } = require("mongoose");
const logger = require("../../../Config/loggerConfig");
const { isPrivileged } = require("../../../Config/roleTypes");
const { sprintIdentities, visibleSprintClause } = require("../../Sprints/helpers/sprintVisibility");


exports.sprintVisibilityMatch = async (uid, companyId, projectId, roleType) => ({
    projectId: new mongoose.Types.ObjectId(projectId),
    deletedStatusKey: { $nin: [1] },
    ...(isPrivileged(roleType) ? {} : visibleSprintClause(await sprintIdentities(companyId, uid))),
});

exports.getDefaultSprintData = async (uid, query, companyId, projectId, roleType) => {
    const queryArray = [
        { $match: await exports.sprintVisibilityMatch(uid, companyId, projectId, roleType) }
    ];
    if (query.fields) {
        const projection = {};
        query.fields.split(',').forEach((field) => {
            projection[field] = 1;
        });
        queryArray.push(projection);
    }
    if (query.skip) {
        queryArray.push({ $skip: query.skip });
    }
    if (query.limit) {
        queryArray.push({ $limit: query.limit });
    }
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [queryArray]
    }, 'aggregate');
};


exports.getDefaultFolderData = (uid,query,companyId,projectId) => {
    return new Promise((resolve, reject) => {
        try {
            const defaultPrivate = {
                projectId : new mongoose.Types.ObjectId(projectId),
                deletedStatusKey: { $nin: [1] },
            };
            const defaultPublic = {
                projectId : new mongoose.Types.ObjectId(projectId),
                deletedStatusKey: { $nin: [1] },
            };
            const queryArray = [
                {
                    $match: {
                        $or: [
                            defaultPrivate,
                            defaultPublic
                        ]
                    }
                }
            ];
            if (query.fields) {
                const fields = query.fields.split(',');
                const projection = {};
                fields.forEach((field) => {
                    projection[field] = 1;
                });
                queryArray.push(projection);
            }
            if (query.skip) {
                queryArray.push({$skip: query.skip});
            }
            if (query.limit) {
                queryArray.push({$limit: query.limit});
            }
            let mongoObj = {
                type: SCHEMA_TYPE.FOLDERS,
                data: [queryArray]
            }
            MongoDbCrudOpration(companyId, mongoObj, 'aggregate').then((res)=>{
                resolve(res);
            }).catch((error)=>{
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    })
}

exports.getSprintFolder = async (req,res) => {
    try {
        const projectId = req.params.id;
        const companyId = req.headers['companyid'];
        const uid = req.uid;

        if (!validateObjectId(projectId)) {
            return res.status(400).json({ message: "Invalid project ID" });
        }

        const companyObj = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                { userId: uid },
                { roleType: 1, _id: 0 }
            ]
        };

        const companyUsers = await MongoDbCrudOpration(companyId, companyObj, 'findOne')
        const roleType = companyUsers?.roleType;


        if (req.query.collection) {
            if (req.query.collection === 'sprints' || req.query.collection === 'folders') {
                if (req.query.count) {
                    // BUG-032 / #86 fix: count was including soft-deleted
                    // sprints/folders, which made the sidebar counters disagree
                    // with the actual list.
                    const countMatch = req.query.collection === 'sprints'
                        ? await exports.sprintVisibilityMatch(uid, companyId, projectId, roleType)
                        : {
                            projectId: new mongoose.Types.ObjectId(projectId),
                            deletedStatusKey: { $nin: [1] }
                        };
                    let data = [{ $match: countMatch }]
                    if (req.query.fields) {
                        const fields = req.query.fields.split(',');
                        const projection = {};
                        fields.forEach((field) => {
                            projection[field] = 1;
                        });
                        data.push(projection);
                    } 
                    if (req.query.count) {
                        data.push({$count: 'count'});
                    }
                    if (req.query.skip) {
                        data.push({$skip: req.query.skip});
                    }
                    if (req.query.limit) {
                        data.push({$limit: req.query.limit});
                    }
                    let mongoObj = {
                        type: req.query.collection === 'sprints' ? SCHEMA_TYPE.SPRINTS: SCHEMA_TYPE.FOLDERS,
                        data: [data]
                    }
                    const result = await MongoDbCrudOpration(companyId, mongoObj, 'aggregate');
                    res.status(200).json(result);
                } else {
                    if (req.query.collection === 'sprints') {
                        exports.getDefaultSprintData(uid,req.query,companyId,projectId, roleType).then((ele)=>{
                            res.status(200).json(ele);
                        }).catch((error)=>{
                            logger.error(`${error}`);
                            res.status(400).json({error: error});
                        })
                    } else if (req.query.collection === 'folders') {
                        exports.getDefaultFolderData(uid,req.query,companyId,projectId, roleType).then((ele)=>{
                            res.status(200).json(ele);
                        }).catch((error)=>{
                            res.status(400).json({error: error});
                        })
                    }
                }
            } else {
                return res.status(400).json({message: 'Invalid type'});    
            }
        } else {
            return res.status(400).json({message: 'Type is required'});
        }
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while fetching the projects", error: error.message });
    }
}