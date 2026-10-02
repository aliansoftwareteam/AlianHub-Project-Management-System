const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const mcpOAuth = require('../../Config/mcpOAuth');
const { isExpired } = require('../ApiTokens/helpers/apiTokenRules');
const grantStore = require('../OAuthServer/store');
const { clientNames } = require('../OAuthServer/personalGrants');
const { toolNameOf, byline, VIA_EXTERNAL, VIA_PERSONAL } = require('./actingAgent');

// A person's connected AI as the people beside them meet it: "Claude, for Priya". It is read from the person's
// live seat and their used connections on every call and stored nowhere, so it holds no seat, no role and no
// id of its own, and it is gone the moment the seat or the connection is.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const QUEUE_SCOPE = 'tasks:read';
const TOKEN_MODES = Object.freeze(['workspace', 'personal', 'local']);
const TOKEN_FIELDS = Object.freeze({ userId: 1, name: 1, active: 1, expiresAt: 1, lastUsedAt: 1, agentAccount: 1, projectIds: 1, createdAt: 1 });

const isId = (value) => OBJECT_ID.test(String(value || ''));
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const find = async (companyId, type, data) => ((await MongoDbCrudOpration(companyId, { type, data }, 'find')) || []).map(plain);
const isOutside = (roleType) => roleType === null || roleType === undefined || roleType === ROLE_GUEST;

/* Guests are outside the company: they are shown no colleague's AI, and their own is not shown either. */
const seatedIds = async (companyId, userIds) => (await find(companyId, SCHEMA_TYPE.COMPANY_USERS, [
    { ...ACTIVE_SEAT, ...(userIds ? { userId: { $in: userIds } } : {}) }, { userId: 1, roleType: 1 },
])).filter((seat) => seat.userId && !isOutside(seat.roleType)).map((seat) => String(seat.userId));

const tokenName = (token) => {
    const account = token.agentAccount || {};
    return toolNameOf({ viaAccount: TOKEN_MODES.includes(account.mode) ? account.mode : VIA_PERSONAL, provider: account.provider, agentName: token.name });
};

const throughTokens = async (companyId, ownerIds, now) => {
    if (mcpOAuth.mode() === mcpOAuth.MODE.ONLY) return [];
    const rows = await find(companyId, SCHEMA_TYPE.API_TOKENS, [{ kind: 'agent', userId: { $in: ownerIds } }, TOKEN_FIELDS]);
    return rows.filter((row) => row.active !== false && row.lastUsedAt && !isExpired(row, now)).map((row) => {
        const kept = (row.projectIds || []).map(String);
        return { ownerId: String(row.userId), name: tokenName(row), lastUsedAt: new Date(row.lastUsedAt), madeAt: row.createdAt, reaches: (projectId) => !kept.length || kept.includes(String(projectId)) };
    });
};

const throughApps = async (companyId, ownerIds, now) => {
    if (!mcpOAuth.isOn()) return [];
    const rows = (await grantStore.grants.usedIn(companyId, now)).filter((row) => row.lastUsedAt && ownerIds.includes(String(row.userId)));
    if (!rows.length) return [];
    const nameOf = await clientNames(rows);
    return rows.map((row) => ({
        ownerId: String(row.userId), name: toolNameOf({ viaAccount: VIA_EXTERNAL, agentName: nameOf(row) }), lastUsedAt: new Date(row.lastUsedAt), madeAt: row.createdAt,
        reaches: () => (row.scopes || []).includes(QUEUE_SCOPE),
    }));
};

const namesOf = async (userIds) => {
    const rows = await find(dbCollections.GLOBAL, SCHEMA_TYPE.USERS, [{ _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } }, { Employee_Name: 1 }]);
    return new Map(rows.map((row) => [String(row._id), row.Employee_Name || '']));
};

const wasThereAt = (connection, since) => !since || !connection.madeAt || new Date(connection.madeAt).getTime() <= new Date(since).getTime();

/* One entry a person, named after the connection that worked last. */
const entriesOf = async (companyId, ownerIds, now) => {
    const owners = ownerIds.filter(isId);
    if (!owners.length) return [];
    const connections = (await Promise.all([throughTokens(companyId, owners, now), throughApps(companyId, owners, now)])).flat();
    const byOwner = new Map();
    connections.forEach((connection) => byOwner.set(connection.ownerId, [...(byOwner.get(connection.ownerId) || []), connection]));
    if (!byOwner.size) return [];
    const names = await namesOf([...byOwner.keys()]);
    return [...byOwner.entries()].map(([ownerId, own]) => {
        const [latest] = own.sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
        const ownerName = names.get(ownerId) || '';
        return {
            entry: { ownerId, name: latest.name, ownerName, shownAs: byline(latest.name, ownerName || 'Member'), lastWorkedAt: latest.lastUsedAt },
            reaches: (projectId, since) => own.some((connection) => (!projectId || connection.reaches(projectId)) && wasThereAt(connection, since)),
        };
    });
};

const byOwnerName = (a, b) => a.ownerName.localeCompare(b.ownerName) || a.ownerId.localeCompare(b.ownerId);

/* Every connected AI of a person the viewer already sees as a member; none for a guest or for someone with no seat. */
const listFor = async (companyId, viewerId, now = new Date()) => {
    if (!isId(viewerId) || isOutside(await getRoleType(companyId, viewerId))) return [];
    const entries = await entriesOf(companyId, await seatedIds(companyId), now);
    return entries.map(({ entry }) => ({ ...entry, mine: entry.ownerId === String(viewerId) })).sort(byOwnerName);
};

/* A person's own entry, and with a project only while one of their connections can read tasks in it. `since` asks for
 * a connection that was already there at that time: one made later was never handed what waited before it. */
const ownFor = async (companyId, uid, projectId, now = new Date(), { since = null } = {}) => {
    if (!isId(uid) || !(await seatedIds(companyId, [String(uid)])).length) return null;
    const [own] = await entriesOf(companyId, [String(uid)], now);
    return own && own.reaches(projectId, since) ? { ...own.entry, mine: true } : null;
};

module.exports = { listFor, ownFor };
