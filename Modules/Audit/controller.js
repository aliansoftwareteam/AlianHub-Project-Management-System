const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { getRoleType, isPrivileged } = require("../../Config/permissionGuard");
const logger = require("../../Config/loggerConfig");

const companyOf = (req) => req.headers['companyid'] || (req.query && req.query.companyId);

// GET /api/v1/audit-logs?actorId=&entityType=&entityId=&action=&from=&to=&page=&limit=
// Owner/admin only. Filterable + paginated, newest first.
exports.listAuditLogs = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        if (!isPrivileged(roleType)) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });

        const q = req.query || {};
        const page = Math.max(1, Number(q.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
        const match = {};
        if (q.actorId) match.actorId = String(q.actorId);
        if (q.entityType) match.entityType = String(q.entityType);
        if (q.entityId) match.entityId = String(q.entityId);
        if (q.action) match.action = String(q.action);
        if (q.from || q.to) {
            match.createdAt = {};
            if (q.from) match.createdAt.$gte = new Date(q.from);
            if (q.to) match.createdAt.$lte = new Date(q.to);
        }
        const pipeline = [
            { $match: match },
            { $sort: { createdAt: -1, _id: -1 } },
            { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit }], meta: [{ $count: 'total' }] } },
        ];
        const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [pipeline] }, 'aggregate');
        const data = (rows && rows[0] && rows[0].data) || [];
        const total = (rows && rows[0] && rows[0].meta && rows[0].meta[0] && rows[0].meta[0].total) || 0;
        return res.send({ status: true, data, metadata: { total, page, totalPages: Math.ceil(total / limit) } });
    } catch (error) {
        logger.error(`listAuditLogs: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
