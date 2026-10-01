const { actingUser } = require('../../Sprints/helpers/actingUser');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { trackshotKey } = require('../../../common-storage/taskFileKeys');
const { storedFileExists } = require(`../../../common-storage/common-${process.env.STORAGE_TYPE}.js`);

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const NOT_YOUR_TIME = 'You can only track your own time.';
const NOT_THIS_TIMER = 'A capture is stored with the running timer it belongs to.';
const ALREADY_STORED = 'A capture is already stored under this name.';

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

const isRunning = (session) => session.startTimeTracker !== undefined && session.startTimeTracker !== null;

/* The tracker names where its capture goes. Only the folder of the caller's own running timer is
 * taken, and never a name a capture is already stored under. */
async function capturePathRefusal(companyId, timeSheetId, session, filePath) {
    const named = trackshotKey(filePath);
    const ownFolder = Boolean(named)
        && named.timeSheetId === timeSheetId.toLowerCase()
        && named.projectId === String(session.ProjectId || '').toLowerCase();
    if (!ownFolder || !isRunning(session)) return { code: 403, statusText: NOT_THIS_TIMER };
    return (await storedFileExists(companyId, filePath)) ? { code: 409, statusText: ALREADY_STORED } : null;
}

/* Returns a refusal in the { code, statusText } shape the upload guards use, so it can run
 * before multer stores the capture. It runs again once the form is parsed, when the capture is
 * already on disk, so an accepted capture keeps its answer on the request. */
async function ownSessionRefusal(req, companyId) {
    const uid = String(req.uid || '');
    if (!OBJECT_ID.test(uid)) return { code: 401, statusText: 'A signed-in user is required.' };
    const timeSheetId = String((req.body && req.body.timeSheetId) || '');
    if (!OBJECT_ID.test(timeSheetId)) return { code: 403, statusText: NOT_YOUR_TIME };
    // The capture handlers write to the collection the request names; the tracker only ever names this one.
    if (req.body.type && req.body.type !== SCHEMA_TYPE.TIMESHEET) return { code: 403, statusText: NOT_YOUR_TIME };
    const filePath = req.body.path;
    const accepted = req.acceptedCapture;
    if (accepted && accepted.timeSheetId === timeSheetId && accepted.filePath === filePath) return null;
    const session = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [{ _id: timeSheetId }, { Loggeduser: 1, ProjectId: 1, startTimeTracker: 1 }],
    }, 'findOne');
    if (!session || String(session.Loggeduser) !== uid) return { code: 403, statusText: NOT_YOUR_TIME };
    const refusal = await capturePathRefusal(companyId, timeSheetId, session, filePath);
    if (!refusal) req.acceptedCapture = { timeSheetId, filePath };
    return refusal;
}

module.exports = { trackerUser, ownSessionRefusal, refuse };
