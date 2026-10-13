const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { fetchRules } = require("../../settings/securityPermissions/controller");
const mongoose = require("mongoose")
const { escapeRegex } = require("../../../utils/escapeRegex");
const { ACTIVE_SEAT } = require("../../../Config/seatStatus");
const { isPrivileged } = require("../../../Config/roleTypes");
const { arrangeRules, rolePermission, PRIVATE_PROJECTS, seesEveryPrivateProject } = require("../../../Config/rulePermissions");
const { ownOrNotPersonal, othersPersonalListIds } = require("../../PersonalList/ownership");
const { visibleProjectIds } = require("../../Agents/scope");
const { sprintIdentities, visibleSprintClause } = require("../../Sprints/helpers/sprintVisibility");

exports.projectFilter = async (req, res) => {
    try {
        const { uid } = req;
        const companyId = req.headers['companyid'];

        if (!uid || !companyId) {
            return res.status(404).json({ message: "UID or companyId not found" });
        }

        if (!req.body.type) {
            return res.status(404).json({ message: "Type is not found" });
        }

        const [teams, seat] = await Promise.all([
            getTeamData(uid, companyId),
            getActiveSeat(uid, companyId)
        ]);
        if (!seat) {
            return res.status(200).json([]);
        }

        const teamIds = teams.map((team) => 'tId_' + team._id);
        const { roleType } = seat;

        // The same rule as decideProjectAccess in Config/projectAccess.js, so the search never names a project the caller cannot open.
        const everyPrivateProject = isPrivileged(roleType)
            || seesEveryPrivateProject(rolePermission(arrangeRules(await fetchRules(companyId)), roleType, PRIVATE_PROJECTS));

        const privateQuery = preparePrivateQuery(uid, teamIds, everyPrivateProject);
        const publicQuery = preparePublicQuery(uid);

        const joinsSprints = ['sprint', 'folder', 'projectFilter_folder', 'projectFilter_sprint'].includes(req.body.type);
        const visibleSprints = joinsSprints && !isPrivileged(roleType) ? [{ $match: visibleSprintClause(await sprintIdentities(companyId, uid)) }] : [];

        let projectQuery;
        if (req.body.type === 'sprint') {
            projectQuery = buildSprintQuery(req, privateQuery, publicQuery, visibleSprints);
        } else if (req.body.type === 'folder') {
            projectQuery = buildFolderQuery(req, privateQuery, publicQuery, visibleSprints);
        } else if (req.body.type === 'projectName') {
            projectQuery = buildProjectNameQuery(req, privateQuery, publicQuery);
        } else if (req.body.type === 'projectFilter') {
            projectQuery = buildProjectFilterQuery(req, privateQuery, publicQuery,uid);
        } else if (req.body.type === 'projectFilter_projectName') {
            projectQuery = buildProjectFilterProjectNameQuery(req, privateQuery, publicQuery,uid);
        } else if (req.body.type === 'projectFilter_folder') {
            projectQuery = buildProjectFilterFolderQuery(req, privateQuery, publicQuery, uid, visibleSprints);
        } else if (req.body.type === 'projectFilter_sprint') {
            projectQuery = buildProjectFilterSprintQuery(req, privateQuery, publicQuery, uid, visibleSprints);
        } else if (req.body.type === 'showArchiveOnly') {
            projectQuery = buildArchivedProjectQuery(await archiveScope(companyId, uid, roleType));
        }
        if (req.body.skip) projectQuery.push({ $skip: Number(req.body.skip) });
        if (req.body.limit) projectQuery.push({ $limit: Number(req.body.limit) });
        const projectObj = {
            type: req.body.type === 'showArchiveOnly' ? SCHEMA_TYPE.SPRINTS : SCHEMA_TYPE.PROJECTS,
            data: [projectQuery]
        };
        const projects = await MongoDbCrudOpration(companyId, projectObj, 'aggregate');
        return res.status(200).json(projects);
    } catch (error) {
        console.error(`Error in projectFilter: ${error?.message}`, error);
        res.status(500).json({ message: "An error occurred while fetching the projects", error: error?.message || error });
    }
}

const getTeamData = async (uid, companyId) => {
    const teamObj = {
        type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
        data: [
            { assigneeUsersArray: { $in: [uid] } },
            { _id: 1 }
        ]
    };
    return await MongoDbCrudOpration(companyId, teamObj, 'find');
};

const getActiveSeat = async (uid, companyId) => {
    const companyObj = {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [
            { userId: uid, ...ACTIVE_SEAT },
            { roleType: 1, _id: 0 }
        ]
    };
    return await MongoDbCrudOpration(companyId, companyObj, 'findOne');
};

const preparePrivateQuery = (uid, teamIds, everyPrivateProject) => ({
    isPrivateSpace: true,
    deletedStatusKey: { $in: [0,undefined] },
    statusType: {$nin: ['close']},
    ...ownOrNotPersonal(uid),
    ...(everyPrivateProject ? {} : { AssigneeUserId: { $in: [uid, ...teamIds] } })
});

// Public means visible to every member: the public_projects permission does not narrow it.
const preparePublicQuery = (uid) => ({
    isPrivateSpace: false,
    deletedStatusKey: { $in: [0,undefined] },
    statusType: {$nin: ['close']},
    ...ownOrNotPersonal(uid)
});

const toObjectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(String(id)));

/* Archived sprints and folders are listed across projects, so the scope is the projects the caller
 * can open. Owners and admins keep every project, trashed ones included, short of someone else's
 * personal list, and read past sprint privacy. */
const archiveScope = async (companyId, uid, roleType) => {
    if (isPrivileged(roleType)) {
        const personalLists = toObjectIds(await othersPersonalListIds(companyId, uid));
        const projects = personalLists.length ? { projectId: { $nin: personalLists } } : {};
        return { sprints: projects, folders: projects };
    }
    const projects = { projectId: { $in: toObjectIds(await visibleProjectIds(companyId, uid)) } };
    return { sprints: { ...projects, ...visibleSprintClause(await sprintIdentities(companyId, uid)) }, folders: projects };
};

/* The projection a search takes from its caller: the fields the web app asks a search for. Mongo adds _id by itself. */
const SEARCH_FIELDS = Object.freeze(['_id', 'ProjectName']);

const buildProjection = (fields) => Object.fromEntries(String(typeof fields === 'string' ? fields : '').split(',')
    .map((field) => field.trim())
    .filter((field) => SEARCH_FIELDS.includes(field))
    .concat('_id')
    .map((field) => [field, 1]));

const finalFilterQery = (query) =>{
    if (query[Object.keys(query)[0]].length) {      
        query[Object.keys(query)[0]].map(condition => {
            if (condition.createdAt || condition.DueDate) {
              const newCondition = { ...condition }; 
              let key = condition.createdAt ? "createdAt" : "DueDate"
              if (newCondition[key].$gt) {
                newCondition[key].$gt = new Date(newCondition[key].$gt);
              }
              if (newCondition[key].$lt) {
                newCondition[key].$lt = new Date(newCondition[key].$lt);
              }
              if (newCondition[key].$lte) {
                newCondition[key].$lte = new Date(newCondition[key].$lte);
              }
              if (newCondition[key].$gte) {
                newCondition[key].$gte = new Date(newCondition[key].$gte);
              }
              return newCondition;
            }
            return condition;
        });
    }
    return query
}

const showArchivedQuery = (showArchived) => {
    if (showArchived) {
        return {
            "$or": [
                {"deletedStatusKey": 1},
            ]
        }
    } else {
        return {
            "$or": [
                {"deletedStatusKey": 0},
                {"deletedStatusKey": {"$exists": false}}
            ]
        }
    }
}

const buildSprintQuery = (req, privateQuery, publicQuery, visibleSprints) => [
    { $match: { $or: [privateQuery, publicQuery] } },
    {
        "$lookup": {
            "from": "sprints",
            "let": { "currentProjectId": "$_id" },
            "pipeline": [
                {
                    "$match": {
                        "$expr": {
                            "$and": [
                                {
                                    "$eq": ["$projectId", "$$currentProjectId"]
                                },
                                {
                                    "$regexMatch": {
                                        "input": "$name",
                                        "regex": escapeRegex(req.body.search),
                                        "options": "i"
                                    }
                                }
                            ]
                        }
                    },
                },
                {
                    "$match": {
                        ...showArchivedQuery(req.body.showArchived)
                    }
                },
                ...visibleSprints
            ],
            "as": "sprintData"
        }
    },
    {
        "$unwind": {
            "path": "$sprintData",
            "preserveNullAndEmptyArrays": true
        }
    },
    {
        "$lookup": {
            "from": "folders",
            "let": { "folderId": "$sprintData.folderId" },
            "pipeline": [
                {
                    "$match": {
                        "$expr": {
                            "$and": [
                                { "$ne": ["$$folderId", null] },  // Check if folderId exists
                                { "$eq": ["$_id", "$$folderId"] }
                            ]
                        }
                    }
                }
            ],
            "as": "folderData"
        }
    },
    {
        "$group": {
            "_id": "$_id",
            "sprints": { "$push": "$sprintData" },
            "folders": { "$addToSet": { "$arrayElemAt": ["$folderData", 0] } }
        }
    },
    {
        "$project": {
            ...buildProjection(req.body.fields),
            "sprints": 1,
            "folders": {
                "$filter": {
                    "input": "$folders",
                    "as": "folder",
                    "cond": { "$ne": ["$$folder", null] }
                }
            }
        }
    },
    {
        "$match": {
            "$or": [
                { "sprints": { "$ne": [] } },
                { "folders": { "$ne": [] } } 
            ]
        }
    }
];


const buildFolderQuery = (req, privateQuery, publicQuery, visibleSprints) => [
    { $match: { $or: [privateQuery, publicQuery] } },
    {
        "$lookup": {
            "from": "folders",
            "let": { "currentProjectId": "$_id" },
            "pipeline": [
                {
                    "$match": {
                        "$expr": {
                            "$and": [
                                { "$eq": ["$projectId", "$$currentProjectId"] },
                                { "$regexMatch": { input: "$name", regex: escapeRegex(req.body.search), options: "i" } }
                            ]
                        }
                    }
                },
                {
                    "$match": {
                        ...showArchivedQuery(req.body.showArchived)
                    }
                }
            ],
            "as": "folderData"
        }
    },
    {
        "$lookup": {
            "as": "sprintData",
            "from": "sprints",
            "let": {
                "folderIds": "$folderData._id"
            },
            "pipeline": [
                {
                    "$match": {
                        "$expr": {
                            "$in": [
                                "$folderId",
                                "$$folderIds"
                            ]
                        }
                    }
                },
                ...visibleSprints
            ]
        }
    },
    {
        "$group": {
            "_id": "$_id",
            "folders": { "$push": "$folderData" },
            "sprints": { "$push": "$sprintData" }
        }
    },
    {
        "$match": {
            "folders": { "$ne": [] }
        }
    },
    {
        "$project": {
            ...buildProjection(req.body.fields),
            "folders": { "$arrayElemAt": ["$folders", 0] },
            "sprints": { "$arrayElemAt": ["$sprints", 0] }
        }
    },
];

const buildProjectNameQuery = (req, privateQuery, publicQuery) => [
    {
        $match: {
          $and: [
            {
              $or: [
                privateQuery,
                publicQuery
              ]
            },
            {
              ProjectName: { $regex: escapeRegex(req.body.search), $options: "i" }
            }
          ]
        }
    },
    {
        "$project": {
            ...buildProjection(req.body.fields),
        }
    },
      
];


const buildProjectFilterQuery = (req, privateQuery, publicQuery,userId) => {
    if (req.body.query[Object.keys(req.body.query)[0]]?.length) {
        let isClose = false;
        req.body.query[Object.keys(req.body.query)[0]].forEach((ele)=>{
            if (ele?.status && ele?.status["$in"].includes('close')) {
                isClose = true;
            }
        })
        if (isClose) {
            delete privateQuery.statusType
            delete publicQuery.statusType
        }
    }
    let qry = [
        {
            $match: {
                $and: [
                    {
                        $or: [
                            privateQuery,
                            publicQuery
                        ]
                    }
                ]
            }
        }
    ];
    if (req.body.query[Object.keys(req.body.query)[0]]?.length) {
        qry[0]["$match"]["$and"].push({
            ...finalFilterQery(req.body.query)
        })
    }
    if (Object.keys(req.body.sortByField).length) {
        if (req.body.sortByField.value === 'running_time_tracker') {
            qry.push({"$sort": {"lastProjectActivity": req.body.sortByOrder.value === 'asc' ?  1 : -1}})  
        } else if (req.body.sortByField.value === 'name') {
            qry.push({"$sort": {"ProjectName": req.body.sortByOrder.value === 'asc' ?  1 : -1}})  
        } else if (req.body.sortByField.value === 'due_date') {
            qry.push({"$sort": {"DueDate": req.body.sortByOrder.value === 'asc' ?  1 : -1}});
        } else if (req.body.sortByField.value === 'created_at') {
            qry.push({"$sort": {"createdAt": req.body.sortByOrder.value === 'asc' ?  1 : -1}});
        } else {
            qry.push(
                {
                    $lookup: {
                        from: 'userId',
                        let: { docIdVar: "$_id" },
                        pipeline: [
                            {
                                "$match": {
                                    "$expr": {
                                        "$and": [
                                            { "$eq": ["$userId", userId] }
                                        ]
                                    }
                                }
                            },
                            {
                                $addFields: {
                                    totalcomments: {
                                        $sum: {
                                            $map: {
                                                input: {
                                                    $filter: {
                                                        input: { $objectToArray: '$$ROOT' },
                                                        as: 'field',
                                                        cond: {
                                                            $and: [
                                                               { $regexMatch: {
                                                                    input: '$$field.k',
                                                                    regex: {  $toString: "$$docIdVar"  }
                                                                }},
                                                                { $gte: ["$$field.v", 0] }
                                                            ]
                                                        }
                                                    }
                                                },
                                                as: 'matchedField',
                                                in: '$$matchedField.v'
                                            }
                                        }
                                    }
                                }
                            }
                        ],
                        as: 'commentsData'
                    }
                },
                {
                    $unwind: {
                        path: '$commentsData',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $group: {
                        _id: '$_id',
                        totalcommentsSum: {
                            $sum: '$commentsData.totalcomments'
                        }
                    }
                },
                {
                    $sort: {
                        totalcommentsSum: req.body.sortByOrder.value === 'asc' ? 1 : -1
                    }
                }
            );
            
        }
    }
    qry.push({ "$project": buildProjection(req.body.fields) });
    return qry
}

const buildProjectFilterProjectNameQuery = (req, privateQuery, publicQuery,userId) => {
    if (req.body.query[Object.keys(req.body.query)[0]].length) {
        let isClose = false;
        req.body.query[Object.keys(req.body.query)[0]].forEach((ele)=>{
            if (ele?.status && ele?.status["$in"].includes('close')) {
                isClose = true;
            }
        })
        if (isClose) {
            delete privateQuery.statusType
            delete publicQuery.statusType
        }
    }
    let qry = [
        {
            $match: {
                $and: [
                    {
                      $or: [
                        privateQuery,
                        publicQuery
                      ]
                    },
                    {
                      ProjectName: { $regex: escapeRegex(req.body.search), $options: "i" }
                    }
                ]
            }
        }
    ];
    if (req.body.query[Object.keys(req.body.query)[0]].length) {
        qry[0]["$match"]["$and"].push({
            ...finalFilterQery(req.body.query)
        })
    }
    if (Object.keys(req.body.sortByField).length) {
        if (req.body.sortByField.value === 'running_time_tracker') {
            qry.push({"$sort": {'lastProjectActivity': req.body.sortByOrder.value === 'asc' ?  1 : -1}})  
        } else if (req.body.sortByField.value === 'name') {
            qry.push({"$sort": {"ProjectName": req.body.sortByOrder.value === 'asc' ?  1 : -1}})  
        } else if (req.body.sortByField.value === 'due_date') {
            qry.push({"$sort": {"DueDate": req.body.sortByOrder.value === 'asc' ?  1 : -1}});
        } else if (req.body.sortByField.value === 'created_at') {
            qry.push({"$sort": {"createdAt": req.body.sortByOrder.value === 'asc' ?  1 : -1}});
        } else {
            qry.push(
                {
                    $lookup: {
                        from: 'userId',
                        let: { docIdVar: "$_id" },
                        pipeline: [
                            {
                                "$match": {
                                    "$expr": {
                                        "$and": [
                                            { "$eq": ["$userId", userId] }
                                        ]
                                    }
                                }
                            },
                            {
                                $addFields: {
                                    totalcomments: {
                                        $sum: {
                                            $map: {
                                                input: {
                                                    $filter: {
                                                        input: { $objectToArray: '$$ROOT' },
                                                        as: 'field',
                                                        cond: {
                                                            $and: [
                                                               { $regexMatch: {
                                                                    input: '$$field.k',
                                                                    regex: {  $toString: "$$docIdVar"  }
                                                                }},
                                                                { $gte: ["$$field.v", 0] }
                                                            ]
                                                        }
                                                    }
                                                },
                                                as: 'matchedField',
                                                in: '$$matchedField.v'
                                            }
                                        }
                                    }
                                }
                            }
                        ],
                        as: 'commentsData'
                    }
                },
                {
                    $unwind: {
                        path: '$commentsData',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $group: {
                        _id: '$_id',
                        totalcommentsSum: {
                            $sum: '$commentsData.totalcomments'
                        }
                    }
                },
                {
                    $sort: {
                        totalcommentsSum: req.body.sortByOrder.value === 'asc' ? 1 : -1
                    }
                }
            );
            
        }
    }
    qry.push({ "$project": buildProjection(req.body.fields) });
    return qry
}


const buildProjectFilterFolderQuery = (req, privateQuery, publicQuery, userId, visibleSprints) => {
    if (req.body.query[Object.keys(req.body.query)[0]].length) {
        let isClose = false;
        req.body.query[Object.keys(req.body.query)[0]].forEach((ele)=>{
            if (ele?.status && ele?.status["$in"].includes('close')) {
                isClose = true;
            }
        })
        if (isClose) {
            delete privateQuery.statusType
            delete publicQuery.statusType
        }
    }
    let qry = [
        {
            $match: {
                $and: [
                    {
                        $or: [
                            privateQuery,
                            publicQuery
                        ]
                    }
                ]
            }
        },
        {
            "$lookup": {
                "from": "folders",
                "let": { "currentProjectId": "$_id" },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    { "$eq": ["$projectId", "$$currentProjectId"] },
                                    { "$regexMatch": { input: "$name", regex: escapeRegex(req.body.search), options: "i" } }
                                ]
                            }
                        }
                    },
                    {
                        "$match": {
                            ...showArchivedQuery(req.body.showArchived)
                        }
                    }
                ],
                "as": "folderData"
            }
        },
        {
            "$lookup": {
                "as": "sprintData",
                "from": "sprints",
                "let": {
                    "folderIds": "$folderData._id"
                },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$in": [
                                    "$folderId",
                                    "$$folderIds"
                                ]
                            }
                        }
                    },
                    ...visibleSprints
                ]
            }
        },
        {
            "$group": {
                "_id": "$_id",
                "folders": { "$push": "$folderData" },
                "sprints": { "$push": "$sprintData" }
            }
        },
        {
            "$match": {
                "folders": { "$ne": [] }
            }
        },
    ];
    if (req.body.query[Object.keys(req.body.query)[0]].length) {
        qry[0]["$match"]["$and"].push({
            ...finalFilterQery(req.body.query)
        })
    }
    if (Object.keys(req.body.sortByField).length) {
        if (req.body.sortByField.value === 'running_time_tracker') {
            qry.push({"$sort": {'lastProjectActivity': req.body.sortByOrder.value === 'asc' ?  1 : -1}})  
        } else if (req.body.sortByField.value === 'name') {
            qry.push({"$sort": {"ProjectName": req.body.sortByOrder.value === 'asc' ?  1 : -1}})  
        } else if (req.body.sortByField.value === 'due_date') {
            qry.push({"$sort": {"DueDate": req.body.sortByOrder.value === 'asc' ?  1 : -1}});
        } else if (req.body.sortByField.value === 'created_at') {
            qry.push({"$sort": {"createdAt": req.body.sortByOrder.value === 'asc' ?  1 : -1}});
        } else {
            qry.push(
                {
                    $lookup: {
                        from: 'userId',
                        let: { docIdVar: "$_id" },
                        pipeline: [
                            {
                                "$match": {
                                    "$expr": {
                                        "$and": [
                                            { "$eq": ["$userId", userId] }
                                        ]
                                    }
                                }
                            },
                            {
                                $addFields: {
                                    totalcomments: {
                                        $sum: {
                                            $map: {
                                                input: {
                                                    $filter: {
                                                        input: { $objectToArray: '$$ROOT' },
                                                        as: 'field',
                                                        cond: {
                                                            $and: [
                                                               { $regexMatch: {
                                                                    input: '$$field.k',
                                                                    regex: {  $toString: "$$docIdVar"  }
                                                                }},
                                                                { $gte: ["$$field.v", 0] }
                                                            ]
                                                        }
                                                    }
                                                },
                                                as: 'matchedField',
                                                in: '$$matchedField.v'
                                            }
                                        }
                                    }
                                }
                            }
                        ],
                        as: 'commentsData'
                    }
                },
                {
                    $unwind: {
                        path: '$commentsData',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $group: {
                        _id: '$_id',
                        totalcommentsSum: {
                            $sum: '$commentsData.totalcomments'
                        }
                    }
                },
                {
                    $sort: {
                        totalcommentsSum: req.body.sortByOrder.value === 'asc' ? 1 : -1
                    }
                }
            );
            
        }
    }
    qry.push({
            "$project": {
                ...buildProjection(req.body.fields),
                "folders": { "$arrayElemAt": ["$folders", 0] },
                "sprints": { "$arrayElemAt": ["$sprints", 0] }
            }
    })
    return qry
}

const buildProjectFilterSprintQuery = (req, privateQuery, publicQuery, userId, visibleSprints) => {
    if (req.body.query[Object.keys(req.body.query)[0]].length) {
        let isClose = false;
        req.body.query[Object.keys(req.body.query)[0]].forEach((ele)=>{
            if (ele?.status && ele?.status["$in"].includes('close')) {
                isClose = true;
            }
        })
        if (isClose) {
            delete privateQuery.statusType
            delete publicQuery.statusType
        }
    }
    let qry = [
        {
            $match: {
                $and: [
                    {
                        $or: [
                            privateQuery,
                            publicQuery
                        ]
                    }
                ]
            }
        },
        {
            "$lookup": {
                "from": "sprints",
                "let": { "currentProjectId": "$_id" },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {
                                        "$eq": ["$projectId", "$$currentProjectId"]
                                    },
                                    {
                                        "$regexMatch": {
                                            "input": "$name",
                                            "regex": escapeRegex(req.body.search),
                                            "options": "i"
                                        }
                                    }
                                ]
                            }
                        }
                    },
                    {
                        "$match": {
                            ...showArchivedQuery(req.body.showArchived)
                        }
                    },
                    ...visibleSprints
                ],
                "as": "sprintData"
            }
        },
        {
            "$unwind": {
                "path": "$sprintData",
                "preserveNullAndEmptyArrays": true
            }
        },
        {
            "$lookup": {
                "from": "folders",
                "let": { "folderId": "$sprintData.folderId" },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    { "$ne": ["$$folderId", null] },  // Check if folderId exists
                                    { "$eq": ["$_id", "$$folderId"] }
                                ]
                            }
                        }
                    }
                ],
                "as": "folderData"
            }
        },
        {
            "$group": {
                "_id": "$_id",
                "lastProjectActivity": { "$first": "$lastProjectActivity" }, 
                "sprints": { "$push": "$sprintData" },
                "folders": { "$addToSet": { "$arrayElemAt": ["$folderData", 0] } }
            }
        },
        {
            "$match": {
                "$or": [
                    { "sprints": { "$ne": [] } },
                    { "folders": { "$ne": [] } } 
                ]
            }
        }
    ];
    if (req.body.query[Object.keys(req.body.query)[0]].length) {
        qry[0]["$match"]["$and"].push({
            ...finalFilterQery(req.body.query)
        })
    }
    if (Object.keys(req.body.sortByField).length) {
        if (req.body.sortByField.value === 'running_time_tracker') {
            qry.push({"$sort": {"lastProjectActivity": req.body.sortByOrder.value === 'asc' ?  1 : -1}})  
        } else if (req.body.sortByField.value === 'name') {
            qry.push({"$sort": {"ProjectName": req.body.sortByOrder.value === 'asc' ?  1 : -1}})  
        } else if (req.body.sortByField.value === 'due_date') {
            qry.push({"$sort": {"DueDate": req.body.sortByOrder.value === 'asc' ?  1 : -1}});
        } else if (req.body.sortByField.value === 'created_at') {
            qry.push({"$sort": {"createdAt": req.body.sortByOrder.value === 'asc' ?  1 : -1}});
        } else {
            qry.push(
                {
                    $lookup: {
                        from: 'userId',
                        let: { docIdVar: "$_id" },
                        pipeline: [
                            {
                                "$match": {
                                    "$expr": {
                                        "$and": [
                                            { "$eq": ["$userId", userId] }
                                        ]
                                    }
                                }
                            },
                            {
                                $addFields: {
                                    totalcomments: {
                                        $sum: {
                                            $map: {
                                                input: {
                                                    $filter: {
                                                        input: { $objectToArray: '$$ROOT' },
                                                        as: 'field',
                                                        cond: {
                                                            $and: [
                                                               { $regexMatch: {
                                                                    input: '$$field.k',
                                                                    regex: {  $toString: "$$docIdVar"  }
                                                                }},
                                                                { $gte: ["$$field.v", 0] }
                                                            ]
                                                        }
                                                    }
                                                },
                                                as: 'matchedField',
                                                in: '$$matchedField.v'
                                            }
                                        }
                                    }
                                }
                            }
                        ],
                        as: 'commentsData'
                    }
                },
                {
                    $unwind: {
                        path: '$commentsData',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $group: {
                        "_id": "$_id",
                        "totalcommentsSum": {
                            "$sum": {
                                "$ifNull": ["$commentsData.totalcomments", 0]
                            }
                        },
                        "sprints": { "$first": "$sprints" },
                        "folders": { "$first": "$folders" }
                    }
                },
                {
                    $sort: {
                        totalcommentsSum: req.body.sortByOrder.value === 'asc' ? 1 : -1
                    }
                }
            );
            
        }
    }
    qry.push({
            "$project": {
                ...buildProjection(req.body.fields),
                "sprints": 1,
                "folders": {
                    "$filter": {
                        "input": "$folders",
                        "as": "folder",
                        "cond": { "$ne": ["$$folder", null] }
                    }
                }
            }
    })
    return qry
}

const buildArchivedProjectQuery = (scope) => {
    let qry = [
        {
            $match: {
                $and: [
                    scope.sprints,
                    { $or: [{ deletedStatusKey: 2 }, { archiveTaskCount: { $gt: 1 } }] }
                ]
            }
        },
        {
            $lookup: {
                from: "folders",
                localField: "folderId",
                foreignField: "_id",
                as: "folderData"
            }
        },
        {
            $addFields: {
                source: "matchedDocuments"
            }
        },
        {
            $unionWith: {
                coll: "folders",
                pipeline: [
                    {
                        $match: {
                            ...scope.folders,
                            deletedStatusKey: 2
                        }
                    },
                    {
                        $addFields: {
                            source: "additionalFolders"
                        }
                    }
                ]
            }
        },
        {
            $facet: {
                matchedDocuments: [
                    { $match: { source: "matchedDocuments" } },
                    { $unset: "source" }
                ],
                additionalFolders: [
                    { $match: { source: "additionalFolders" } },
                    { $unset: "source" } 
                ]
            }
        }
    ];
    return qry;
};

exports.getRemainingProject = async (req, res) => {
    try {
        const { dataIds } = req.body || {};

        if (!Array.isArray(dataIds) || !dataIds.length || !dataIds.every((id) => /^[a-f0-9]{24}$/i.test(String(id)))) {
            const statusText = "'dataIds' must be a non-empty list of project ids.";
            return res.status(400).json({ status: false, statusText, message: statusText, field: 'dataIds' });
        }

        const convertIds = dataIds.map(x => new mongoose.Types.ObjectId(x))
        const query = {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                {
                    _id: { $in: convertIds }
                }
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], query, 'find');

        return res.status(200).json({ status: true, data: response || [] });

    } catch (error) {
        const statusText = "An error occurred while get the remaining projects";
        return res.status(500).json({ status: false, statusText, message: statusText });
    }
}