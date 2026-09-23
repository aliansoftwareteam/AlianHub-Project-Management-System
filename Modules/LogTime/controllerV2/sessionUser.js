const { actingUser } = require('../../Sprints/helpers/actingUser');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const NOT_YOUR_TIME = 'You can only track your own time.';

const refuse = (res, status, statusText) => {
    res.status(status).send({ status: false, statusText, message: statusText });
    return null;
};

/* The desktop tracker only ever acts for the person signed in, so a body naming anyone else is
 * refused rather than quietly swapped for the session user. */
async function trackerUser(req, res) {
    const actor = await actingUser(req);
    if (!actor) return refuse(res, 401, 'A signed-in user is required.');
    const claimed = [].concat((req.body && req.body.userId) || []).map(String).filter(Boolean);
    if (claimed.some((id) => id !== actor.id)) return refuse(res, 403, NOT_YOUR_TIME);
    return actor;
}

/* Returns a refusal in the { code, statusText } shape the upload guards use, so it can run
 * before multer stores the capture. */
async function ownSessionRefusal(req, companyId) {
    const uid = String(req.uid || '');
    if (!OBJECT_ID.test(uid)) return { code: 401, statusText: 'A signed-in user is required.' };
    const timeSheetId = String((req.body && req.body.timeSheetId) || '');
    if (!OBJECT_ID.test(timeSheetId)) return { code: 403, statusText: NOT_YOUR_TIME };
    const session = await MongoDbCrudOpration(companyId, {
        type: req.body.type || SCHEMA_TYPE.TIMESHEET,
        data: [{ _id: timeSheetId }, { Loggeduser: 1 }],
    }, 'findOne');
    return session && String(session.Loggeduser) === uid ? null : { code: 403, statusText: NOT_YOUR_TIME };
}

module.exports = { trackerUser, ownSessionRefusal, refuse };
