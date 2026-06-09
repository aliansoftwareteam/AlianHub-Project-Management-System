const logger = require("../../Config/loggerConfig");
const { myCache } = require("../../Config/config");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const {
  MongoDbCrudOpration,
} = require("../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../Auth/helper");
// Promise function to retrieve all subscription plans or execute an aggregation query.
exports.getAllSubscriptionPlansPromise = (queryData) => {
  return new Promise((resolve, reject) => {
    try {
      const obj = {
        type: SCHEMA_TYPE.SUBSCRIPTIONPLAN,
        data: [{}],
      };

      const subscriptionCacheKey = "subscriptionPlan";

      if (!queryData) {
        const cachedData = myCache.get(subscriptionCacheKey);
        if (cachedData) {
          return resolve(cachedData);
        }
        MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, obj, "find")
          .then((responseData) => {
            myCache.set(subscriptionCacheKey, responseData, 604800);
            resolve(responseData);
          })
          .catch((error) => {
            logger.error(
              `Error fetching Subscription Plan: ${
                error.message || "Unknown error"
              }`
            );
            reject(error);
          });
        return;
      }

      MongoDbCrudOpration(
        SCHEMA_TYPE.GOLBAL,
        {
          type: SCHEMA_TYPE.SUBSCRIPTIONPLAN,
          data: [queryData],
        },
        "aggregate"
      )
        .then((responseData) => {
          resolve(responseData);
        })
        .catch((error) => {
          logger.error(
            `Error fetching Subscription Plan: ${
              error.message || "Unknown error"
            }`
          );
          reject(error);
        });
    } catch (error) {
      reject(error);
    }
  });
};

// Controller function to retrieve all subscription plans or perform aggregation queries.
exports.getAllSubscriptionPlans = (req, res) => {
  exports
    .getAllSubscriptionPlansPromise(req.body.query)
    .then((data) => {
      res.status(200).json(data);
    })
    .catch((error) => {
      res.status(500).json(error.message);
    });
};

// Promise function to retrieve a subscription plan by id.
exports.getSubscriptionPlanByIdPromise = (subscriptionId) => {
  return new Promise((resolve, reject) => {
    try {
      if (!subscriptionId) {
        return reject(new Error("Subscription ID is required"));
      }

      let obj = {
        type: SCHEMA_TYPE.SUBSCRIPTIONPLAN,
        data: [{ _id: subscriptionId }],
      };

      MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, obj, "findOne")
        .then((responseData) => {
          resolve(responseData);
        })
        .catch((error) => {
          logger.error(
            `Error fetching the Subscription Plan: ${
              error.message || "Unknown error"
            }`
          );
          reject(new Error("Could not retrieve Subscription Plan"));
        });
    } catch (error) {
      reject(error);
    }
  });
};

// Controller function to retrieve a subscription plan by ID.
exports.getSubscriptionPlanById = (req, res) => {
  exports
    .getSubscriptionPlanByIdPromise(req.params.id)
    .then((data) => {
      res.status(200).json(data);
    })
    .catch((error) => {
      res.status(500).json(error.message);
    });
};

//  Promise function to find a subscription plan and update it.
exports.updateSubscriptionPlanPromise = (queryData) => {
  return new Promise((resolve, reject) => {
    try {
      if (!queryData || !Array.isArray(queryData)) {
        return reject(
          new Error("Update Query is required and must be a valid array!")
        );
      }

      let convertQueryData = replaceObjectKey(queryData,"objId")      
      const obj = {
        type: SCHEMA_TYPE.SUBSCRIPTIONPLAN,
        data: [...convertQueryData],
      };

      MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, obj, "findOneAndUpdate")
        .then((updatedPlan) => {
          resolve(updatedPlan);
        })
        .catch((error) => {
          logger.error(
            `Error updating the Subscription Plan: ${
              error.message || "Unknown error"
            }`
          );
          reject(new Error("Could not update subscription plan"));
        });
    } catch (error) {
      reject(error);
    }
  });
};

// Controller function to find a subscription plan and update it.
exports.updateSubscriptionPlan = (req, res) => {
  exports
    .updateSubscriptionPlanPromise(req.body.query)
    .then((data) => {
      res.status(200).json(data);
    })
    .catch((error) => {
      res.status(500).json(error.message);
    });
};
