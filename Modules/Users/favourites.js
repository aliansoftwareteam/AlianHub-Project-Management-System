const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { sessionTenantOf } = require("../../Config/tenant");
const { removeCache } = require("../../utils/commonFunctions.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const { MAX_FAVOURITES, sanitizeFavouriteToggle, sanitizeFavouriteOrder, companyFavourites, reorderFavourites } = require("./helpers/favouritesRules.js");
const { resolveFavourites, asUserId } = require("./helpers/favouritesResolve.js");

const refuse = (res, code, message) => res.status(code).json({ status: false, statusText: message, message });

const users = (data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data }, method);
const readOwn = (uid) => users([{ _id: asUserId(uid) }, { favourites: 1 }], "findOne");

/* The caller and the company come from the session and the header, never from the body. */
const callerOf = (req, res) => {
    if (!req.uid) { refuse(res, 401, "Unauthorized"); return null; }
    try {
        return { uid: String(req.uid), companyId: sessionTenantOf(req) };
    } catch (error) {
        refuse(res, error.statusCode || 403, error.message);
        return null;
    }
};

const answer = async (res, caller, user, statusText) => {
    const data = await resolveFavourites(caller.companyId, caller.uid, companyFavourites(user, caller.companyId));
    return res.status(200).json({ status: true, statusText, data });
};

const saved = (uid) => {
    removeCache(`UserData:${uid}`);
    removeCache("UserAllData:", true);
};

exports.listOwnFavourites = async (req, res) => {
    const caller = callerOf(req, res);
    if (!caller) return undefined;
    try {
        const user = await readOwn(caller.uid);
        if (!user) return refuse(res, 404, "User not found");
        return await answer(res, caller, user, "Favourites fetched");
    } catch (error) {
        logger.error(`listOwnFavourites: ${error.message || error}`);
        return refuse(res, 400, "Favourites not fetched");
    }
};

exports.setOwnFavourite = async (req, res) => {
    const caller = callerOf(req, res);
    if (!caller) return undefined;
    const checked = sanitizeFavouriteToggle(req.body);
    if (!checked.ok) return refuse(res, 400, checked.error);

    try {
        const entry = { companyId: caller.companyId, ...checked.entry };
        if (checked.favourite) {
            const user = await readOwn(caller.uid);
            if (!user) return refuse(res, 404, "User not found");
            if (companyFavourites(user, caller.companyId).length >= MAX_FAVOURITES) return refuse(res, 400, `At most ${MAX_FAVOURITES} favourites.`);
            await users([
                { _id: asUserId(caller.uid), $nor: [{ favourites: { $elemMatch: entry } }] },
                { $push: { favourites: { ...entry, addedAt: new Date() } } },
            ], "updateOne");
        } else {
            await users([{ _id: asUserId(caller.uid) }, { $pull: { favourites: entry } }], "updateOne");
        }
        saved(caller.uid);
        return await answer(res, caller, await readOwn(caller.uid), "Favourites saved");
    } catch (error) {
        logger.error(`setOwnFavourite: ${error.message || error}`);
        return refuse(res, 400, "Favourites not saved");
    }
};

exports.reorderOwnFavourites = async (req, res) => {
    const caller = callerOf(req, res);
    if (!caller) return undefined;
    const checked = sanitizeFavouriteOrder(req.body);
    if (!checked.ok) return refuse(res, 400, checked.error);

    try {
        const user = await readOwn(caller.uid);
        if (!user) return refuse(res, 404, "User not found");
        const next = reorderFavourites(JSON.parse(JSON.stringify(user.favourites || [])), caller.companyId, checked.keys)
            .map((entry) => ({ ...entry, addedAt: entry.addedAt ? new Date(entry.addedAt) : new Date() }));
        const updated = await users([{ _id: asUserId(caller.uid) }, { $set: { favourites: next } }, { returnDocument: "after" }], "findOneAndUpdate");
        saved(caller.uid);
        return await answer(res, caller, updated, "Favourites saved");
    } catch (error) {
        logger.error(`reorderOwnFavourites: ${error.message || error}`);
        return refuse(res, 400, "Favourites not saved");
    }
};
