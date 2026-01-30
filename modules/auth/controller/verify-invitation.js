const logger = require("../../../Config/loggerConfig");
const { default: mongoose } = require("mongoose");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { dbCollections } = require("../../../Config/collections");
const { addAndRemoveUserInMongodbNotificationCount } = require("../controller");
const atob = require('atob');
const { updateUserFun, getUserByQueyFun } = require("../../users-module/controller");
const { updateMemberFunction } = require('../../settings/Members/controller');

/**
 * Check Permission
 * @param {Object} req 
 * @param {Object} res 
 * @returns 
 */
exports.checkPermission = (req, res) => {
    if (!(req.body && req.body.id)) {
        res.json({
            status: false,
            key: 1,
            statusText: "Invalid URL id."
        });
        return;
    }
    const id = atob(req.body.id);

    const idArray = id.split('&');
    if (!(idArray && idArray.length)) {
        res.json({
            status: false,
            key: 1,
            statusText: "Invalid URL."
        });
        return;
    }
    let finalObj = {};
    for (let i = 0; i < idArray.length; i += 1) {
        const aidArray = idArray[i].split('=');
        finalObj[aidArray[0]] = aidArray[1];
    }
    req.body = finalObj;
    if (!(req.body && req.body.userId)) {
        res.json({
            status: true,
            key: 2,
            companyId: req.body.companyId,
            linkId: req.body.linkId,
            statusText: "User Not Found."
        });
        return;
    }

    if (!(req.body && req.body.companyId)) {
        res.json({
            status: false,
            key: 1,
            statusText: "Invalid URL."
        });
        return;
    }

    if (!(req.body && req.body.linkId)) {
        res.json({
            status: false,
            key: 1,
            statusText: "Invalid URL."
        });
        return;
    }

    try {
        const query = {
            _id: new mongoose.Types.ObjectId(req.body.userId)
        }
        getUserByQueyFun(query)
        .then((resp) => {
            const snap = resp[0];
            if(!snap) {
                res.send({
                    status: true,
                    key: 2,
                    companyId: req.body.companyId,
                    linkId: req.body.linkId,
                    statusText: "User Not Found."
                });
                return;
            }
            const companyUserQuery = {
                type: dbCollections.COMPANY_USERS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(req.body.docId)
                    }
                ]
            }
            MongoDbCrudOpration(req.body.companyId, companyUserQuery, "findOne")
            .then((cUser) => {
                if(!cUser) {
                    res.send({
                        status: false,
                        key: 1,
                        statusText: "Invalid URL."
                    });
                    return;
                }
                let userData = {};
                userData = cUser;

                if (userData.status === 2) {
                    res.send({
                        status: false,
                        key: 3,
                        statusText: "You already accepted the invitation."
                    });
                    return;
                }
                if (new Date(new Date(userData.sendInvitationTime).getTime()+(24*60*60*1000)) < new Date()) {
                    res.send({
                        status: false,
                        key: 4,
                        statusText: "Link is Expired."
                    });
                    return;
                }
                if (userData.linkId !== req.body.linkId) {
                    res.send({
                        status: false,
                        key: 4,
                        statusText: "Link is Expired."
                    });
                    return;
                }
                res.json({
                    status: true,
                    key: 5,
                    companyId: req.body.companyId
                });

                const memberObject = [
                    {
                        _id: new mongoose.Types.ObjectId(req.body.docId)
                    }, {
                        $set: {
                            status: 2,
                            linkId: ""
                        }
                    }
                ]

                updateMemberFunction(req.body.companyId, memberObject, "updateOne")
                .then(() => {
                    const userUpdateQuery = {
                        type: dbCollections.USERS,
                        data: [
                            {
                                _id: new mongoose.Types.ObjectId(req.body.userId)
                            }, {
                                $push: {
                                    AssignCompany: req.body.companyId
                                }
                            }
                        ]
                    }
                    updateUserFun(SCHEMA_TYPE.GOLBAL, userUpdateQuery, "updateOne",req.body.companyId,req.body.userId)
                    .catch((error) => {
                        logger.error(`ERROR in update user: ${error.message}`);
                    })

                    addAndRemoveUserInMongodbNotificationCount(req.body.companyId,req.body.userId,"Add").catch((error)=>{
                        logger.error(`ERROR in create user In mongodb: ${error}`)
                    })
                })
                .catch((error) => {
                    logger.error(`ERROR in update company_users: ${error.message}`);
                })
            }).catch((CError) => {
                logger.error(`Check Permission Error: ${CError}`);
                res.send({
                    status: false,
                    key: 1,
                    statusText: "Invalid URL."
                });
            });
        }).catch((error) => {
            logger.error(`Check Permission Error: ${error}`);
            res.send({
                status: false,
                key: 1,
                statusText: "Invalid URL."
            });
        })
    } catch (error) {
        res.send({
            status: false,
            key: 1,
            statusText: "Invalid URL."
        });
    }
};
