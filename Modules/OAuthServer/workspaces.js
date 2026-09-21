const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const db = (type, data, method) => {
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type, data }, method);
};

const objectIds = (ids) => ids.filter((id) => OBJECT_ID.test(String(id))).map((id) => new mongoose.Types.ObjectId(String(id)));

// A live seat: a pending invitee or a removed member keeps a row but is not a member.
const isMember = async (uid, companyId) => {
    if (!OBJECT_ID.test(String(uid || '')) || !OBJECT_ID.test(String(companyId || ''))) return false;
    const { getRoleType } = require('../../Config/permissionGuard');
    const role = await getRoleType(String(companyId), String(uid));
    return role !== null && role !== undefined;
};

const namesOf = async (companyIds) => {
    const ids = objectIds([...new Set(companyIds.map(String))]);
    if (!ids.length) return new Map();
    const rows = await db(SCHEMA_TYPE.COMPANIES, [{ _id: { $in: ids } }, { Cst_CompanyName: 1 }], 'find') || [];
    return new Map(rows.map((row) => [String(row._id), row.Cst_CompanyName || '']));
};

const peopleNamesOf = async (userIds) => {
    const ids = objectIds([...new Set(userIds.filter(Boolean).map(String))]);
    if (!ids.length) return new Map();
    const rows = await db(SCHEMA_TYPE.USERS, [{ _id: { $in: ids } }, { Employee_Name: 1, Employee_Email: 1 }], 'find') || [];
    return new Map(rows.map((row) => [String(row._id), row.Employee_Name || row.Employee_Email || '']));
};

/* The workspaces a person belongs to, in the order the account lists them. */
async function workspacesOf(uid) {
    if (!OBJECT_ID.test(String(uid || ''))) return [];
    const user = await db(SCHEMA_TYPE.USERS, [{ _id: new mongoose.Types.ObjectId(String(uid)) }, { AssignCompany: 1 }], 'findOne');
    const listed = [...new Set(((user && user.AssignCompany) || []).map(String).filter((id) => OBJECT_ID.test(id)))];
    const seats = await Promise.all(listed.map((id) => isMember(uid, id)));
    const live = listed.filter((id, i) => seats[i]);
    const names = await namesOf(live);
    return live.map((id) => ({ id, name: names.get(id) || '' }));
}

module.exports = { OBJECT_ID, isMember, namesOf, peopleNamesOf, workspacesOf };
