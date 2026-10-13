const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { removeCache } = require("../../utils/commonFunctions.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const { sanitizeOnboardingPatch } = require("./helpers/onboardingRules.js");

const refuse = (res, code, message) => res.status(code).json({ status: false, statusText: message, message });

exports.updateOwnOnboarding = async (req, res) => {
    if (!req.uid) return refuse(res, 401, "Unauthorized");
    const checked = sanitizeOnboardingPatch(req.body);
    if (!checked.ok) return refuse(res, 400, checked.error);

    try {
        const updated = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(String(req.uid)) }, checked.update, { returnDocument: "after" }]
        }, "findOneAndUpdate");
        if (!updated) return refuse(res, 404, "User not found");
        removeCache(`UserData:${req.uid}`);
        removeCache("UserAllData:", true);
        const saved = JSON.parse(JSON.stringify(updated.homeChecklist || {}));
        return res.status(200).json({ status: true, statusText: "Onboarding saved", data: saved });
    } catch (error) {
        logger.error(`updateOwnOnboarding: ${error.message || error}`);
        return refuse(res, 400, "Onboarding not saved");
    }
};
