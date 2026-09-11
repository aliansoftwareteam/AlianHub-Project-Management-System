const mongoose = require("mongoose");
const { removeCache } = require("../../../utils/commonFunctions");
const { dbCollections } = require("../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { getRoleType } = require("../../../Config/permissionGuard");
const { ensureNotificationDefaults } = require("../../notification/defaults");
const alertRules = require("../../Agents/alertRules");

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

/* The caller's own settings document, with AI alert choices resolved against their role's defaults. */
exports.getPreferences = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId || !req.uid) return res.status(400).json({ status: false, message: "Company ID and a signed-in user are required." });
        const doc = await ensureNotificationDefaults(companyId, req.uid);
        const plain = doc && typeof doc.toObject === "function" ? doc.toObject() : { ...(doc || {}) };
        const roleType = await getRoleType(companyId, req.uid);
        return res.status(200).json({
            status: true,
            data: { ...plain, aiAlerts: alertRules.preferencesOf(roleType, plain.aiAlerts), aiAlertsEligible: alertRules.isEligibleRole(roleType) }
        });
    } catch (error) {
        return res.status(500).json({ status: false, message: error.message || error });
    }
};

// Top-level per-user switches (quiet hours, agent noise, digest, AI alerts) sit beside the
// per-event grid; they are written by the owner of the document only.
exports.updatePreferences = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { id, quietHours, agentActivity, dailyDigest, aiAlerts } = req.body || {};
        if (!companyId || !id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ status: false, message: "Company ID and a valid settings id are required." });
        }
        const $set = {};
        if (aiAlerts !== undefined) {
            if (!alertRules.isEligibleRole(await getRoleType(companyId, req.uid))) {
                return res.status(403).json({ status: false, message: "AI alerts are for owners and admins only." });
            }
            const checked = alertRules.validatePreferences(aiAlerts);
            if (checked.error) return res.status(400).json({ status: false, message: checked.error });
            Object.assign($set, checked.set);
        }
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
