const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { version: appVersion } = require("../../package.json");

// Instance-admin endpoints for self-hosted operators. Guarded by a static
// key the operator sets in the environment (INSTANCE_ADMIN_KEY) and sends
// as the `adminkey` header — endpoints are disabled entirely when the env
// var is unset, so default installs expose nothing new.

const guard = (req, res) => {
    const configured = process.env.INSTANCE_ADMIN_KEY || '';
    if (!configured) {
        res.status(403).send({ status: false, statusText: 'Instance admin is disabled. Set INSTANCE_ADMIN_KEY to enable.' });
        return false;
    }
    if (String(req.headers['adminkey'] || '') !== configured) {
        res.status(401).send({ status: false, statusText: 'Invalid admin key.' });
        return false;
    }
    return true;
};

/* GET /api/v2/instance/stats */
exports.getInstanceStats = async (req, res) => {
    if (!guard(req, res)) return;
    try {
        const [companies, users] = await Promise.all([
            MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}] }, 'countDocuments'),
            MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{}] }, 'countDocuments'),
        ]);
        return res.send({
            status: true,
            statusText: 'Instance stats.',
            data: {
                version: appVersion,
                nodeVersion: process.version,
                uptimeSeconds: Math.round(process.uptime()),
                companies: companies || 0,
                users: users || 0,
            },
        });
    } catch (error) {
        logger.error(`ERROR in instance stats: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/instance/companies */
exports.listInstanceCompanies = async (req, res) => {
    if (!guard(req, res)) return;
    try {
        const companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{}, 'Cst_CompanyName createdAt', { sort: { createdAt: -1 }, limit: 500 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Companies fetched.', data: companies || [] });
    } catch (error) {
        logger.error(`ERROR in instance companies: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

const csvCell = (value) => {
    const text = String(value === null || value === undefined ? '' : value).replace(/<[^>]+>/g, '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/* GET /api/v2/instance/audit-export?companyId=&from=&to= — streams the
 * activity history of one tenant as CSV (admin-key guarded). */
exports.exportAuditLog = async (req, res) => {
    if (!guard(req, res)) return;
    try {
        const companyId = String(req.query?.companyId || req.headers['companyid'] || '');
        if (!companyId) {
            return res.status(400).send({ status: false, statusText: 'companyId is required.' });
        }
        const filter = {};
        const from = req.query?.from ? new Date(req.query.from) : null;
        const to = req.query?.to ? new Date(req.query.to) : null;
        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
            return res.status(400).send({ status: false, statusText: 'from/to must be valid dates.' });
        }
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = from;
            if (to) filter.createdAt.$lte = to;
        }

        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.HISTORY,
            data: [filter, 'Type Key UserId ProjectId TaskId Message createdAt', { sort: { createdAt: -1 }, limit: 50000 }],
        }, 'find');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-${companyId}.csv"`);
        const lines = ['CreatedAt,Type,Key,UserId,ProjectId,TaskId,Message'];
        (rows || []).forEach((row) => {
            lines.push([
                row.createdAt ? new Date(row.createdAt).toISOString() : '',
                row.Type, row.Key, row.UserId, row.ProjectId, row.TaskId, row.Message,
            ].map(csvCell).join(','));
        });
        return res.send('﻿' + lines.join('\r\n'));
    } catch (error) {
        logger.error(`ERROR in audit export: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};
