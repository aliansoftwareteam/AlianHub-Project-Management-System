const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const {myCache} = require('../../../Config/config');
const { fetchRules } = require("../../settings/securityPermissions/controller");
const { isPrivileged } = require("../../../Config/roleTypes");
const { ACTIVE_SEAT } = require("../../../Config/seatStatus");
const { arrangeRules, rolePermission, PRIVATE_PROJECTS, seesEveryPrivateProject } = require("../../../Config/rulePermissions");

exports.getProjectList = async (req, res) => {
    try {
        const uid = req.uid;
        const companyId = req.headers['companyid'];

        if (!uid || !companyId) {
            return res.status(404).json({ message: "UID or companyId not found" });
        }
        const cacheKey = `UserProjectData:${companyId}:${uid}`;

        const value = myCache.get(cacheKey);
        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }
        const teamObj = {
            type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
            data: [
                { assigneeUsersArray: { $in: [uid] } },
                { _id: 1 }
            ]
        };

        const companyObj = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                { userId: uid, ...ACTIVE_SEAT },
                { roleType: 1, _id: 0 }
            ]
        };
        const [teams, companyUsers] = await Promise.all([
            MongoDbCrudOpration(companyId, teamObj, 'find'),
            MongoDbCrudOpration(companyId, companyObj, 'findOne')
        ]);
        if (!companyUsers) {
            return res.status(200).json([]);
        }

        const teamIds = teams.map((team) => 'tId_' + team._id);
        const { roleType } = companyUsers;

        // The same rule as decideProjectAccess in Config/projectAccess.js, so the list never names a project the caller cannot open.
        const everyPrivateProject = isPrivileged(roleType)
            || seesEveryPrivateProject(rolePermission(arrangeRules(await fetchRules(companyId)), roleType, PRIVATE_PROJECTS));

        const privateQuery = {
            isPrivateSpace: true,
            deletedStatusKey: { $nin: [1] },
            ...(everyPrivateProject ? {} : { AssigneeUserId: { $in: [uid, ...teamIds] } })
        };

        // Public means visible to every member: the public_projects permission no longer narrows it.
        const publicQuery = {
            isPrivateSpace: false,
            deletedStatusKey: { $nin: [1] },
        };

        const projectQuery = [
            {
                $match: {
                    $or: [privateQuery, publicQuery],
                    // A personal list is private to its owner even for admins.
                    $and: [{ $or: [{ isPersonal: { $ne: true } }, { personalOwner: uid }] }]
                }
            },
            {
                $project: {
                    legacyId: 0,
                }
            }
        ];
        if (req.query.skip) {
            projectQuery.push({$skip: Number(req.query.skip)});
        }
        if (req.query.limit) {
            projectQuery.push({$limit: Number(req.query.limit)});
        }

        const projectObj = {
            type: SCHEMA_TYPE.PROJECTS,
            data: [projectQuery]
        };

        const projects = await MongoDbCrudOpration(companyId, projectObj, 'aggregate');
        myCache.set( cacheKey, JSON.stringify(projects), 480 );
        res.status(200).json(projects);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the projects", error: error?.message || error });
    }
}