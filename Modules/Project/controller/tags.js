const mongoose = require("mongoose")
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { removeCache } = require('../../../utils/commonFunctions');
const logger = require('../../../Config/loggerConfig');
const { recordTagDefinitionChange } = require('../helpers/projectItemHistory');

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

        let update = {};
        if (operation === 'push') {
            update = {
                $push: { tagsArray: items }
            };
        } else if (operation === 'update') {
            if(!items.id) {
                return res.status(400).json({
                    status: false,
                    message: `Item 'id' parameter is required.`
                });
            }
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

        const params = {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                },
                update,
                options
            ]
        }

        const companyId = req.headers['companyid'];
        const previous = await MongoDbCrudOpration(companyId, params, 'findOneAndUpdate');

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