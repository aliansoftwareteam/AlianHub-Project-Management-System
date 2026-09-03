const mongoose = require("mongoose");
const { dbCollections } = require("../../Config/collections.js");
const logger = require("../../Config/loggerConfig");
const { removeCache } = require("../../utils/commonFunctions.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");

const TOKEN_TAIL = 6;

// The refresh token is the session identity; only its tail leaves the server so the
// client can recognise its own device without ever seeing another session's token.
const label = (v) => (v && typeof v === "object" ? v.name || v.type || "" : v || "");

const toPublicSession = (s) => ({
    _id: s._id,
    ip: s.ip || "",
    browser: label(s.info?.browser),
    os: label(s.info?.os),
    device: label(s.info?.device),
    lastActive: s.lastActive || s.updatedAt || s.createdAt,
    createdAt: s.createdAt,
    tokenTail: String(s.refreshToken || "").slice(-TOKEN_TAIL)
});

exports.listOwnSessions = async (req, res) => {
    try {
        if (!req.uid) return res.status(401).json({ status: false, message: "Unauthorized" });
        const sessions = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.SESSIONS,
            data: [{ userId: String(req.uid) }]
        }, "find");
        const list = (sessions || [])
            .map(toPublicSession)
            .sort((a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0));
        return res.status(200).json({ status: true, statusText: "OK", data: list });
    } catch (error) {
        logger.error(`listOwnSessions: ${error.message || error}`);
        return res.status(400).json({ status: false, message: error.message || "Failed to list sessions" });
    }
};

exports.deleteOwnSession = async (req, res) => {
    try {
        if (!req.uid) return res.status(401).json({ status: false, message: "Unauthorized" });
        const id = req.params.sessionId;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ status: false, message: "Session id is invalid" });
        const result = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.SESSIONS,
            data: [{ _id: new mongoose.Types.ObjectId(id), userId: String(req.uid) }]
        }, "deleteMany");
        if (!result?.deletedCount) return res.status(404).json({ status: false, message: "Session not found" });
        removeCache(`session:${req.uid}`, true);
        return res.status(200).json({ status: true, statusText: "Signed out of that device", data: { _id: id } });
    } catch (error) {
        logger.error(`deleteOwnSession: ${error.message || error}`);
        return res.status(400).json({ status: false, message: error.message || "Failed to sign out session" });
    }
};
