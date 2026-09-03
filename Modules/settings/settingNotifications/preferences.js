const mongoose = require("mongoose");
const { removeCache } = require("../../../utils/commonFunctions");
const { dbCollections } = require("../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const cleanQuietHours = (q) => {
    if (!q || typeof q !== "object") return undefined;
    return {
        enabled: q.enabled === true,
        start: TIME_RE.test(q.start) ? q.start : "19:00",
        end: TIME_RE.test(q.end) ? q.end : "09:00",
        respectTimeOff: q.respectTimeOff !== false
    };
};

// Top-level per-user switches (quiet hours, agent noise, digest) sit beside the
// per-event grid; they are written by the owner of the document only.
exports.updatePreferences = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { id, quietHours, agentActivity, dailyDigest } = req.body || {};
        if (!companyId || !id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: "Company ID and a valid settings id are required." });
        }
        const $set = {};
        const qh = cleanQuietHours(quietHours);
        if (qh) $set.quietHours = qh;
        if (typeof agentActivity === "boolean") $set.agentActivity = agentActivity;
        if (typeof dailyDigest === "boolean") $set.dailyDigest = dailyDigest;
        if (!Object.keys($set).length) return res.status(400).json({ status: false, message: "Nothing to update." });

        const updated = await MongoDbCrudOpration(companyId, {
            type: dbCollections.NOTIFICATIONS_SETTINGS,
            data: [
                { _id: new mongoose.Types.ObjectId(id), userId: String(req.uid) },
                { $set },
                { returnDocument: "after" }
            ]
        }, "findOneAndUpdate");
        if (!updated) return res.status(404).json({ status: false, message: "Notification settings not found." });
        removeCache(`notification:${req.uid}:${companyId}`);
        return res.status(200).json({ status: true, statusText: "Notification preferences updated", data: updated });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message || error });
    }
};
