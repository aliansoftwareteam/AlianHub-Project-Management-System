const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { VIA_EXTERNAL } = require('../Agents/actor');
const { pseudonymOf } = require('./redact');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const find = async (database, type, data) => (await MongoDbCrudOpration(String(database), { type, data }, 'find')) || [];

const isOutside = (row) => Boolean(row && row.meta && row.meta.viaAccount === VIA_EXTERNAL && row.meta.clientId);

/* OAuth clients live in the global database, so a client is named only when this workspace holds an approval row for
 * it. A client from a metadata document has no client row, and its approval carries the name. */
const clientNamesIn = async (companyId, clientIds) => {
    const approvals = await find(SCHEMA_TYPE.GOLBAL, SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, [{ companyId, clientId: { $in: clientIds } }, { clientId: 1, clientName: 1 }]);
    const names = new Map(approvals.filter((a) => a.clientName).map((a) => [String(a.clientId), String(a.clientName)]));
    const known = [...new Set(approvals.map((a) => String(a.clientId)))];
    if (!known.length) return names;
    const clients = await find(SCHEMA_TYPE.GOLBAL, SCHEMA_TYPE.OAUTH_CLIENTS, [{ clientId: { $in: known } }, { clientId: 1, name: 1 }]);
    clients.forEach((c) => { if (c.name && known.includes(String(c.clientId))) names.set(String(c.clientId), String(c.name)); });
    return names;
};

/* A person is named only through a seat in this workspace, and never once their audit trail here was erased. */
const personNamesIn = async (companyId, userIds) => {
    const ids = userIds.filter((id) => OBJECT_ID.test(id));
    if (!ids.length) return new Map();
    const [seats, erased] = await Promise.all([
        find(companyId, SCHEMA_TYPE.COMPANY_USERS, [{ userId: { $in: ids } }, { userId: 1 }]),
        find(companyId, SCHEMA_TYPE.AUDIT_REDACTIONS, [{ _id: { $in: ids.map(pseudonymOf) } }, { _id: 1 }]),
    ]);
    const erasedIds = new Set(erased.map((r) => String(r._id)));
    const members = [...new Set(seats.map((s) => String(s.userId)))].filter((id) => ids.includes(id) && !erasedIds.has(pseudonymOf(id)));
    if (!members.length) return new Map();
    const users = await find(SCHEMA_TYPE.GOLBAL, SCHEMA_TYPE.USERS, [{ _id: { $in: members.map((id) => new mongoose.Types.ObjectId(id)) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 }]);
    return new Map(users.map((u) => [String(u._id), u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ') || null]).filter(([, name]) => name));
};

/* Adds `outsideAgent` to each row an outside client wrote; names that cannot be resolved in this workspace stay null. */
const nameRows = async (companyId, rows) => {
    const outside = rows.filter(isOutside);
    if (!outside.length) return rows;
    const company = String(companyId);
    const clientIds = [...new Set(outside.map((r) => String(r.meta.clientId)))];
    const personIds = [...new Set(outside.map((r) => String(r.meta.delegatedBy || '')).filter(Boolean))];
    let clients = new Map();
    let people = new Map();
    try {
        [clients, people] = await Promise.all([clientNamesIn(company, clientIds), personNamesIn(company, personIds)]);
    } catch (error) {
        logger.error(`audit outside actors ${company}: ${error.message}`);
    }
    return rows.map((row) => {
        if (!isOutside(row)) return row;
        const clientId = String(row.meta.clientId);
        const delegatedBy = String(row.meta.delegatedBy || '');
        return { ...row, outsideAgent: { clientId, clientName: clients.get(clientId) || null, delegatedBy, delegatedByName: people.get(delegatedBy) || null } };
    });
};

const csvLabel = ({ clientName, delegatedByName }) => `${clientName ? `${clientName} (outside agent)` : 'An outside agent'} for ${delegatedByName || 'a member'}`;

module.exports = { isOutside, nameRows, csvLabel };
