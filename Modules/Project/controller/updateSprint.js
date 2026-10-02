const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration,validateObjectId } = require("../../../utils/mongo-handler/mongoQueries");
const { recordSprintFavourite } = require("../../Sprints/helpers/sprintHistory");
const logger = require("../../../Config/loggerConfig");

const FAVOURITE_OPERATORS = ['$addToSet', '$pull'];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (object, key) => isPlainObject(object) && Object.keys(object).length === 1 && key in object;

/* The sprint list's star is the one client of this route: it adds or removes the caller's own entry. */
const ownFavourite = ({ key, updateObject } = {}, uid) => {
    if (!FAVOURITE_OPERATORS.includes(key) || !hasOnly(updateObject, 'favouriteTasks')) return null;
    const entry = updateObject.favouriteTasks;
    if (!hasOnly(entry, 'userId') || String(entry.userId) !== String(uid)) return null;
    return { key, entry: { userId: String(uid) } };
};

/* A pipeline rather than $addToSet: older sprints store favouriteTasks as something other than an array. */
const addFavourite = (entry) => [
    { $set: { favouriteTasks: { $cond: { if: { $isArray: '$favouriteTasks' }, then: { $concatArrays: ['$favouriteTasks', [entry]] }, else: [entry] } } } },
    { $set: { favouriteTasks: { $setUnion: ['$favouriteTasks'] } } },
];

exports.updateSprint = async(req,res) => {
    try {
        const sprintId = req.params.id;

        if (!validateObjectId(sprintId)) {
            return res.status(400).json({ message: "Invalid list ID" });
        }

        const favourite = ownFavourite(req.body, req.uid);
        if (!favourite) {
            return res.status(400).json({ status: false, message: 'Only your own favourite can be added or removed here.' });
        }

        const { key, entry } = favourite;
        const updateObject = { favouriteTasks: entry };
        const companyId = req.headers['companyid'];
        const previous = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: sprintId }] }, 'findOne').catch(() => null);
        const sprint = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [{ _id: sprintId }, key === '$addToSet' ? addFavourite(entry) : { $pull: updateObject }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');

        if (!sprint) {
            return res.status(400).json({ message: "The list was not updated" });
        }

        recordSprintFavourite({ companyId, previous, updateObject, key, actorId: req.uid })
            .catch((error) => logger.error(`sprint favourite history failed: ${(error && error.message) || error}`));
        return res.status(200).json(sprint);
    } catch (error) {
        return res.status(500).json({ message: "An error occurred while updating the list",error:error });
    }
}
