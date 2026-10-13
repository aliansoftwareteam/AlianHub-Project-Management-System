const mongoose = require("mongoose")
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { removeCache } = require('../../../utils/commonFunctions');
const logger = require('../../../Config/loggerConfig');
const { recordChecklistChange } = require('../helpers/projectItemHistory');
const { isItemId, badRequest } = require('../../Company/helpers/callerQueryRules');
const { namedIds } = require('../../../Config/companyMembers');
const { namedPeopleRefusal } = require('../../../Config/projectPeople');

const ITEM_KEYS = ['name', 'assigneeAdd', 'assigneeRemove'];
const ITEM_VALUE_OF_KEY = { name: 'name', assigneeAdd: 'uid', assigneeRemove: 'uid' };

/* A checklist write names its rows by id and sets text: none of these reaches the update as an operator object. */
const checklistRefusal = ({ checklistItem, operation, key }) => {
    if (operation === 'delete') {
        return Array.isArray(checklistItem) && checklistItem.every(isItemId) ? null : `Checklist item ids must be a list of ids.`;
    }
    if (operation !== 'update') return null;
    if (key === 'isChecked') return Array.isArray(checklistItem) ? null : 'The checklist must be a list of items.';
    if (!ITEM_KEYS.includes(key)) return null;
    if (!checklistItem || !isItemId(checklistItem.id)) return `Checklist item 'id' parameter is required.`;
    return typeof checklistItem[ITEM_VALUE_OF_KEY[key]] === 'string' ? null : `Checklist item '${ITEM_VALUE_OF_KEY[key]}' must be text.`;
};

const peopleOn = (items) => (Array.isArray(items) ? items : [items])
    .flatMap((item) => (item && typeof item === 'object' ? namedIds(item.AssigneeUserId || []) : []));

/* The people a checklist write puts on a row. Someone a row already names stays, so a row can still be ticked
 * after its person has left. */
const peopleAdded = async (companyId, { id, checklistItem, operation, key }) => {
    if (operation === 'push') return peopleOn(checklistItem);
    if (operation !== 'update') return [];
    if (key === 'assigneeAdd') return namedIds(checklistItem.uid);
    if (key !== 'isChecked') return [];
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(id) }, { checklistArray: 1 }],
    }, 'findOne');
    const held = new Set(peopleOn((project && project.checklistArray) || []));
    return peopleOn(checklistItem).filter((uid) => !held.has(uid));
};

const buildQuery = (key, item) => {
    switch (key) {
        case 'name':
            return { $set: { "checklistArray.$[elem].name": item.name } }
        case 'isChecked':
            return { $set: { "checklistArray": item } }
        case 'assigneeAdd':
            return { $push: { "checklistArray.$[elem].AssigneeUserId": item.uid  } };
        case 'assigneeRemove':
            return { $pull: { "checklistArray.$[elem].AssigneeUserId": item.uid  } };
        default:
            return {};
    }
}

/**
 * This endpoint is used for handle all the CRUD operations for the project checklist
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.handleChecklist = async (req, res) => {
    try {
        const { id, checklistItem, operation, key } = req.body;

        const refusal = checklistRefusal(req.body);
        if (refusal) return badRequest(res, refusal);

        let update = {};
        if (operation === 'push') {
            update = {
                $push: { checklistArray: checklistItem }
            };
        } else if (operation === 'update') {
            update = buildQuery(key, checklistItem)
        } else if (operation === 'delete') {
            update = {
                $pull: { checklistArray: { id: { $in: checklistItem } } }
            };
        } else {
            return res.status(400).json({
                status: false,
                message: 'Invalid operation type. Supported operations: push, update, delete'
            });
        }

        const options = (operation === 'update' && ITEM_KEYS.includes(key)) ? { arrayFilters: [{ "elem.id": checklistItem.id }] } : undefined;

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
        const peopleRefusal = await namedPeopleRefusal(companyId, id, await peopleAdded(companyId, req.body));
        if (peopleRefusal) return badRequest(res, peopleRefusal);
        const previous = await MongoDbCrudOpration(companyId, params, 'findOneAndUpdate');

        removeCache('UserProjectData:', true);

        if (previous) {
            recordChecklistChange({ companyId, projectId: id, actorId: req.uid, previous, body: req.body })
                .catch((error) => logger.error(`project checklist history: ${error && error.message}`));
            return res.status(200).json({ status: true });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update the project checklist",
            error: error
        });
    }
}