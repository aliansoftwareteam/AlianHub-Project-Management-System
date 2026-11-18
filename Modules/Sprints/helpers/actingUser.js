const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

/* Who is doing this, taken from the session rather than the request body.

   Two reasons it is not `req.body.userData`. It is forgeable, so history would
   be attributable to anyone. And HandleHistory writes `UserId: userData.id`
   into a schema where that field is REQUIRED — an absent id makes it reject,
   and moveTaskFunction fires one of those without a .catch, so an empty
   userData does not merely lose a history line, it takes the server down.

   Users live in the global database, not the company one. */
async function actingUser(req) {
    const uid = String((req && req.uid) || '');
    if (!/^[0-9a-fA-F]{24}$/.test(uid)) return null;

    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: new mongoose.Types.ObjectId(uid) }, { Employee_Name: 1, Employee_Email: 1 }],
    }, 'findOne').catch(() => null);

    return {
        id: uid,
        Employee_Name: (user && (user.Employee_Name || user.Employee_Email)) || 'Someone',
    };
}

/* The name is stored raw; the history and notification builders escape it where they render it. */
const withActingUser = async (req, res, next) => {
    const actor = await actingUser(req).catch(() => null);
    if (!actor) return res.status(401).json({ status: false, statusText: 'A signed-in user is required.', message: 'A signed-in user is required.' });
    if (!req.body || typeof req.body !== 'object') req.body = {};
    req.body.userData = actor;
    return next();
};

module.exports = { actingUser, withActingUser };
