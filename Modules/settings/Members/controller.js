const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const { myCache } = require('../../../Config/config');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');
const reportingLine = require('../../Users/helpers/reportingLine');

const MANAGER_ERROR = Object.freeze({
    [reportingLine.REASON.NO_SUBJECT]: 'That member is not part of this workspace.',
    [reportingLine.REASON.NOT_A_PERSON]: 'Only people can hold a reporting line.',
    [reportingLine.REASON.SELF]: 'Nobody can report to themselves.',
    [reportingLine.REASON.UNKNOWN]: 'That manager is not a member of this workspace.',
    [reportingLine.REASON.GUEST]: 'A guest cannot be a manager.',
    [reportingLine.REASON.NOT_ACTIVE]: 'A manager has to be an active member.',
    [reportingLine.REASON.CYCLE]: 'That would make the reporting line loop back on itself.'
});

const listCompanyMembers = (companyId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [{}]
}, 'find').then((rows) => rows || []).catch(() => []);

const setMemberFields = (companyId, docId, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [{ _id: new mongoose.Types.ObjectId(docId) }, { $set: set }]
}, 'updateOne');

/**
 * This endpoint is used to get member users of company
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getMembers = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        let params = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: []
        }

        const cacheKey = `company_users:${companyId}`;
        const hasCache = myCache.get(cacheKey);
        if (hasCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json({ status: true, data: JSON.parse(hasCache) });
        }

        const response = await MongoDbCrudOpration(companyId, params, 'find');
        myCache.set(cacheKey, JSON.stringify(response), 604800);

        if (response) {
            return res.status(200).json({ status: true, data: response });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while get the company users",
            error: error 
        });
    }
}


/**
 * This endpoint is used to get member user of company by its id
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getMembersById = async (req,res) => {
    const companyId = req.headers['companyid'];
    const id = req.params.id;
    const cacheKey = `company_users:${companyId}`;
    const hasCache = myCache.get(cacheKey);
    if (hasCache) {
        let CompanyUsers = JSON.parse(hasCache);
        let member = CompanyUsers.find((x)=> x.userId === id);
        if (member) {        
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(member);
        }
    }
    let params = {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [
            {
                userId: id
            }
        ]
    }
    const response = await MongoDbCrudOpration(companyId, params, 'findOne');
    res.status(200).json(response);

}


/**
 * This endpoint is used to check either role or designation is assigned with any company user or not
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.checkRoleOrDesignationAssignedWithUsers = async (req, res) => {
    try {
        const { key, value } = req.params;
        const companyId = req.headers['companyid'];

        if (!value) {
            return res.status(400).json({
                status: false,
                message: `'value' parameter is required.`
            });
        }

        const query = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                {
                    [key]: value
                }
            ]
        }

        const response = await MongoDbCrudOpration(companyId, query, 'findOne');

        if (response) {
            return res.status(200).json({ isUsed: true });
        } else {
            return res.status(200).json({ isUsed: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while check role or designation is assigned with any company users",
            error: error 
        });
    }
}

/**
 * This endpoint is used for handle all the CRUD operations for the user specific private views
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.handlePrivateView = async (req, res) => {
    try {
        const { id, data, operation, key } = req.body;

        if (!id) {
            return res.status(400).json({
                status: false,
                message: `Document 'id' parameter is required`
            })
        }

        let update = {};
        if (operation === 'push') {
            update = {
                $push: { ProjectRequiredComponent: data }
            }
        } else if (operation === 'update') {
            if(!data.id && ["name"].includes(key)) {
                return res.status(400).json({
                    status: false,
                    message: `Element 'id' parameter is required.`
                });
            }
            update = {
                $set: { "ProjectRequiredComponent.$[elem].name": data.name } 
            }
        } else if (operation === 'delete') {
            update = {
                $pull: { ProjectRequiredComponent: { id: data.id } }
            }
        } else {
            return res.status(400).json({
                status: false,
                message: 'Invalid operation type. Supported operations: push, update, delete'
            });
        }

        const options = (operation === 'update' && (["name"].includes(key))) ? { arrayFilters: [{ "elem.id": data.id }] } : undefined;

        const params = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                },
                update,
                options
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'updateOne');

        removeCache("UserProjectData:", true);
        removeCache(`company_users:${req.headers['companyid']}`);
        removeCache(`UserData:${data.id}`, false);
        removeCache(`UserAllData:${req.headers['companyid']}`);

        if (response) {
            return res.status(200).json({ status: true });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update the user specific private view",
            error: error
        });
    }
}

/**
 * This endpoint is used to update company member user
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateMember = async (req, res) => {
    try {
        const { id, data } = req.body;

        if(!id) {
            return res.status(400).json({
                status: false,
                message: `'id' parameter is required.`
            });
        }

        // Defense in depth: granting owner/admin (roleType 1/2) is OWNER-only.
        // SCOPED TO PAT/MCP REQUESTS ONLY (req.apiToken) so the web app's role
        // management behaves exactly as before — MCP changes must never affect
        // existing frontend/backend behavior (2026-06-15).
        if (req.apiToken && data && data.roleType !== undefined) {
            const { getRoleType, ROLE_OWNER, ROLE_ADMIN } = require('../../../Config/permissionGuard');
            const callerRole = await getRoleType(req.headers['companyid'] || '', req.uid);
            const targetRole = Number(data.roleType);
            if ((targetRole === ROLE_OWNER || targetRole === ROLE_ADMIN) && callerRole !== ROLE_OWNER) {
                return res.status(403).json({
                    status: false,
                    statusText: 'Only the owner can grant owner or admin roles.',
                    error: 'Forbidden',
                });
            }
        }

        const companyId = req.headers['companyid'];
        const changesManager = Boolean(data) && Object.prototype.hasOwnProperty.call(data, 'managerId');
        // Losing the seat, the invite or the member role all strand whoever reports here.
        const becomesGuest = Boolean(data) && data.roleType !== undefined && data.roleType !== null && Number(data.roleType) === reportingLine.GUEST_ROLE;
        const departing = Boolean(data) && (data.isDelete === true || Number(data.status) === 3 || becomesGuest);

        const members = (changesManager || departing) ? await listCompanyMembers(companyId) : [];
        const subject = members.find((member) => String(member._id) === String(id));

        if (changesManager) {
            const { getRoleType, ROLE_OWNER, ROLE_ADMIN } = require('../../../Config/permissionGuard');
            const callerRole = await getRoleType(companyId || '', req.uid);
            if (callerRole !== ROLE_OWNER && callerRole !== ROLE_ADMIN) {
                return res.status(403).json({
                    status: false,
                    statusText: 'Only an owner or an admin can change who someone reports to.',
                    message: 'Forbidden'
                });
            }

            const check = reportingLine.validateManagerAssignment(members, subject && subject.userId, data.managerId);
            if (!check.ok) {
                return res.status(400).json({
                    status: false,
                    statusText: MANAGER_ERROR[check.reason] || 'That reporting line is not allowed.',
                    message: check.reason
                });
            }
            data.managerId = check.managerId;
        }

        const params = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                },
                {
                    $set: { ...data }
                },
                { returnDocument: 'after' }
            ]
        }

        const response = await MongoDbCrudOpration(companyId, params, 'findOneAndUpdate');

        if (departing && subject) {
            const moves = reportingLine.reassignReports(members, subject.userId);
            for (const move of moves) {
                if (move.docId) await setMemberFields(companyId, move.docId, { managerId: move.managerId });
            }
        }

        if (changesManager) {
            socketEmitter.emit('update', {
                type: 'update',
                data: { data: response },
                updatedFields: { managerId: data.managerId },
                module: 'companyUsers'
            });
        }

        removeCache(`company_users:${req.headers['companyid']}`);
        removeCache("UserProjectData:", true);
        removeCache(`UserData:${response.userId}`, false);
        removeCache(`UserAllData:${req.headers['companyid']}`);
        // SEC-04: audit member updates (role / guest-projects / status changes).
        try {
            require('../../Audit/recorder').recordAuditFromReq(req, {
                action: 'member.update', entityType: 'member', entityId: String(id),
                meta: { fields: Object.keys(data || {}) },
            });
        } catch (e) { /* audit is best-effort */ }

        if(response) {
            return res.status(200).json({ status: true, data: response });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update company member user",
            error: error 
        });
    }
}

/**
 * This is common function for update member user
 * @param {*} method 
 * @param {*} queryObject 
 * @param {*} companyId 
 * @returns 
 */
exports.updateMemberFunction = (companyId, queryObject, method) => {
    return new Promise(async (resolve, reject) => {
        try {

            const query = {
                type: SCHEMA_TYPE.COMPANY_USERS,
                data: queryObject
            }

            const response = await MongoDbCrudOpration(companyId, query, method);

            removeCache(`company_users:${companyId}`);
            removeCache(`UserData:${queryObject.userId}`, false);
            removeCache(`UserAllData:${companyId}`);

            return resolve({ message: "Member updated", data: response || {} });
        } catch (error) {
            reject(error);
        }
    })
}
exports.rootUpdateMember = async (req, res) => {
    try {
        const { id, data, companyId } = req.body;

        if(!id) {
            return res.status(400).json({
                status: false,
                message: `'id' parameter is required.`
            });
        }

        // Reporting lines are only writable where the cycle and eligibility rules run.
        if (data && Object.prototype.hasOwnProperty.call(data, 'managerId')) {
            return res.status(400).json({
                status: false,
                statusText: 'Set a reporting line through the members endpoint, where it is validated.',
                message: 'managerId is not writable here'
            });
        }

        const params = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                },
                {
                    $set: { ...data }
                },
                { returnNewDocument: true }
            ]
        }

        const response = await MongoDbCrudOpration(companyId, params, 'findOneAndUpdate');

        removeCache(`company_users:${companyId}`);
        removeCache(`UserData:${data.userId}`, false);
        removeCache(`UserAllData:${companyId}`);

        return res.status(200).json({ status: true, data: response || {} });

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update company member user",
            error: error 
        });
    }
}

exports.getMembersCount = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const query = req.body.query || {};

        const mongoQuery = [
            {
                $match: query
            },
            { $count: "totalCount" }
        ];

        const queryObj = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [mongoQuery]
        };

        const response = await MongoDbCrudOpration(companyId, queryObj, "aggregate");
        return res.status(200).json(response?.length ? response : []);
    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while getting the members count.",
            error: error.message || error
        });
    }
}