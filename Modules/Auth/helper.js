const { default: mongoose } = require("mongoose");
const mongoC = require("../../utils/mongo-handler/mongoQueries")
const { dbCollections } = require("../../Config/collections.js");
const logger = require("../../Config/loggerConfig.js");
const sendMail = require("../service.js");
const serviceCtr = require("../serviceFunction.js")

const replacers = {
    "objId": (value) => {
        const tmp = {};
        Object.keys(value).forEach(key =>{
            if(Array.isArray(value[key])) {
                tmp[key] = value[key].map((val) => {
                    return new mongoose.Types.ObjectId(val);
                });
            } else {
                tmp[key] = new mongoose.Types.ObjectId(value[key]);
            }
        })

        return tmp;
    },
    "dbDate": (value) => {
        let tmp = {};
        Object.keys(value).forEach(key =>{
            if(Array.isArray(value[key])) {
                tmp[key] = value[key].map((val) => {
                    return new Date(val);
                });
            } else {
                tmp[key] = new Date(value[key]);
            }
        })

        return tmp;
    },
    "dbDate_getTime": (value) => {
        let tmp = {};
        Object.keys(value).forEach(key =>{
            if(Array.isArray(value[key])) {
                tmp[key] = value[key].map((val) => {
                    return new Date(val).getTime() / 1000;
                });
            } else {
                tmp[key] = new Date(value[key]).getTime() / 1000;
            }
        })

        return tmp;
    }
}

function replaceKey(value, updateFunction, searchKey) {
    let tmp = {};

    if(updateFunction) {
        tmp = updateFunction(value);
    } else {
        tmp = replacers[searchKey](value);
    }

    return tmp;
}

exports.replaceObjectKey = (value, searchKey, updateFunction = undefined) => {
    let tmp = value

    if(!searchKey?.length) return value;
    if(typeof value === "object" && !Array.isArray(value)) {
        for (const key in value) {
            if (Object.hasOwnProperty.call(value, key)) {
                const element = value[key];
                const condition = typeof searchKey === 'string' ? searchKey === key : searchKey.find((x) => x === key);
                if(condition) {
                    tmp = {
                        ...tmp,
                        ...replaceKey(element, updateFunction, key)
                    }

                    delete tmp[key]
                } else {
                    tmp = {
                        ...tmp,
                        [key]: exports.replaceObjectKey(element, searchKey, updateFunction)
                    }
                }
            }
        }
    } else if(Array.isArray(value)) {
        tmp = value.map((x) => {
            x = exports.replaceObjectKey(x, searchKey, updateFunction);

            return x;
        })
    } else {
        tmp = value;
    }

    return tmp;
}

exports.relapceUndefinedvals = (obj) => {
    if (Array.isArray(obj)) {
        return obj.map(item => exports.relapceUndefinedvals(item));
    } else if (typeof obj === 'object' && obj !== null) {
        const result = {};
        Object.keys(obj).forEach(key => {
            result[key] = exports.relapceUndefinedvals(obj[key]);
        });
        return result;
    } else {
        return obj === '_undefined_' ? undefined : obj;
    }
}

exports.sendTooManyRequestMail = (ip, data) => {
    try {
        let object = {
            type: dbCollections.USERS,
            data: [{
                $or: [
                    { Employee_Email: data.email || "" },
                    { _id: data?.id ? data.id: null }
                ]
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOne").then((resData) => {
            if (!(resData && resData._id)) {
                logger.error(`Send Too Many Request User Not Found Error`);
                return;
            }
            let mail = require("../Template/securityAlertMail.js")(resData.Employee_Name, ip);
            sendMail.SendEmail(mail.subject, mail.mail, resData.Employee_Email, true, (result) => {
                if (result.status) {
                    let uobject = {
                        type: dbCollections.RESET_ATTEMPT,
                        data: [
                            {
                                ip: ip
                            },
                            {
                                isSendMail: false
                            }
                        ]
                    }
                    mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, uobject, "findOneAndUpdate").then(()=>{
                        logger.info("Send Security Alert Mail Successfully");
                    }).catch((error)=>{
                        logger.error(`Send Too Many Request Mongo Update Reset Error: ${serviceCtr.mongoErrorMessage(error)}`);
                    })
                    // logger.info("Send Security Alert Mail Successfully");
                } else {
                    logger.error(`Send Too Many Request Email Send Error: ${result.error}`);
                }
            });
        }).catch((error) => {
            logger.error(`Send Too Many Request Mongo Error: ${serviceCtr.mongoErrorMessage(error)}`);
        })
    } catch (error) {
        logger.error(`Send Too Many Request Error: ${error.message || error}`);
    }
}


/**
 * Auth rate-limit configuration (BUG-012 / #66 fix).
 *
 * The previous implementation hard-coded 9 attempts inside a 10-minute
 * window with a 10-minute block — permissive enough to let a patient
 * attacker grind ~9 attempts per IP per 10 minutes indefinitely. The
 * variable name (`fiveMinutes`) also disagreed with its value (10 min).
 *
 * Move the three knobs to environment variables with safer defaults:
 *   - AUTH_RATE_LIMIT_MAX_ATTEMPTS    default 5
 *   - AUTH_RATE_LIMIT_WINDOW_MS       default 15 min
 *   - AUTH_RATE_LIMIT_BLOCK_MS        default 30 min
 *
 * Read at request time so an operator can adjust without restarting.
 * Exported for the regression test at .claude/tests/test-bug-012.js.
 */
exports.getRateLimitConfig = () => ({
    MAX_ATTEMPTS: Math.max(1, Number(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS) || 5),
    WINDOW_MS: Math.max(1000, Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000),
    BLOCK_MS: Math.max(1000, Number(process.env.AUTH_RATE_LIMIT_BLOCK_MS) || 30 * 60 * 1000),
});

exports.manageResetAttempt = (ip, data, cb) => {
    try {
        const { MAX_ATTEMPTS, WINDOW_MS, BLOCK_MS } = exports.getRateLimitConfig();
        const managecount = (attempt) => {
            const now = new Date();
            // Check if the user is blocked
            if (attempt.isSendMail === true) {
                exports.sendTooManyRequestMail(ip, data);
            }
            if (attempt.blockedUntil && now < attempt.blockedUntil) {
                return {
                    status: false,
                    message: "Auth.too_many_request"
                };
            }

            // Reset the attempt count if the rolling window has passed
            // since the first attempt in this series.
            if (attempt.firstAttemptTime && (now - attempt.firstAttemptTime > WINDOW_MS)) {
                attempt.attempts = 0;
                attempt.firstAttemptTime = now;
                attempt.blockedUntil = null;
            }

            // Increment attempts and check limit
            attempt.attempts += 1;
            if (attempt.attempts >= MAX_ATTEMPTS) {
                attempt.blockedUntil = new Date(now.getTime() + BLOCK_MS);
                attempt.attempts = 0; // Reset attempt count after blocking
                attempt.firstAttemptTime = null; // Clear the first attempt time after blocking
            }

            return {
                status: true,
                attempt: attempt
            }
        }
        let aobject = {
            type: dbCollections.RESET_ATTEMPT,
            data: [{
                ip: ip
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, aobject, "findOne").then((aresData) => {
            if (!(aresData && aresData._id)) {
                const attempt = managecount({
                    attempts: 0,
                    blockedUntil: null,
                    firstAttemptTime: new Date()
                });
                if (!attempt.status) {
                    cb({
                        status: false,
                        statusCode: 429,
                        message: "Auth.too_many_request"
                    });
                    return;
                }
                let obj = {
                    type: dbCollections.RESET_ATTEMPT,
                    data: {
                        ...attempt.attempt,
                        isSendMail: false,
                        ip: ip,
                    }
                }
                mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "save").then(()=> {
                    if (attempt.blockedUntil) {
                        cb({
                            status: false,
                            statusCode: 429,
                            message: "Auth.too_many_request"
                        });
                        return;
                    }
                    cb({
                        status: true
                    });
                }).catch((error)=>{
                    cb({
                        status: false,
                        statusCode: 400,
                        message: serviceCtr.mongoErrorMessage(error)
                    });
                })
                return;
            }
            const attempt = managecount({
                attempts: aresData.attempts,
                blockedUntil: aresData.blockedUntil,
                firstAttemptTime: aresData.firstAttemptTime,
                isSendMail: aresData.isSendMail
            });
            if (!attempt.status) {
                cb({
                    status: false,
                    statusCode: 429,
                    message: "Auth.too_many_request"
                });
                return;
            }
            let uobject = {
                type: dbCollections.RESET_ATTEMPT,
                data: [
                    {
                        ip: ip
                    },
                    {
                        ...attempt.attempt,
                        isSendMail: attempt.attempt.attempts == 0 ? true : false
                    }
                ]
            }
            mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, uobject, "findOneAndUpdate").then(()=>{
                cb({
                    status: true
                })
            }).catch((error)=>{
                cb({
                    status: false,
                    statusCode: 400,
                    message: serviceCtr.mongoErrorMessage(error)
                });
            })
        }).catch((error) => {
            cb({
                status: false,
                statusCode: 400,
                message: serviceCtr.mongoErrorMessage(error)
            });
        })
    } catch (error) {
        cb({
            status: false,
            statusCode: 400,
            message: error.message || error
        });
    }
};
