const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const {myCache} = require('../../../Config/config');
const { fetchRules } = require("../../settings/securityPermissions/controller");
const mongoose = require("mongoose");
const { ROLE_GUEST } = require("../../Auth/helpers/guestAccessRules");

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
                { roleType: 1, guestProjectIds: 1, _id: 0 }
            ]
        };
        const [teams, companyUsers] = await Promise.all([
            MongoDbCrudOpration(companyId, teamObj, 'find'),
            MongoDbCrudOpration(companyId, companyObj, 'findOne')
        ]);

        const teamIds = teams.map((team) => 'tId_' + team._id);
        const roleType = companyUsers?.roleType;

        // SEC-01 — a guest (roleType 4) sees ONLY their explicitly-assigned projects.
        if (roleType === ROLE_GUEST) {
            const guestIds = (Array.isArray(companyUsers?.guestProjectIds) ? companyUsers.guestProjectIds : [])
                .map((id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } })
                .filter(Boolean);
            const guestQuery = [
                { $match: { _id: { $in: guestIds }, deletedStatusKey: { $nin: [1] } } },
                { $project: { legacyId: 0 } },
            ];
            if (req.query.skip) guestQuery.push({ $skip: Number(req.query.skip) });
            if (req.query.limit) guestQuery.push({ $limit: Number(req.query.limit) });
            const guestProjects = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [guestQuery] }, 'aggregate');
            myCache.set(cacheKey, JSON.stringify(guestProjects), 480);
            return res.status(200).json(guestProjects);
        }

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

        // Public projects are visible to ALL company members by design — no
        // assignment required. (Previously filtered non-admins without the
        // `public_projects` permission down to assigned-only; that gate is
        // removed so "public" means visible to everyone.) Private projects
        // remain gated by privateQuery above. Applies to web app + MCP (same
        // endpoint).
        const publicQuery = {
            isPrivateSpace: false,
            deletedStatusKey: { $nin: [1] },
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