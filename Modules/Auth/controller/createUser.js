const logger = require("../../../Config/loggerConfig");
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const sendMailRef = require("./sendVerificationMail")
const { dbCollections } = require('../../../Config/collections');
const ctr = require("../controller");
const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const mongoose = require("mongoose");
const { importUserNotifications } = require("../../../utils/data");
const { addAndRemoveUserInMongodbNotificationCount } = require("../../Auth/controller");
const { toAuthView } = require("../../Users/helpers/userAccessRules");


exports.authenticateToken = "";

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const PENDING_INVITATION = 1;

/* The body's assignCompany used to be taken on trust, which let anyone sign up straight
 * into any company. A company admits only an email it has a pending invitation row for. */
exports.findPendingInvitation = async ({ companyId, email, companyUserId }) => {
    if (!OBJECT_ID_PATTERN.test(String(companyId || '')) || !email) return null;
    const filter = { userEmail: String(email).trim().toLowerCase(), status: PENDING_INVITATION, isDelete: { $ne: true } };
    if (companyUserId !== undefined) {
        if (!OBJECT_ID_PATTERN.test(String(companyUserId || ''))) return null;
        filter._id = new mongoose.Types.ObjectId(String(companyUserId));
    }
    return mongoRef.MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.COMPANY_USERS, data: [filter] }, 'findOne').catch(() => null);
};

exports.admitInvitee = async (body) => {
    if (!body.assignCompany && !body.isInvitation) return { ...body, isInvitation: false };
    const invitation = await exports.findPendingInvitation({ companyId: body.assignCompany, email: body.email });
    return invitation ? { ...body, isInvitation: true } : { ...body, assignCompany: '', isInvitation: false };
};


const REGISTRANT_FIELDS = ['firstName', 'lastName', 'email', 'password', 'assignCompany', 'isInvitation'];
const REQUIRED_SIGNUP_FIELDS = [['firstName', 'First Name'], ['lastName', 'Last Name'], ['email', 'Email'], ['password', 'Password']];

/* A signup never copies ownership, verification, billing or token fields from the request:
 * isProductOwner alone opens the Instance console. Setup grants it in its own update. */
exports.registrantFields = (body) => REGISTRANT_FIELDS.reduce((picked, field) => {
    if (body && Object.prototype.hasOwnProperty.call(body, field)) picked[field] = body[field];
    return picked;
}, {});

exports.buildUserDocument = ({ firstName, lastName, email, assignCompany, isInvitation }) => ({
    AssignCompany: assignCompany ? [assignCompany] : [],
    Employee_FName: firstName,
    Employee_LName: lastName,
    Employee_Email: email,
    Employee_Name: `${firstName} ${lastName}`,
    Time_Format: "12",
    isDeleted: false,
    isActive: true,
    isOnline: false,
    isEmailVerified: Boolean(isInvitation),
});

exports.addUserMongodbV2 = (data) => new Promise((resolve, reject) => {
    const object = { type: dbCollections.USERS, data: exports.buildUserDocument(data) };
    ctr.insertAuthFun({ email: data.email, password: data.password }, (iUserRes) => {
        if (!iUserRes.status) return reject(iUserRes.message);
        object.data._id = iUserRes.data._id;
        mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, object, 'save')
            .then((res) => resolve({ status: true, statusText: toAuthView(res) }))
            .catch(reject);
    });
});

const isFilledString = (value) => typeof value === 'string' && value.trim() !== '';

exports.createUserV2 = (req, res) => {
    try {
        const registrant = exports.registrantFields(req.body);
        const missing = REQUIRED_SIGNUP_FIELDS.find(([field]) => !isFilledString(registrant[field]));
        if (missing) {
            return res.send({ status: false, statusText: `${missing[1]} is required` });
        }
        let admitted = registrant;
        exports.admitInvitee(registrant).then((body) => {
            admitted = body;
            return exports.addUserMongodbV2(body);
        }).then((respo) => {
            if (!admitted.isInvitation) {
                sendMailRef.sendVerificationEmailPromise(respo.statusText._id, respo.statusText.Employee_Email).catch((error) => {
                    logger.error(error.statusText);
                });
            }
            res.send(respo);
        }).catch((error) => {
            res.send({
                status: false,
                statusText: error
            });
        });
    } catch (error) {
        res.send({
            status: false,
            statusText: `Error: ${error}`
        });
    }
}

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

        const invitation = assignCompany
            ? await exports.findPendingInvitation({ companyId: assignCompany, email, companyUserId: companyUserDocID })
            : null;
        const invitedCompany = invitation ? String(assignCompany) : '';

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
        if (invitedCompany) {
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
            AssignCompany: invitedCompany ? [invitedCompany] : [],
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
            data: toAuthView(userRes),
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

        const invitation = assignCompany
            ? await exports.findPendingInvitation({ companyId: assignCompany, email, companyUserId: companyUserDocID })
            : null;
        const invitedCompany = invitation ? String(assignCompany) : '';

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
        if (invitedCompany) {
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
            AssignCompany: invitedCompany ? [invitedCompany] : [],
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
            data: toAuthView(userRes),
        });
    } catch (error) {
        logger.error(`Github Signup API Error: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: error.message || "Internal Server Error",
        });
    }
};

/**
 * Sign up with gitlab
 * @param {*} req
 * @param {*} res
 * @returns
 */
exports.gitlabSignup = async (req, res) => {
    try {
        const { firstName, lastName, email, gitlabId, assignCompany, companyUserDocID } = req.body;

        // Validate Required Fields
        if (!firstName || !lastName || !email || !gitlabId) {
            return res.status(400).json({
                status: false,
                message: "First name, last name, email, and GitLab ID are required",
            });
        }

        const invitation = assignCompany
            ? await exports.findPendingInvitation({ companyId: assignCompany, email, companyUserId: companyUserDocID })
            : null;
        const invitedCompany = invitation ? String(assignCompany) : '';

        // Check if user already exists
        const findObj = {
            type: dbCollections.USER_AUTH,
            data: [{ email }],
        };

        const existingUser = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, findObj, "findOne");

        if (existingUser) {
            // If already signed up via GitLab or Local, just return existing user
            return res.status(409).json({
                status: false,
                message: "Email already exists"
            });
        }

        // Create Auth Document (GitLab Only)
        const authDoc = {
            email,
            gitlabId,
            isBlocked: false,
        };

        const authObj = { type: dbCollections.USER_AUTH, data: authDoc };
        const authRes = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, authObj, "save");

        // Update user status in company users
        if (invitedCompany) {
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
                logger.error(`Import notification setting error in gitlabSignup hook: ${error}`);
            });

            // Add notification count object
            await addAndRemoveUserInMongodbNotificationCount(assignCompany, authRes._id, "add").catch((error) => {
                logger.error(`Add user in mongodb notification count error in gitlabSignup hook: ${error}`);
            });
        }

        // Create User Document
        const userDoc = {
            _id: authRes._id,
            AssignCompany: invitedCompany ? [invitedCompany] : [],
            Employee_FName: firstName,
            Employee_LName: lastName,
            Employee_Email: email,
            Employee_Name: `${firstName} ${lastName}`,
            Time_Format: "12",
            isDeleted: false,
            isActive: true,
            isOnline: false,
            isEmailVerified: true, // GitLab email is already verified
        };

        const userObj = { type: dbCollections.USERS, data: userDoc };
        const userRes = await mongoRef.MongoDbCrudOpration(dbCollections.GLOBAL, userObj, "save");

        return res.status(200).json({
            status: true,
            message: "Gitlab signup successful",
            data: toAuthView(userRes),
        });
    } catch (error) {
        logger.error(`Gitlab Signup API Error: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: error.message || "Internal Server Error",
        });
    }
};