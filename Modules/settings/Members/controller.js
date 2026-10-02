const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const { myCache } = require('../../../Config/config');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');
const reportingLine = require('../../Users/helpers/reportingLine');
const { getRoleType, isPrivileged, invalidateRoleCache, ROLE_OWNER } = require('../../../Config/permissionGuard');
const { judgeMemberUpdate, judgeInvitationAcceptance } = require('./membershipGuard');
const { COLLEAGUE, viewerOf, memberRowFor, memberById, colleagueFieldsOf, countFilterOf, inUseFilterOf } = require('./memberRowRules');
const { SEAT_CANCELLED, SEAT_PENDING } = require('../../../Config/seatStatus');
const knowledgeEvents = require('../../Knowledge/ingest/events');
const { recordPrivateViewChange } = require('./privateViewHistory');
const { cleanViewSettings, cleanViewTitle } = require('../../Project/helpers/viewSettings');
const { revokeMemberTokens } = require('../../ApiTokens/memberTokens');
const { endMemberConnections } = require('../../Agents/connectors/memberDeparted');
const logger = require('../../../Config/loggerConfig');
const { releaseMemberSeat } = require('../../Company/helpers/companyCounters');

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

/* The fields of a private view its owner may change one at a time; an unusable value reads as undefined. */
const PRIVATE_VIEW_FIELDS = new Map([
    ['name', (value) => (typeof value === 'string' ? value : undefined)],
    ['title', (value) => cleanViewTitle(value) || undefined],
    ['isPin', (value) => (typeof value === 'boolean' ? value : undefined)],
]);

const holdsSeat = (row) => Boolean(row) && Number(row.status) === ACTIVE && row.isDelete !== true;
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

const cachedMemberRows = (companyId) => {
    const cached = myCache.get(`company_users:${companyId}`);
    return cached ? JSON.parse(cached) : null;
};

exports.getMembers = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const cacheKey = `company_users:${companyId}`;
        const rowView = memberRowFor(await viewerOf(companyId, req.uid));

        const cached = cachedMemberRows(companyId);
        if (cached) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json({ status: true, data: cached.map(rowView) });
        }

        const response = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [] }, 'find');
        myCache.set(cacheKey, JSON.stringify(response), 604800);

        if (response) {
            return res.status(200).json({ status: true, data: response.map(rowView) });
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

exports.getMembersById = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const wanted = memberById(await viewerOf(companyId, req.uid), String(req.params.id || ''));
        const cacheKey = `company_users:${companyId}`;

        const member = (cachedMemberRows(companyId) || []).find(wanted.matches);
        if (member) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(wanted.view(member));
        }
        const response = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [wanted.filter]
        }, 'findOne');
        return res.status(200).json(wanted.view(response));
    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while get the company user",
            error: error.message || error
        });
    }
}

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
        const filter = inUseFilterOf(key, value);
        if (!filter) {
            return res.status(400).json({
                status: false,
                message: 'Only a role or a designation can be checked.'
            });
        }

        const response = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [filter, { _id: 1 }]
        }, 'findOne');

        return res.status(200).json({ isUsed: Boolean(response) });
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
        let options;
        if (operation === 'push') {
            const view = { ...data };
            if (Object.prototype.hasOwnProperty.call(view, 'settings')) view.settings = cleanViewSettings(view.settings);
            if (Object.prototype.hasOwnProperty.call(view, 'title')) view.title = cleanViewTitle(view.title);
            update = {
                $push: { ProjectRequiredComponent: view }
            }
        } else if (operation === 'update') {
            const readValue = PRIVATE_VIEW_FIELDS.get(key);
            if (!readValue) {
                return refuse(res, 400, 'This private view field cannot be changed.');
            }
            if (!data.id) {
                return refuse(res, 400, `Element 'id' parameter is required.`);
            }
            const value = readValue(data[key]);
            if (value === undefined) {
                return refuse(res, 400, `A valid '${key}' is required.`);
            }
            update = {
                $set: { [`ProjectRequiredComponent.$[elem].${key}`]: value }
            }
            options = { arrayFilters: [{ "elem.id": data.id }] };
        } else if (operation === 'settings') {
            if (!data.id) {
                return refuse(res, 400, `Element 'id' parameter is required.`);
            }
            if (!isPlainObject(data.settings)) {
                return refuse(res, 400, 'Settings must be an object.');
            }
            update = {
                $set: { "ProjectRequiredComponent.$[elem].settings": cleanViewSettings(data.settings) }
            }
            options = { arrayFilters: [{ "elem.id": data.id }] };
        } else if (operation === 'delete') {
            update = {
                $pull: { ProjectRequiredComponent: { id: data.id } }
            }
        } else {
            return refuse(res, 400, 'Invalid operation type. Supported operations: push, update, settings, delete');
        }

        const row = await findMemberRow(companyId, id);
        if (!row) {
            return refuse(res, 404, 'That member is not part of this workspace.');
        }
        if (!req.uid || String(row.userId || '') !== String(req.uid)) {
            return refuse(res, 403, 'You can only change your own private views.');
        }
        if (['settings', 'update'].includes(operation) && !(row.ProjectRequiredComponent || []).some((view) => view && String(view.id) === String(data.id))) {
            return refuse(res, 404, 'Private view not found.');
        }

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
            recordPrivateViewChange({ companyId, uid: req.uid, operation, key, data, previous: row })
                .catch((error) => logger.error(`private view history: ${error && error.message}`));
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

/* Only the request that actually flips the row to deleted gives its seat back, so a repeated removal releases nothing. */
const claimSeatRelease = async (companyId, id) => {
    const before = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [
            { _id: new mongoose.Types.ObjectId(id), isDelete: { $ne: true } },
            { $set: { isDelete: true, isTrackerUser: false } },
            { projection: { isTrackerUser: 1 } }
        ]
    }, 'findOneAndUpdate');
    if (!before) return;
    await releaseMemberSeat(companyId, { tracker: before.isTrackerUser === true }).catch((error) => {
        logger.error(`releaseMemberSeat ${companyId}: ${error && error.message ? error.message : error}`);
    });
};

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

        if (data.isDelete === true) await claimSeatRelease(companyId, id);

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
        // A guest is still in the workspace and can still read their own private pages.
        if (data.isDelete === true || Number(data.status) === SEAT_CANCELLED) {
            await revokeMemberTokens(companyId, subject.userId);
            await endMemberConnections(companyId, subject.userId);
            knowledgeEvents.publishMemberDeparted(companyId, subject.userId);
        } else if (holdsSeat(response) && !holdsSeat(subject)) {
            knowledgeEvents.publishMemberActivated(companyId, subject.userId);
        }

        clearMemberCaches(companyId, response.userId);
        if (MEMBERSHIP_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field))) {
            forgetMembership(companyId, subject.userId);
        }
        socketEmitter.emit('update', {
            type: 'update',
            data: { data: memberRowFor(COLLEAGUE)(response) },
            updatedFields: colleagueFieldsOf(data),
            module: 'companyUsers'
        });

        try {
            require('../../Audit/recorder').recordAuditFromReq(req, {
                action: 'member.update', entityType: 'member', entityId: String(id),
                meta: { fields: Object.keys(data) },
            });
        } catch (e) { /* audit is best-effort */ }

        const rowView = memberRowFor(await viewerOf(companyId, req.uid));
        return res.status(200).json({ status: true, statusText: 'Member updated.', data: rowView(response) });
    } catch (error) {
        return res.status(500).json({
            status: false,
            statusText: "An error occurred while update company member user",
            message: error.message || error
        });
    }
}

exports.updateMemberFunction = (companyId, queryObject, method) => {
    return new Promise(async (resolve, reject) => {
        try {

            const query = {
                type: SCHEMA_TYPE.COMPANY_USERS,
                data: queryObject
            }

            const response = await MongoDbCrudOpration(companyId, query, method);

            removeCache(`company_users:${companyId}`);
            if (response && response.userId) removeCache(`UserProjectData:${companyId}:${response.userId}`);
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
        const { id, data, companyId, linkId } = req.body;

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

        const verdict = judgeInvitationAcceptance({ callerId: req.uid, callerEmail: caller && caller.Employee_Email, invite, data, linkId });
        if (!verdict.ok) {
            return refuse(res, verdict.code, verdict.statusText);
        }

        const accepted = { userId: String(req.uid), status: ACTIVE };
        const response = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [
                { _id: new mongoose.Types.ObjectId(id), status: SEAT_PENDING, isDelete: { $ne: true }, linkId: invite.linkId },
                { $set: { ...accepted, linkId: '' } },
                { returnDocument: 'after' }
            ]
        }, 'findOneAndUpdate');
        if (!response) {
            return refuse(res, 403, 'That invitation is no longer valid.');
        }

        clearMemberCaches(companyId, req.uid);
        forgetMembership(companyId, req.uid);
        if (holdsSeat(response) && !holdsSeat(invite)) knowledgeEvents.publishMemberActivated(companyId, req.uid);
        socketEmitter.emit('update', {
            type: 'update',
            data: { data: memberRowFor(COLLEAGUE)(response) },
            updatedFields: accepted,
            module: 'companyUsers'
        });

        const rowView = memberRowFor(await viewerOf(companyId, req.uid));
        return res.status(200).json({ status: true, statusText: 'Invitation accepted.', data: rowView(response) });
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
        const query = countFilterOf((req.body || {}).query);
        if (!query) {
            return refuse(res, 400, 'Members can be counted by role, designation, status or removal only.');
        }

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
