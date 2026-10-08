const mongoose = require("mongoose")
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { removeCache } = require('../../../utils/commonFunctions');
const logger = require('../../../Config/loggerConfig');
const { recordTagDefinitionChange } = require('../helpers/projectItemHistory');
const { isItemId, badRequest } = require('../../Company/helpers/callerQueryRules');
const { escapeRegex } = require('../../../utils/escapeRegex');

const TAG_KEYS = ['tagName', 'tagColor'];

/* A tag write names its tag by id and sets text: neither reaches the update as an operator object. */
const tagRefusal = ({ items, operation, key }) => {
    if (operation !== 'update' && operation !== 'delete') return null;
    if (!items || !isItemId(items.id)) return `Item 'id' parameter is required.`;
    if (operation === 'update' && TAG_KEYS.includes(key) && typeof items[key] !== 'string') return `Item '${key}' must be text.`;
    return null;
};

/**
 * Helper function for build update query object based on the specific key
 * @param {*} key 
 * @param {*} item 
 * @returns 
 */
const buildQuery = (key, item) => {
    switch (key) {
        case 'tagName':
            return { $set: { "tagsArray.$[elem].tagName": item.tagName } }
        case 'tagColor':
            return {
                $set: {
                    "tagsArray.$[elem].tagColor": item.tagColor,
                    "tagsArray.$[elem].tagBgColor": item.tagColor+'35'
                }
            };
        default:
            return {};
    }
}

/**
 * This endpoint is used for handle all the CRUD operations for the project tags
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.handleTags = async (req, res) => {
    try {
        const { id, items, operation, key } = req.body;

        const refusal = tagRefusal(req.body);
        if (refusal) return badRequest(res, refusal);

        let update = {};
        if (operation === 'push') {
            update = {
                $push: { tagsArray: items }
            };
        } else if (operation === 'update') {
            update = buildQuery(key, items)
        } else if (operation === 'delete') {
            update = {
                $pull: { tagsArray: { uid: items.id } }
            };
        } else {
            return res.status(400).json({
                status: false,
                message: 'Invalid operation type. Supported operations: push, update, delete'
            });
        }

        const options = (operation === 'update') ? { arrayFilters: [{ "elem.uid": items.id }] } : undefined;
        const pushedName = operation === 'push' && items && typeof items.tagName === 'string' ? items.tagName.trim() : '';
        // Two pushes of one name at once would both pass a read-then-write check, so the write itself requires the name to be free.
        const nameFree = pushedName ? { $nor: [{ tagsArray: { $elemMatch: { tagName: { $regex: `^\\s*${escapeRegex(pushedName)}\\s*$`, $options: 'i' } } } }] } : {};

        const params = {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id),
                    ...nameFree
                },
                update,
                options
            ]
        }

        const companyId = req.headers['companyid'];
        const previous = await MongoDbCrudOpration(companyId, params, 'findOneAndUpdate');
        if (!previous && pushedName) {
            const project = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: new mongoose.Types.ObjectId(id) }, { _id: 1 }] }, 'findOne');
            if (project) return res.status(409).json({ status: false, statusText: 'This tag has already been added.', message: 'This tag has already been added.' });
        }

        removeCache('UserProjectData:', true);

        if (previous) {
            recordTagDefinitionChange({ companyId, projectId: id, actorId: req.uid, previous, body: req.body })
                .catch((error) => logger.error(`project tags history: ${error && error.message}`));
            return res.status(200).json({ status: true });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update the project tags",
            error: error
        });
    }
}