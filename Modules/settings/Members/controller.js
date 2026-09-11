const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const { myCache } = require('../../../Config/config');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');
const reportingLine = require('../../Users/helpers/reportingLine');
const { getRoleType, isPrivileged, invalidateRoleCache, ROLE_OWNER } = require('../../../Config/permissionGuard');
const { judgeMemberUpdate, judgeInvitationAcceptance } = require('./membershipGuard');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const ACTIVE = 2;
const MEMBERSHIP_FIELDS = ['roleType', 'status', 'isDelete'];

const MANAGER_ERROR = Object.freeze({
    [reportingLine.REASON.NO_SUBJECT]: 'That member is not part of this workspace.',
    [reportingLine.REASON.NOT_A_PERSON]: 'Only people can hold a reporting line.',
    [reportingLine.REASON.SELF]: 'Nobody can report to themselves.',
    [reportingLine.REASON.UNKNOWN]: 'That manager is not a member of this workspace.',
    [reportingLine.REASON.GUEST]: 'A guest cannot be a manager.',
    [reportingLine.REASON.NOT_ACTIVE]: 'A manager has to be an active member.',
    [reportingLine.REASON.CYCLE]: 'That would make the reporting line loop back on itself.'
});

const refuse = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const listCompanyMembers = (companyId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [{}]
}, 'find').then((rows) => rows || []).catch(() => []);

const setMemberFields = (companyId, docId, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [{ _id: new mongoose.Types.ObjectId(docId) }, { $set: set }]
}, 'updateOne');

const findMemberRow = (companyId, id) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMPANY_USERS,
    data: [{ _id: new mongoose.Types.ObjectId(id) }]
}, 'findOne');

/* A changed role or seat must take effect now, not when the 60-second role and membership caches expire. */
const forgetMembership = (companyId, userId) => {
    if (!userId) return;
    invalidateRoleCache(companyId, userId);
    require('../../../Config/jwt').invalidateMembershipCache(String(userId), companyId);
};

const clearMemberCaches = (companyId, userId) => {
    removeCache(`company_users:${companyId}`);
    removeCache("UserProjectData:", true);
    removeCache(`UserData:${userId}`, false);
    removeCache(`UserAllData:${companyId}`);
};

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

/* Private views live on the caller's own membership row; nobody else, the owner included, may change them. */
exports.handlePrivateView = async (req, res) => {
    try {
        const { id, data, operation, key } = req.body;
        const companyId = req.headers['companyid'];

        if (!id || !OBJECT_ID_PATTERN.test(String(id))) {
            return refuse(res, 400, `Document 'id' parameter is required`);
        }
        if (!isPlainObject(data)) {
            return refuse(res, 400, `'data' parameter is required.`);
        }

        let update = {};
        if (operation === 'push') {
            update = {
                $push: { ProjectRequiredComponent: data }
            }
        } else if (operation === 'update') {
            if(!data.id && ["name"].includes(key)) {
                return refuse(res, 400, `Element 'id' parameter is required.`);
            }
            update = {
                $set: { "ProjectRequiredComponent.$[elem].name": data.name }
            }
        } else if (operation === 'delete') {
            update = {
                $pull: { ProjectRequiredComponent: { id: data.id } }
            }
        } else {
            return refuse(res, 400, 'Invalid operation type. Supported operations: push, update, delete');
        }

        const row = await findMemberRow(companyId, id);
        if (!row) {
            return refuse(res, 404, 'That member is not part of this workspace.');
        }
        if (!req.uid || String(row.userId || '') !== String(req.uid)) {
            return refuse(res, 403, 'You can only change your own private views.');
        }

        const options = (operation === 'update' && (["name"].includes(key))) ? { arrayFilters: [{ "elem.id": data.id }] } : undefined;

        const params = {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id),
                    userId: String(req.uid)
                },
                update,
                options
            ]
        }

        const response = await MongoDbCrudOpration(companyId, params, 'updateOne');

        clearMemberCaches(companyId, req.uid);
        socketEmitter.emit('update', {
            type: 'update',
            data: { data: { _id: String(id), userId: String(req.uid) } },
            updatedFields: { ProjectRequiredComponent: operation },
            module: 'companyUsers'
        });

        if (response) {
            return res.status(200).json({ status: true, statusText: 'Private view saved.' });
        } else {
            return res.status(404).json({ status: false, statusText: 'Private view not saved.' });
        }

    } catch (error) {
        return res.status(500).json({
            status: false,
            statusText: "An error occurred while update the user specific private view",
            message: error.message || error
        });
    }
}

exports.updateMember = async (req, res) => {
    try {
        const { id, data } = req.body;
        const companyId = req.headers['companyid'];

        if (!id || !OBJECT_ID_PATTERN.test(String(id))) {
            return refuse(res, 400, `'id' parameter is required.`);
        }
        if (!isPlainObject(data)) {
            return refuse(res, 400, `'data' parameter is required.`);
        }

        const members = await listCompanyMembers(companyId);
        const subject = members.find((member) => String(member._id) === String(id));
        if (!subject) {
            return refuse(res, 404, MANAGER_ERROR[reportingLine.REASON.NO_SUBJECT]);
        }

        const callerRole = await getRoleType(companyId || '', req.uid);
        const changesManager = Object.prototype.hasOwnProperty.call(data, 'managerId');
        if (changesManager && !isPrivileged(callerRole)) {
            return refuse(res, 403, 'Only an owner or an admin can change who someone reports to.');
        }

        const activeOwners = members.filter((member) => member.roleType === ROLE_OWNER && member.status === ACTIVE && member.isDelete !== true).length;
        const verdict = judgeMemberUpdate({ callerId: req.uid, callerRole, target: subject, data, activeOwners });
        if (!verdict.ok) {
            return refuse(res, verdict.code, verdict.statusText);
        }

        // Losing the seat, the invite or the member role all strand whoever reports here.
        const becomesGuest = data.roleType !== undefined && data.roleType !== null && Number(data.roleType) === reportingLine.GUEST_ROLE;
        const departing = data.isDelete === true || Number(data.status) === 3 || becomesGuest;

        if (changesManager) {
            const check = reportingLine.validateManagerAssignment(members, subject.userId, data.managerId);
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
        if (!response) {
            return refuse(res, 404, MANAGER_ERROR[reportingLine.REASON.NO_SUBJECT]);
        }

        if (departing) {
            const moves = reportingLine.reassignReports(members, subject.userId);
            for (const move of moves) {
                if (move.docId) await setMemberFields(companyId, move.docId, { managerId: move.managerId });
            }
        }

        clearMemberCaches(companyId, response.userId);
        if (MEMBERSHIP_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field))) {
            forgetMembership(companyId, subject.userId);
        }
        socketEmitter.emit('update', {
            type: 'update',
            data: { data: response },
            updatedFields: { ...data },
            module: 'companyUsers'
        });

        try {
            require('../../Audit/recorder').recordAuditFromReq(req, {
                action: 'member.update', entityType: 'member', entityId: String(id),
                meta: { fields: Object.keys(data) },
            });
        } catch (e) { /* audit is best-effort */ }

        return res.status(200).json({ status: true, statusText: 'Member updated.', data: response });
    } catch (error) {
        return res.status(500).json({
            status: false,
            statusText: "An error occurred while update company member user",
            message: error.message || error
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

/* The invitation-accept call (Invitation.vue): the invitee links their own account to the pending row. */
exports.rootUpdateMember = async (req, res) => {
    try {
        const { id, data, companyId } = req.body;

        if (!id || !OBJECT_ID_PATTERN.test(String(id))) {
            return refuse(res, 400, `'id' parameter is required.`);
        }
        if (!companyId || !OBJECT_ID_PATTERN.test(String(companyId))) {
            return refuse(res, 400, `'companyId' parameter is required.`);
        }
        if (!isPlainObject(data)) {
            return refuse(res, 400, `'data' parameter is required.`);
        }
        if (!req.uid || !OBJECT_ID_PATTERN.test(String(req.uid))) {
            return refuse(res, 401, 'Sign in to accept an invitation.');
        }

        const invite = await findMemberRow(companyId, id);
        if (!invite) {
            return refuse(res, 404, 'That invitation does not exist.');
        }
        const caller = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: String(req.uid) }, { Employee_Email: 1 }]
        }, 'findOne');

        const verdict = judgeInvitationAcceptance({ callerId: req.uid, callerEmail: caller && caller.Employee_Email, invite, data });
        if (!verdict.ok) {
            return refuse(res, verdict.code, verdict.statusText);
        }

        const accepted = { userId: String(req.uid), status: ACTIVE };
        const response = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                { _id: new mongoose.Types.ObjectId(id) },
                { $set: accepted },
                { returnDocument: 'after' }
            ]
        }, 'findOneAndUpdate');

        clearMemberCaches(companyId, req.uid);
        forgetMembership(companyId, req.uid);
        socketEmitter.emit('update', {
            type: 'update',
            data: { data: response },
            updatedFields: accepted,
            module: 'companyUsers'
        });

        return res.status(200).json({ status: true, statusText: 'Invitation accepted.', data: response || {} });
    } catch (error) {
        return res.status(500).json({
            status: false,
            statusText: "An error occurred while update company member user",
            message: error.message || error
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
