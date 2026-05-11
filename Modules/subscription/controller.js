const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { replaceObjectKey } = require("../Auth/helper");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");

exports.getSubscriptions = async(req, res) => {
    try {
        const { id } = req.params;
        if(!id) {
            return res.status(400).json({
                status: false,
                message: 'id is required.'
            });
        }

        const subscriptionObj = {
            type: SCHEMA_TYPE.SUBSCRIPTIONS,
            data: [
                {subscriptionId: id}
            ]
        };
        const subscription = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, subscriptionObj, 'findOne');

        if (!subscription) {
            return res.status(404).json({ message: "subscription not found" });
        }
        return res.status(200).json(subscription);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while getting the subscription",error: error });
    }
}

exports.subscriptionTabFetchSubscriptionData = async(req, res) => {
    try {
        const { findQuery } = req.body;
        if (!findQuery) {
            return res.status(400).json({
                message: "An error occurred while getting the task.",
                error: "Query is required."
            });
        }
        let query = replaceObjectKey(findQuery, ["objId", "dbDate"])
        
        const subscriptionObj = {
            type: SCHEMA_TYPE.SUBSCRIPTIONS,
            data: [query]
        };
        const subscription = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, subscriptionObj, 'aggregate');

        if (!subscription) {
            return res.status(404).json({ message: "subscription not found" });
        }
        return res.status(200).json(subscription);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while getting the subscription",error: error });
    }
}
