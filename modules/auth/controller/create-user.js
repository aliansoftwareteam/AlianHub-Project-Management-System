const logger = require("../../../Config/loggerConfig");
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const sendMailRef = require("./send-verification-mail")
const {generateJWTToken} = require('../../../Config/jwt');
const { dbCollections } = require('../../../Config/collections');
const ctr = require("../controller");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const mongoose = require("mongoose");
const { importUserNotifications } = require("../../../utils/data");
const { addAndRemoveUserInMongodbNotificationCount } = require("../../auth/controller");


exports.authenticateToken = "";


exports.addUserMongodbV2 = (data) => {
    return new Promise((resolve, reject) => {
        try {
            let obj = {
                AssignCompany: data.assignCompany ? [data.assignCompany] : [],
                Employee_FName:  data.firstName,
                Employee_LName:  data.lastName,
                Employee_Email: data.email,
                Employee_Name:  data.firstName +' '+ data.lastName,
                Time_Format: "12",
                isDeleted: false,
                isActive: true,
                isOnline: false,
                isEmailVerified: data.isInvitation,
            }
            if (data.isProductOwner) {
                obj.isProductOwner = data.isProductOwner;
            }
            let object = {
                type: dbCollections.USERS,
                data: obj
            }
            try {
                ctr.insertAuthFun({email: data.email, password: data.password}, (iUserRes) => {
                    if (iUserRes.status) {
                        object.data._id = iUserRes.data._id;
                        mongoRef.MongoDbCrudOpration('global',object,'save').then((res)=>{
                            resolve({status: true, statusText: res})
                        }).catch((error)=>{
                            reject(error)
                        })
                        return;
                    }
                    reject(iUserRes.message);
                });
            } catch (error) {
                reject(error)
            }
        } catch (error) {
            reject(error);
        }
    })
}


/**
 * Create User API
 * @param {Objcet} req
 * @param {Object} res
 * @returns
 */
exports.createUserV2 = (req,res) => {
    try {
        if (!(req.body && req.body.firstName)) {
            res.send({
                status: false,
                statusText: `First Name is required`
            })
        }
        if (!(req.body && req.body.lastName)) {
            res.send({
                status: false,
                statusText: `Last Name is required`
            })
        }
        if (!(req.body && req.body.email)) {
            res.send({
                status: false,
                statusText: `Email is required`
            })
        }
        if (!(req.body && req.body.password)) {
            res.send({
                status: false,
                statusText: `Password is required`
            })
        }
        // CALL VALIDATE LICENCE FUNCTION HERE...............
        exports.addUserMongodbV2(req.body).then((respo)=>{
            if (!req.body.isInvitation) {
                sendMailRef.sendVerificationEmailPromise(respo.statusText._id,respo.statusText.Employee_Email).catch((error)=>{
                    logger.error(error.statusText);
                })
            }
            try {
                // if (process.env.PAYMENTMETHOD) {
                //     paymentRef.createCustomerInPayment(respo.statusText._id).then(() => {
                //         res.send(respo);
                //     }).catch((error)=>{
                //         logger.error(`Error create customer chargbee: ${error}`);
                //         res.send({
                //             status: false,
                //             statusText: error
                //         });
                //     });
                // } else {
                //     res.send(respo);
                // }
                res.send(respo);
            } catch (error) {
                logger.error(`Error create customer In Payment: ${error}`);
                res.send({
                    status: false,
                    statusText: error.message || error
                });
            }
            // res.send(respo);
        }).catch((error)=>{
            res.send({
                status: false,
                statusText: error
            })
        })
    } catch (error) {
        res.send({
            status: false,
            statusText: `Error: ${error}`
        })
    }
}

/**
 * Generate JWT Token Function
 * @param {Object} req 
 * @param {Object} res 
 */
exports.generateToken = async (req, res) => {
    try {

        if (!(req.body && req.body.uid)) {
            res.status(400).json({
                status: false,
                statusText: "The user id is required."
            });
            return;
        }

        const {uid} = req.body;
        let object = {
            type: dbCollections.USERS,
            data: [
                {
                    _id: uid
                }
            ]
        }
        mongoRef.MongoDbCrudOpration('global', object, "findOne").then(async (response) => {
            const companyIds = response.AssignCompany && response.AssignCompany.length ? response.AssignCompany : [];
            const token = await generateJWTToken({uid: uid, companyIds: companyIds});
            res.json({
                status: true,
                statusText: "Jwt token generate successfully.",
                token: token
            });
        }).catch((error) => {
            logger.error(`Generate Jwt Token Error: ${error}`);
            res.status(400).json({
                status: false, 
                error,
                statusText: 'User not found.',
            });
        })
    } catch (error) {
        logger.error(`Generate Jwt Token Error: ${error}`);
        res.status(400).json({
            status: false,
            statusText: "Authentication failed!"
        });
    }
};


exports.verifyToken = (req, res) => {
    res.json({
        status: true,
        key: 1
    });
};

/**
 * Sign up with google
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.googleSignup = async (req, res) => {
    try {
        const { firstName, lastName, email, googleId, assignCompany, companyUserDocID } = req.body;

        // Validate Required Fields
        if (!firstName || !lastName || !email || !googleId) {
            return res.status(400).json({
                status: false,
                message: "First name, last name, email, and Google ID are required",
            });
        }

        // Check if user already exists
        const findObj = {
            type: dbCollections.USER_AUTH,
            data: [{ email }],
        };

        const existingUser = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, findObj, "findOne");

        if (existingUser) {
            // If already signed up via Google or Local, just return existing user
            return res.status(409).json({
                status: false,
                message: "Email already exists"
            });
        }

        // Create Auth Document (Google Only)
        const authDoc = {
            email,
            googleId,
            isBlocked: false,
        };

        const authObj = { type: dbCollections.USER_AUTH, data: authDoc };
        const authRes = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, authObj, "save");

        // Update user status in company users
        if (assignCompany) {
            const query = {
                type: SCHEMA_TYPE.COMPANY_USERS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(companyUserDocID)
                    },
                    {
                        $set: {
                            status: 2,
                            userId: authRes._id
                        }
                    }
                ]
            }
            await mongoRef.MongoDbCrudOpration(assignCompany, query, 'findOneAndUpdate');

            // Import notification settings
            await importUserNotifications(assignCompany, authRes._id).catch((error) => {
                logger.error(`Import notification setting error in googleSignup hook: ${error}`);
            });

            // Add notification count object
            await addAndRemoveUserInMongodbNotificationCount(assignCompany, authRes._id, "add").catch((error) => {
                logger.error(`Add user in mongodb notification count error in googleSignup hook: ${error}`);
            });
        }

        // Create User Document
        const userDoc = {
            _id: authRes._id,
            AssignCompany: assignCompany ? [assignCompany] : [],
            Employee_FName: firstName,
            Employee_LName: lastName,
            Employee_Email: email,
            Employee_Name: `${firstName} ${lastName}`,
            Time_Format: "12",
            isDeleted: false,
            isActive: true,
            isOnline: false,
            isEmailVerified: true, // Google email is already verified
        };

        const userObj = { type: dbCollections.USERS, data: userDoc };
        const userRes = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, userObj, "save");

        return res.status(200).json({
            status: true,
            message: "Google signup successful",
            data: userRes,
        });
    } catch (error) {
        logger.error(`Google Signup API Error: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: error.message || "Internal Server Error",
        });
    }
};

/**
 * Sign up with github
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.githubSignup = async (req, res) => {
    try {
        const { firstName, lastName, email, githubId, assignCompany, companyUserDocID } = req.body;

        // Validate Required Fields
        if (!firstName || !lastName || !email || !githubId) {
            return res.status(400).json({
                status: false,
                message: "First name, last name, email, and Github ID are required",
            });
        }

        // Check if user already exists
        const findObj = {
            type: dbCollections.USER_AUTH,
            data: [{ email }],
        };

        const existingUser = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, findObj, "findOne");

        if (existingUser) {
            // If already signed up via Github or Local, just return existing user
            return res.status(409).json({
                status: false,
                message: "Email already exists"
            });
        }

        // Create Auth Document (Google Only)
        const authDoc = {
            email,
            githubId,
            isBlocked: false,
        };

        const authObj = { type: dbCollections.USER_AUTH, data: authDoc };
        const authRes = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, authObj, "save");

        // Update user status in company users
        if (assignCompany) {
            const query = {
                type: SCHEMA_TYPE.COMPANY_USERS,
                data: [
                    {
                        _id: new mongoose.Types.ObjectId(companyUserDocID)
                    },
                    {
                        $set: {
                            status: 2,
                            userId: authRes._id
                        }
                    }
                ]
            }
            await mongoRef.MongoDbCrudOpration(assignCompany, query, 'findOneAndUpdate');

            // Import notification settings
            await importUserNotifications(assignCompany, authRes._id).catch((error) => {
                logger.error(`Import notification setting error in githubSignup hook: ${error}`);
            });

            // Add notification count object
            await addAndRemoveUserInMongodbNotificationCount(assignCompany, authRes._id, "add").catch((error) => {
                logger.error(`Add user in mongodb notification count error in googleSignup hook: ${error}`);
            });
        }

        // Create User Document
        const userDoc = {
            _id: authRes._id,
            AssignCompany: assignCompany ? [assignCompany] : [],
            Employee_FName: firstName,
            Employee_LName: lastName,
            Employee_Email: email,
            Employee_Name: `${firstName} ${lastName}`,
            Time_Format: "12",
            isDeleted: false,
            isActive: true,
            isOnline: false,
            isEmailVerified: true, // Github email is already verified
        };

        const userObj = { type: dbCollections.USERS, data: userDoc };
        const userRes = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, userObj, "save");

        return res.status(200).json({
            status: true,
            message: "Github signup successful",
            data: userRes,
        });
    } catch (error) {
        logger.error(`Github Signup API Error: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: error.message || "Internal Server Error",
        });
    }
};