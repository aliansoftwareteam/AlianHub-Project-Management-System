const { myCache } = require("../../../Config/config");
const { removeCache } = require("../../../utils/commonFunctions");
const { dbCollections } = require("../../../Config/collections");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { getRoleType, isPrivileged } = require("../../../Config/permissionGuard");
const socketEmitter = require("../../../event/socketEventEmitter");
const mongoose = require("mongoose");

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const CURRENCY_OPERATORS = Object.freeze(['$set', '$inc']);

/* Picking a project currency moves its usage count by one; that is the only write a member makes. */
const isUsageCountStep = (key, updateObject) => key === '$inc'
    && Object.keys(updateObject).length === 1
    && [1, -1].includes(updateObject.count);

const refuse = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

exports.updateCurrency = async (req, res) => {
    try {
        const { cid, id } = req.params;
        const { key, updateObject } = req.body;
        const companyId = String(req.headers["companyid"] || "");

        if (!cid || !id || !OBJECT_ID_PATTERN.test(String(id))) {
            return refuse(res, 400, "Company ID (cid) and currency ID (id) are required.");
        }
        if (String(cid) !== companyId) {
            return refuse(res, 403, "That currency belongs to another company.");
        }
        if (!updateObject || typeof updateObject !== 'object' || Array.isArray(updateObject)) {
            return refuse(res, 400, "Update Object is Required");
        }
        if (!CURRENCY_OPERATORS.includes(key)) {
            return refuse(res, 400, `key must be one of ${CURRENCY_OPERATORS.join(', ')}.`);
        }
        if (!isUsageCountStep(key, updateObject) && !isPrivileged(await getRoleType(companyId, req.uid))) {
            return refuse(res, 403, "Only an owner or an admin can change the company currencies.");
        }

        const query = {
            type: dbCollections.CURRENCY_LIST,
            data: [
                { _id: new mongoose.Types.ObjectId(id) },
                { [key]: updateObject }
            ]
        };

        const response = await MongoDbCrudOpration(companyId, query, "updateOne");
        removeCache(`currency:${companyId}`);
        socketEmitter.emit('update', { type: 'update', module: 'currency', data: { _id: id }, updatedFields: updateObject });
        return res.status(200).json({ status: true, statusText: "Currency updated.", data: response });
    } catch (error) {
        console.error("Error updating currency:", error);
        return res.status(500).json({
            status: false,
            statusText: "An error occurred while updating the currency.",
            message: error.message || error
        });
    }
};

exports.getCurrency = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the currency.",
                error: "Company ID is required in headers."
            });
        }
        const cacheKey = `currency:${companyId}`;
        const value = myCache.get(cacheKey);

        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }
        const query = {
            type: dbCollections.CURRENCY_LIST,
            data: []
        };

        const response = await MongoDbCrudOpration(companyId, query, "find");
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response);
    } catch (error) {
        console.error("Error getting currency:", error);
        return res.status(500).json({
            message: "An error occurred while getting the currency.",
            error: error.message || error
        });
    }
};
