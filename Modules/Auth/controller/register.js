const mongoC = require("../../../utils/mongo-handler/mongoQueries")
const { dbCollections } = require('../../../Config/collections');
const bcrypt = require('bcrypt');
const config = require("../../../Config/config");
const logger = require("../../../Config/loggerConfig");
const serviceCtr = require("../../serviceFunction.js")
const sendMail = require("../../service.js");
const { generateToken, verifyToken, generateJWTToken, removeCacheAndCookie } = require("../../../Config/jwt.js");
const helperCtr = require("../helper.js");
const sesstionCtr = require("../session.js");
const mongoose = require("mongoose");
const { removeCache } = require("../../../utils/commonFunctions.js");
const { updateUserFun } = require("../../Users/controller.js");



const { insertAuthFun } = require('./authHelpers');
exports.registerAuth = (req, res) => {
    try {
        insertAuthFun(req.body, (iUserRes) => {
            if (iUserRes.status) {
                res.status(200).json(iUserRes)
                return;
            }
            res.status(400).json({message: iUserRes.message});
        });
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};
