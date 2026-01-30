const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const {myCache} = require('../../../Config/config');
const { fetchRules } = require("../../settings/securityPermissions/controller");

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
                { userId: uid },
                { roleType: 1, _id: 0 }
            ]
        };
        const [teams, companyUsers] = await Promise.all([
            MongoDbCrudOpration(companyId, teamObj, 'find'),
            MongoDbCrudOpration(companyId, companyObj, 'findOne')
        ]);

        const teamIds = teams.map((team) => 'tId_' + team._id);
        const roleType = companyUsers?.roleType;

        const response = await fetchRules(companyId);

        const rule = response && response.length ? response?.find((x) => x?.key === 'public_projects') : {};
        const showAllProjects = rule?.roles?.find((role) => role.key === roleType)?.permission === true;

        const privateRule = response?.find((x) => x?.key === 'private_projects') || {};
        const privatePermission = privateRule?.roles?.find((role) => role.key === roleType)?.permission;
        
        const isNonAdmin = roleType !== 1 && roleType !== 2;

        const assigneeUserIdCondition = {
            $in: [uid, ...teamIds]
        };

        const privateQuery = {
            isPrivateSpace: true,
            deletedStatusKey: { $nin: [1] },
            ...(isNonAdmin && privatePermission === 1 && { AssigneeUserId: assigneeUserIdCondition })
        };

        const publicQuery = {
            isPrivateSpace: false,
            deletedStatusKey: { $nin: [1] },
            ...(isNonAdmin && !showAllProjects && { AssigneeUserId: assigneeUserIdCondition })
        };

        const projectQuery = [
            {
                $match: {
                    $or: [
                        ...(
                            (privatePermission !== null || !isNonAdmin) && privateQuery ?
                            [privateQuery] : []
                        ),
                        publicQuery
                    ]
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