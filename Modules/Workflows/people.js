const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

// An approval names people by id, and a person reading their inbox needs a name.
// Users live in the global database rather than the company one, so this is the
// one lookup the workflow module makes outside its own tenant.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const nameOf = (user) => user.Employee_Name || [user.Employee_FName, user.Employee_LName].filter(Boolean).join(' ') || null;

const namesOf = async (ids = []) => {
    const unique = [...new Set(ids.filter(Boolean).map(String))].filter((id) => OBJECT_ID.test(id));
    if (!unique.length) return {};
    const users = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: { $in: unique.map((id) => new mongoose.Types.ObjectId(id)) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 }],
    }, 'find').catch(() => []);
    return Object.fromEntries((users || []).map((user) => [String(user._id), nameOf(user)]));
};

module.exports = { namesOf };
