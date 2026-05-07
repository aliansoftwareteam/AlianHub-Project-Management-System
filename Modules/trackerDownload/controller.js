
const { default: mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const { dbCollections } = require("../../Config/collections.js");
const { myCache } = require('../../Config/config');
const { removeCache } = require("../../utils/commonFunctions");
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

exports.getTracker = async (req, res) => {
    try {
        let { currentPage = 1, batchSize, search = '', sort = '{}', source = '' } = req.query;

        // Determine the cache key based on the presence of the X-Source header
        const trackerCacheKey = source === 'front' ? 'trackers:frontend' : '';

        let trackers = myCache.get(trackerCacheKey);

        // Calculate skips based on currentPage
        const skips = (parseInt(currentPage) - 1) * (batchSize ? parseInt(batchSize) : 1); // Default to 1 to avoid skipping all records
        const sortObj = JSON.parse(sort);



        // If no data in cache, fetch from the database
        if (!trackers || source == '') {
            const data = {
                type: dbCollections.TIMETRACKER_DOWNLOAD,
                data: [[
                    {
                        $match: {
                            $and: [
                                { ...(search && { title: { $regex: search, $options: 'i' } }) },
                            ],
                        },
                    },
                    {
                        $lookup: {
                            from: dbCollections.USERS,
                            localField: 'userId',
                            foreignField: '_id',
                            as: 'user_data',
                            pipeline: [
                                {
                                    $project: {
                                        Employee_profileImage: 1,
                                        Employee_Name: 1,
                                    },
                                },
                            ],
                        },
                    },
                    {
                        $facet: {
                            metadata: [{ $count: 'total' }],
                            data: [
                                { $sort: Object.keys(sortObj).length ? sortObj : { createdAt: -1, _id: 1 } },
                                { $skip: skips },
                                ...(batchSize ? [{ $limit: parseInt(batchSize) }] : []), // Only apply $limit if batchSize is provided
                            ],
                        },
                    },
                ]]
            };

            const response = await MongoDbCrudOpration('global', data, 'aggregate');
            if (response && response.length > 0) {
                const metadata = response[0].metadata[0] || { total: 1 };
                const totalRecords = metadata.total || 0;

                // Send response
                res.send({
                    status: true,
                    statusText: 'Data fetched successfully',
                    data: response[0].data,
                    metadata: {
                        total: totalRecords,
                        totalPages: batchSize ? Math.ceil(totalRecords / parseInt(batchSize)) : 1, // If no batchSize, assume all records fit on one page
                    },
                });

                // Store the response in the appropriate cache
                if (source === 'front') {
                    myCache.set(trackerCacheKey, response, 604800); // Cache for 7 days
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
            // If data is found in cache, return it
            const metadata = trackers[0].metadata[0] || { total: 1 };
            const totalRecords = metadata.total || 0;
            res.send({
                status: true,
                statusText: 'Data fetched successfully from cache',
                data: trackers[0].data,
                metadata: {
                    total: totalRecords,
                    totalPages: batchSize ? Math.ceil(totalRecords / parseInt(batchSize)) : 1, // If no batchSize, assume all records fit on one page
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