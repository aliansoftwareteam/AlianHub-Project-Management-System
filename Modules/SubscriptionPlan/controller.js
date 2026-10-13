const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { myCache } = require("../../Config/config");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const {
  MongoDbCrudOpration,
} = require("../../utils/mongo-handler/mongoQueries");
const { OBJECT_ID_PATTERN, validatePlanUpdate, validatePlanFilters, matchesFilters } = require("./planRules");

const PLAN_CACHE_KEY = "subscriptionPlan";
const PLAN_CACHE_SECONDS = 604800;

const refuse = (res, code, statusText, message) => res.status(code).json({ status: false, statusText, message });

// The catalogue is one global collection shared by every workspace, so it is only ever
// read whole by a query built here; narrowing happens on the rows already read.
exports.getAllSubscriptionPlansPromise = async () => {
  const cached = myCache.get(PLAN_CACHE_KEY);
  if (cached) return cached;
  try {
    const plans = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.SUBSCRIPTIONPLAN, data: [{}] }, "find");
    myCache.set(PLAN_CACHE_KEY, plans, PLAN_CACHE_SECONDS);
    return plans;
  } catch (error) {
    logger.error(`Error fetching Subscription Plan: ${error.message || "Unknown error"}`);
    throw error;
  }
};

exports.getAllSubscriptionPlans = async (req, res) => {
  try {
    res.status(200).json(await exports.getAllSubscriptionPlansPromise());
  } catch (error) {
    res.status(500).json(error.message);
  }
};

exports.findSubscriptionPlans = async (req, res) => {
  const checked = validatePlanFilters(req.body);
  if (!checked.ok) return refuse(res, 400, "Bad Request", checked.error);
  try {
    const plans = await exports.getAllSubscriptionPlansPromise();
    return res.status(200).json((plans || []).filter((plan) => matchesFilters(plan, checked.filters)));
  } catch (error) {
    return res.status(500).json(error.message);
  }
};

exports.getSubscriptionPlanByIdPromise = async (subscriptionId) => {
  if (!subscriptionId) throw new Error("Subscription ID is required");
  try {
    return await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.SUBSCRIPTIONPLAN, data: [{ _id: subscriptionId }] }, "findOne");
  } catch (error) {
    logger.error(`Error fetching the Subscription Plan: ${error.message || "Unknown error"}`);
    throw new Error("Could not retrieve Subscription Plan");
  }
};

exports.getSubscriptionPlanById = async (req, res) => {
  if (!OBJECT_ID_PATTERN.test(String(req.params.id || ""))) return refuse(res, 400, "Bad Request", "id must be a plan id.");
  try {
    return res.status(200).json(await exports.getSubscriptionPlanByIdPromise(req.params.id));
  } catch (error) {
    return res.status(500).json(error.message);
  }
};

exports.updateSubscriptionPlan = async (req, res) => {
  const checked = validatePlanUpdate(req.body);
  if (!checked.ok) return refuse(res, 400, "Bad Request", checked.error);
  try {
    const updated = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
      type: SCHEMA_TYPE.SUBSCRIPTIONPLAN,
      data: [{ _id: new mongoose.Types.ObjectId(checked.id) }, { $set: checked.fields }, { returnDocument: "after" }],
    }, "findOneAndUpdate");
    if (!updated) return refuse(res, 404, "Not Found", "Plan not found.");
    myCache.del(PLAN_CACHE_KEY);
    return res.status(200).json(updated);
  } catch (error) {
    logger.error(`Error updating the Subscription Plan: ${error.message || "Unknown error"}`);
    return refuse(res, 500, "Internal Server Error", "Could not update subscription plan");
  }
};
