
const { default: mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const { dbCollections } = require("../../Config/collections.js");
const { myCache } = require('../../Config/config');
const { removeCache } = require("../../utils/commonFunctions");
const { escapeRegex } = require("../../utils/escapeRegex");
exports.deleteTracker = async (req, res) => {
    try {
        const { id } = req.params; // Extract _id from URL parameters

        if (!id) {
            return res.status(400).send({
                status: false,
                statusText: "Tracker ID is required"
            });
        }

        // Prepare delete operation
        const deleteObj = {
            type: dbCollections.TIMETRACKER_DOWNLOAD,
            data: [{ _id: new mongoose.Types.ObjectId(id) }]
        };

        // Perform the delete operation
        const result = await MongoDbCrudOpration('global', deleteObj, 'deleteOne');
        if (result.deletedCount === 1) {
            removeCache('trackers:frontend');
            return res.status(200).send({
                status: true,
                statusText: "Item deleted successfully"
            });
        } else {
            return res.status(404).send({
                status: false,
                statusText: "Item not found"
            });
        }
    } catch (error) {
        console.error("Error deleting item:", error);
        return res.status(500).send({
            status: false,
            statusText: "Failed to delete item",
            error: error.message
        });
    }
};

exports.saveTracker = async (req, res) => {
    try {
        const { dataObj } = req.body

        if (!dataObj) {
            return res.status(400).send({
                status: false,
                statusText: "Missing required data"
            });
        }

        let response;

        const obj = {
            type: dbCollections.TIMETRACKER_DOWNLOAD,
            data: req.body.dataObj
        };

        await MongoDbCrudOpration('global', obj, 'save').then((res) => {
            response = res;
        })
        removeCache('trackers:frontend');
        res.send({
            status: true,
            statusText: "Tracker saved successfully",
            data: response
        });

    } catch (error) {
        console.error('Error in saveTracker:', error);
        res.status(500).send({
            status: false,
            statusText: "An error occurred while saving the tracker",
            error: error.message
        });
    }
};

exports.updateTracker = async (req, res) => {
    try {
        const { dataObj } = req.body;
        if (!dataObj || !dataObj[0]._id) {
            return res.status(400).send({
                status: false,
                statusText: "Missing required data or ID"
            });
        }

        let response;

        const obj = {
            type: dbCollections.TIMETRACKER_DOWNLOAD,
            data: [
                { _id: new mongoose.Types.ObjectId(dataObj[0]._id) }, // Filter to find the existing tracker
                { ...dataObj[1] } // Data to update
            ]
        };
        // Use MongoDbCrudOpration to update the tracker
        response = await MongoDbCrudOpration('global', obj, 'findOneAndUpdate');

        if (!response) {
            return res.status(404).send({
                status: false,
                statusText: "Tracker not found"
            });
        }
        removeCache('trackers:frontend');
        res.send({
            status: true,
            statusText: "Tracker updated successfully",
            data: response
        });

    } catch (error) {
        console.error('Error in updateTracker:', error);
        res.status(500).send({
            status: false,
            statusText: "An error occurred while updating the tracker",
            error: error.message
        });
    }
};

/* Anyone can read this list, signed in or not, so it carries the download links and
 * nothing about who uploaded them. */
const DOWNLOAD_FIELDS = ['title', 'type', 'version', 'downloadUrl', 'description'];
const SORTABLE_FIELDS = [...DOWNLOAD_FIELDS, 'createdAt', '_id'];

const sortFrom = (raw) => {
    let asked;
    try {
        asked = JSON.parse(raw);
    } catch {
        return {};
    }
    if (!asked || typeof asked !== 'object' || Array.isArray(asked)) return {};
    return Object.fromEntries(Object.entries(asked).filter(([field, direction]) => SORTABLE_FIELDS.includes(field) && (direction === 1 || direction === -1)));
};

const positiveInt = (raw) => {
    const value = parseInt(raw, 10);
    return Number.isInteger(value) && value > 0 ? value : null;
};

exports.getTracker = async (req, res) => {
    try {
        let { currentPage = 1, batchSize, search = '', sort = '{}', source = '' } = req.query;
        batchSize = positiveInt(batchSize);
        search = typeof search === 'string' ? search : '';

        const trackerCacheKey = source === 'front' ? 'trackers:frontend' : '';

        let trackers = myCache.get(trackerCacheKey);

        const skips = ((positiveInt(currentPage) || 1) - 1) * (batchSize || 1);
        const sortObj = sortFrom(sort);

        if (!trackers || source == '') {
            const data = {
                type: dbCollections.TIMETRACKER_DOWNLOAD,
                data: [[
                    {
                        $match: {
                            $and: [
                                { ...(search && { title: { $regex: escapeRegex(search), $options: 'i' } }) },
                            ],
                        },
                    },
                    {
                        $facet: {
                            metadata: [{ $count: 'total' }],
                            data: [
                                { $sort: Object.keys(sortObj).length ? sortObj : { createdAt: -1, _id: 1 } },
                                { $skip: skips },
                                ...(batchSize ? [{ $limit: batchSize }] : []),
                                { $project: Object.fromEntries(DOWNLOAD_FIELDS.map((field) => [field, 1])) },
                            ],
                        },
                    },
                ]]
            };

            const response = await MongoDbCrudOpration('global', data, 'aggregate');
            if (response && response.length > 0) {
                const metadata = response[0].metadata[0] || { total: 1 };
                const totalRecords = metadata.total || 0;

                res.send({
                    status: true,
                    statusText: 'Data fetched successfully',
                    data: response[0].data,
                    metadata: {
                        total: totalRecords,
                        totalPages: batchSize ? Math.ceil(totalRecords / batchSize) : 1,
                    },
                });

                if (source === 'front') {
                    myCache.set(trackerCacheKey, response, 604800);
                }
            } else {
                res.send({
                    status: false,
                    statusText: 'No data found',
                    data: [],
                    metadata: { total: 0, totalPages: 0 },
                });
            }
        } else {
            const metadata = trackers[0].metadata[0] || { total: 1 };
            const totalRecords = metadata.total || 0;
            res.send({
                status: true,
                statusText: 'Data fetched successfully from cache',
                data: trackers[0].data,
                metadata: {
                    total: totalRecords,
                    totalPages: batchSize ? Math.ceil(totalRecords / batchSize) : 1,
                },
            });
        }
    } catch (error) {
        console.error('Error in getTracker:', error);
        res.status(500).send({
            status: false,
            statusText: 'An error occurred while fetching tracker data',
            error: error.message,
        });
    }
};