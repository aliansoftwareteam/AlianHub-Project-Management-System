const mongoC = require("../../utils/mongo-handler/mongoQueries")
const { dbCollections } = require('../../Config/collections');
const bcrypt = require('bcrypt');
const config = require("../../Config/config");
const logger = require("../../Config/loggerConfig");
const serviceCtr = require("../serviceFunction.js")
const sendMail = require("../service.js");
const { generateToken, verifyToken, generateJWTToken, removeCacheAndCookie } = require("../../Config/jwt.js");
const helperCtr = require("./helper.js");
const sesstionCtr = require("./session.js");
const mongoose = require("mongoose");
const { removeCache } = require("../../utils/commonFunctions.js");
const { updateUserFun } = require("../Users/controller.js");



exports.manageAttempt = (req, res) => {
    const forwarded = req?.headers['x-forwarded-for'] || req.ip;
    const clientIp = forwarded ? forwarded?.split(',')[0] : req?.connection?.remoteAddress;
    helperCtr.manageResetAttempt(clientIp, req.body, (mRes) => {
        if (!mRes.status) {
            res.status(mRes.statusCode).json({message: mRes.message});
            return;
        }
        res.status(400).json(req.errorMessageObject);
    });
};

/**
 * Check Permission
 * @param {Object} req 
 * @param {Object} res 
 * @returns 
 */
exports.removeUserNotification = (req,res) => {
    if (!(req.body && req.body.companyId)) {
        res.send({
            status: false,
            statusText: "CompanyId is required"
        })
        return;
    }
    if (!(req.body && req.body.userId)) {
        res.send({
            status: false,
            statusText: "UserId is required"
        })
        return;
    }

    let type = req.body.type !== undefined && req.body.type ? req.body.type : "Remove" 

    exports.addAndRemoveUserInMongodbNotificationCount(req.body.companyId,req.body.userId,type).then((response)=>{
        res.send(response)
    }).catch((error)=>{
        res.send(error);
    })
}

/**
 * Add And Remove User In Mongodb For NotificationCount
 * @param {Array} UserIds - User Ids which is need to update
 * @param {String} CompanyId - Company Id In which Count is need to update
 * @param {Object} Type - Type If it is Add Or Remove
 * @returns {Promise<String>} - Promuise which is return Response from db
 *                           Rejects with an error message if any issues occur during the Process.
 */
exports.addAndRemoveUserInMongodbNotificationCount = (companyId,userId,type) => {
    return new Promise((resolve, reject) => {
        try {
            if (type === 'Add') {
                let obj = {
                    type: dbCollections.USERID,
                    data: {
                        userId: userId
                    }
                }
                mongoC.MongoDbCrudOpration(companyId,obj,"save").then((res)=>{
                    resolve(({
                        status: true,
                        statusText: res
                    }))
                }).catch((error)=>{
                    reject(error)
                })
            } else {
                let obj = {
                    type: dbCollections.USERID,
                    data: [{
                        userId: userId
                    }]
                }
                mongoC.MongoDbCrudOpration(companyId,obj,"findOneAndDelete").then((res)=>{
                    resolve(({
                        status: true,
                        statusText: res
                    }))
                }).catch((error)=>{
                    reject(error)
                })
            }
        } catch (error) {
            reject(error);
        }
    })
}

exports.generateTokenV2Fun = (uid, refreshToken, cb) => {
    try {
        let object = {
            type: dbCollections.USERS,
            data: [
                {
                    _id: uid
                }
            ]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOne").then(async (response) => {
            if (!(response && response._id)) {
                cb({
                    status: false,
                    isLogout: true,
                    message: 'user not found.',
                });
                return;
            }
            if(!response.isEmailVerified){
                cb({
                    status: false,
                    isLogout: true,
                    isEmailVerified: false,
                    userData: response ?? null,
                    message: 'Email is not verified.',
                });
                return;
            }
            const companyIds = response.AssignCompany && response.AssignCompany.length ? response.AssignCompany : [];
            const token = await generateJWTToken({uid: uid, companyIds: companyIds, refreshToken});
            cb({
                status: true,
                message: "Jwt token generate successfully.",
                token: token
            });
        }).catch((error) => {
            logger.error(`Generate Jwt Token Error: ${error}`);
            cb({
                status: false, 
                error,
                isLogout: true,
                message: 'user not found.',
            });
        })
    } catch (error) {
        logger.error(`Generate Jwt Token Error: ${error}`);
        cb({
            status: false,
            isLogout: true,
            message: "Authentication failed!"
        });
    }
};


/**
 * Generate JWT Token V2 Function
 * @param {Object} req 
 * @param {Object} res 
 */
exports.generateTokenV2 = async (req, res) => {
    const refreshToken = req.headers['refresh-token'] || "";
    if (!(req.body && req.body.uid)) {
        res.status(400).json({
            status: false,
            statusText: "The user id is required."
        });
        return;
    }
    if (!refreshToken) {
        res.status(400).json({
            status: false,
            statusText: "Please provide a refresh token."
        });
        return;
    }
    const cacheKey = `session:${req.body.uid}:${refreshToken}`;
    try {   
        const validRefreshToken = verifyToken(refreshToken);
        if (!(validRefreshToken && validRefreshToken.status)) {
            removeCacheAndCookie("", cacheKey, res, refreshToken);
            res.status(400).json({message: "Your session is expired", isLogout: true});
            return;
        }
        exports.generateTokenV2Fun(req.body.uid, refreshToken, (gData) => {
            if (!(gData && gData.status)) {
                removeCacheAndCookie("", cacheKey, res, refreshToken);
                res.status(400).json(gData);
                return;
            }
            // TODO(P1-SEC-09): set httpOnly: true once the frontend stops
            // reading these cookies directly. Currently App.vue,
            // socketHelper.js, CreateCompany.vue, services/index.js, etc.
            // call Cookies.get('accessToken' | 'refreshToken'), so flipping
            // httpOnly here breaks socket auth and the refresh flow until
            // the frontend stores tokens in memory/localStorage (or the
            // backend switches to reading req.cookies via cookie-parser).
            const setCookie = {
                maxAge: serviceCtr.convertToSeconds(process.env.JWT_EXP)*1000,
                httpOnly: false,
                secure: config.NODE_ENV === "production",
                sameSite: config.NODE_ENV === "production" ? "Strict" : "Lax",
                domain: process.env.NODE_ENV === "production" ? req.hostname : undefined
            };
            res.cookie("accessToken", gData.token, { ...setCookie });
            res.json(gData);
        });
    } catch (error) {
        logger.error(`Generate Jwt Token Error: ${error}`);
        removeCacheAndCookie("", cacheKey, res, refreshToken);
        res.status(400).json({
            status: false,
            isLogout: true,
            message: "Authentication failed!"
        });
    }
};


/**
 * Insert Auth Function
 * @param {Object} reqData 
 * @param {Function} cb 
 */
exports.insertAuthFun = async (reqData, cb) => {
    try {
        if (!(reqData && reqData.email)) {
            cb({
                status: false,
                message: "Email is require"
            });
            return;
        }
        if (!(reqData && reqData.password)) {
            cb({
                status: false,
                message: "Password is require"
            });
            return;
        }
        const salt = await bcrypt.genSalt(10);
        let obj = {
            type: dbCollections.USER_AUTH,
            data: {
                email: reqData.email,
                passwordHash: await bcrypt.hash(reqData.password, salt)
            }
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "save").then(async (res)=>{
            const updateobj = {
                type: dbCollections.USER_AUTH,
                data: [{
                        email: reqData.email
                    }, {
                        passwordHash: await bcrypt.hash(res._id + reqData.password, salt)
                    }
                ]
            }
            mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, updateobj, "updateOne").then(()=>{
                cb({
                    status: true,
                    data: {...reqData, _id: res._id},
                })
            }).catch((uError) => {
                cb({
                    status: false,
                    message: serviceCtr.mongoErrorMessage(uError)
                });
            })
        }).catch((error)=>{
            cb({
                status: false,
                message: serviceCtr.mongoErrorMessage(error)
            });
        })
    } catch (error) {
        cb({
            status: false,
            message: error.message || error
        });
    }
};


/**
 * User Auth Function
 * @param {Object} req 
 * @param {Object} res 
 */
exports.registerAuth = (req, res) => {
    try {
        exports.insertAuthFun(req.body, (iUserRes) => {
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


/**
 * Verify Auth
 * @param {Object} reqData 
 * @param {Function} cb 
 * @returns 
 */
/**
 * BUG-039 / #93 — server-side verification for GitHub social login.
 *
 * The frontend completes the OAuth dance client-side and POSTs the
 * resulting `{ email, githubId }` pair to `/loginAuth`. Trusting that
 * pair blind means an attacker who knows a victim's email + numeric
 * GitHub id can authenticate as them.
 *
 * When the request carries `accessToken` (i.e. the OAuth access token
 * the GitHub authorize popup issues), we round-trip it through
 * `GET https://api.github.com/user` and reject the login unless the
 * id/email returned by GitHub matches what the client claimed. The
 * legacy id-only path stays for backwards compatibility but is gated
 * behind `GITHUB_OAUTH_REQUIRED=false` so operators can flip on the
 * stricter mode by clearing that env (the default is strict if an
 * accessToken is supplied).
 */
const verifyGithubAccessToken = async (accessToken) => {
    const https = require('https');
    return new Promise((resolve, reject) => {
        const req = https.request({
            host: 'api.github.com',
            path: '/user',
            method: 'GET',
            headers: {
                Authorization: `token ${accessToken}`,
                'User-Agent': 'AlianHub',
                Accept: 'application/vnd.github+json'
            },
            timeout: 8000
        }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`GitHub /user returned ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('GitHub /user timeout')));
        req.end();
    });
};

const verifyGithubAuth = async (reqData, cb) => {
    if (!reqData.githubId) {
        cb({ status: false, message: "githubId is required" });
        return;
    }

    // BUG-039 / #93 fix: if an access token is supplied, verify the
    // identity claim against GitHub before trusting any of the client-
    // supplied fields. Without this, anyone who knows {email, githubId}
    // for a target user can log in as them.
    if (reqData.accessToken) {
        try {
            const ghUser = await verifyGithubAccessToken(reqData.accessToken);
            if (String(ghUser.id) !== String(reqData.githubId)) {
                cb({ status: false, message: "GitHub identity verification failed (id mismatch)" });
                return;
            }
            if (ghUser.email && reqData.email && ghUser.email.toLowerCase() !== reqData.email.toLowerCase()) {
                cb({ status: false, message: "GitHub identity verification failed (email mismatch)" });
                return;
            }
        } catch (error) {
            cb({ status: false, message: `GitHub identity verification failed: ${error.message}` });
            return;
        }
    } else if (process.env.GITHUB_OAUTH_REQUIRED !== 'false') {
        // Strict mode (default): refuse the legacy "trust client-supplied
        // id" path. Operators on legacy clients can opt out with
        // GITHUB_OAUTH_REQUIRED=false while they ship a frontend update.
        cb({ status: false, message: "accessToken is required for GitHub login" });
        return;
    }

    try {
        const obj = {
            type: dbCollections.USER_AUTH,
            data: [{ email: reqData.email }],
        };

        const resData = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne");
        if (!resData?._id) {
            cb({ status: false, message: "User not found" });
            return;
        }

        if (resData.isBlocked) {
            cb({
                status: false,
                message: "Your email has been blocked. Please contact the administrator.",
            });
            return;
        }

        // Link githubId if not set
        if (!resData.githubId) {
            const updateObject = {
                type: dbCollections.USER_AUTH,
                data: [
                    { email: reqData.email },
                    { githubId: reqData.githubId },
                ],
            };
            await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, updateObject, "findOneAndUpdate");
        }

        cb({
            status: true,
            data: resData,
            message: "Github login successful",
        });
    } catch (error) {
        cb({ status: false, message: serviceCtr.mongoErrorMessage(error) });
    }
};

/**
 * BUG-039 / #93 — server-side verification for Google social login.
 *
 * Same threat model as the GitHub case: trusting a client-supplied
 * `{email, googleId}` lets anyone with the victim's Google id stand
 * in as them. When the request carries an `idToken` (the JWT the
 * Google Sign-In flow returns), verify it via google-auth-library:
 * the library checks the signature, audience, and expiry, then
 * exposes the canonical `sub` (= googleId) and `email` from the
 * verified payload — those are the values we trust.
 *
 * `GOOGLE_OAUTH_CLIENT_ID` must be set to enable strict verification.
 * If it's unset we keep the legacy id-only path so existing
 * deployments don't hard-break on upgrade, but we log a warning so
 * operators see they're running unhardened.
 */
const verifyGoogleIdToken = async (idToken) => {
    const { OAuth2Client } = require('google-auth-library');
    const audience = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!audience) {
        throw new Error('GOOGLE_OAUTH_CLIENT_ID not configured');
    }
    const client = new OAuth2Client(audience);
    const ticket = await client.verifyIdToken({ idToken, audience });
    return ticket.getPayload();
};

const verifyGoogleAuth = async (reqData, cb) => {
    if (!reqData.googleId) {
        cb({ status: false, message: "GoogleId is required" });
        return;
    }

    // BUG-039 / #93 fix: prefer the verified id-token payload over
    // anything the client tells us.
    if (reqData.idToken && process.env.GOOGLE_OAUTH_CLIENT_ID) {
        try {
            const payload = await verifyGoogleIdToken(reqData.idToken);
            if (!payload || !payload.sub) {
                cb({ status: false, message: "Google identity verification failed" });
                return;
            }
            if (String(payload.sub) !== String(reqData.googleId)) {
                cb({ status: false, message: "Google identity verification failed (sub mismatch)" });
                return;
            }
            if (payload.email && reqData.email && payload.email.toLowerCase() !== reqData.email.toLowerCase()) {
                cb({ status: false, message: "Google identity verification failed (email mismatch)" });
                return;
            }
        } catch (error) {
            cb({ status: false, message: `Google identity verification failed: ${error.message}` });
            return;
        }
    } else if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_REQUIRED !== 'false') {
        cb({ status: false, message: "idToken is required for Google login" });
        return;
    } else if (!process.env.GOOGLE_OAUTH_CLIENT_ID) {
        const logger = require("../../Config/loggerConfig");
        logger.warn("Google login: GOOGLE_OAUTH_CLIENT_ID not configured — running unhardened (BUG-039).");
    }

    try {
        const obj = {
            type: dbCollections.USER_AUTH,
            data: [{ email: reqData.email }],
        };

        const resData = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne");
        if (!resData?._id) {
            cb({ status: false, message: "User not found" });
            return;
        }

        if (resData.isBlocked) {
            cb({
                status: false,
                message: "Your email has been blocked. Please contact the administrator.",
            });
            return;
        }

        // Link googleId if not set
        if (!resData.googleId) {
            const updateObject = {
                type: dbCollections.USER_AUTH,
                data: [
                    { email: reqData.email },
                    { googleId: reqData.googleId },
                ],
            };
            await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, updateObject, "findOneAndUpdate");
        }

        cb({
            status: true,
            data: resData,
            message: "Google login successful",
        });
    } catch (error) {
        cb({ status: false, message: serviceCtr.mongoErrorMessage(error) });
    }
};

const verifyLocalAuth = async (reqData, cb) => {
    if (!reqData.password) {
        cb({ status: false, message: "Password is required" });
        return;
    }

    try {
        const obj = {
            type: dbCollections.USER_AUTH,
            data: [{ email: reqData.email }],
        };

        const resData = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne");
        if (!resData?._id) {
            cb({ status: false, message: "User not found" });
            return;
        }

        if (resData.isBlocked) {
            cb({
                status: false,
                message: "Your email has been blocked. Please contact the administrator.",
            });
            return;
        }

        // If no password set → send reset link
        if (!resData.passwordHash) {
            const token = generateToken(600);
            const updateObject = {
                type: dbCollections.USER_AUTH,
                data: [{ email: reqData.email }, { token }],
            };

            const resUData = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, updateObject, "findOneAndUpdate");
            if (!resUData?._id) {
                cb({ status: false, message: "User not found" });
                return;
            }

            let link = `${config.WEBURL}/#/set-new-password/${token}`;
            if (reqData.isLoginType === "admin") {
                link = `${config.WEBURL}/admin/#/set-new-password/${token}`;
            }

            const mail = require("../Template/passwordExpiredMail")(reqData.email, link);
            sendMail.SendEmail(mail.subject, mail.mail, reqData.email, true, (result) => {
                if (result.status) {
                    cb({
                        status: true,
                        data: resData,
                        isResetPassword: true,
                    });
                } else {
                    cb({
                        status: false,
                        message: "Reset password mail was not sent",
                    });
                }
            });
            return;
        }

        // Validate password
        const checkPassword = resData._id + reqData.password;
        const isValid = await bcrypt.compare(checkPassword, resData.passwordHash);
        if (!isValid) {
            cb({
                status: false,
                message: "Your password is invalid. Please check and try again",
            });
            return;
        }

        cb({
            status: true,
            data: { ...reqData, _id: resData._id },
            message: "User Login Successfully",
        });
    } catch (error) {
        cb({ status: false, message: serviceCtr.mongoErrorMessage(error) });
    }
};

exports.verifyAuth = (reqData, cb) => {
    try {
        if (!(reqData && reqData.email)) {
            cb({ status: false, message: "Email is required" });
            return;
        }

        if (reqData.authProvider === "google") {
            verifyGoogleAuth(reqData, cb);
        } else if (reqData.authProvider === "github") {
            verifyGithubAuth(reqData, cb);
        } else {
            verifyLocalAuth(reqData, cb);
        }
    } catch (error) {
        cb({ status: false, message: error.message || error });
    }
};

/**
 * Login Auth
 * @param {Object} req 
 * @param {Object} res 
 */
exports.loginAuth = (req, res, next) => {
    try {
        exports.verifyAuth(req.body, (lUserRes) => {
            if (lUserRes.status) {
                if (lUserRes.isResetPassword) {
                    res.status(200).json({
                        uid: lUserRes.data._id,
                        isResetPassword: lUserRes.isResetPassword
                    });
                    return;
                }
                const forwarded = req?.headers['x-forwarded-for'] || req.ip;
                const clientIp = forwarded ? forwarded?.split(',')[0] : req?.connection?.remoteAddress;
                sesstionCtr.insertSessionFun({userId: lUserRes.data._id}, req.headers['user-agent'] || "", clientIp, (sData) => {
                    if (!(sData && sData.status)) {
                        req.errorMessageObject = {message: "unauthorize user"};
                        next();
                        return;
                    }
                    exports.generateTokenV2Fun(lUserRes.data._id, sData.data.refreshToken, (gData) => {
                        if (!(gData && gData.status)) {
                            req.errorMessageObject = gData;
                            next();
                            return;
                        }
                        // TODO(P1-SEC-09): see matching comment near login.
                        // Set httpOnly: true once the frontend no longer
                        // reads these cookies with js-cookie.
                        const setCookie = {
                            maxAge: serviceCtr.convertToSeconds(process.env.JWT_EXP)*1000,
                            httpOnly: false,
                            secure: config.NODE_ENV === "production",
                            sameSite: config.NODE_ENV === "production" ? "Strict" : "Lax",
                            domain: process.env.NODE_ENV === "production" ? req.hostname : undefined,
                        };
                        res.cookie("refreshToken", sData.data.refreshToken, { ...setCookie, maxAge: Number(process.env.SESSIONEXPIREDTIME || 172800)*1000 });
                        res.cookie("accessToken", gData.token, { ...setCookie });
                        res.status(200).json({
                            uid: lUserRes.data._id,
                            refreshToken: sData.data.refreshToken,
                            accessToken: gData.token
                        });
                    });
                });
                return;
            }
            req.errorMessageObject = {message: lUserRes.message};
            next();
        });
    } catch (error) {
        req.errorMessageObject = {message: error.message ? error.message : error};
        next();
    }
};

/**
 * Tracker login Auth
 * @param {Object} req 
 * @param {Object} res 
 */
exports.loginAuthTracker = (req,res) => {
    try {
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{
                refreshToken: req.body.refreshToken
            }]
        }
        
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne").then(async (sessionData)=>{
            if (sessionData) {
                const forwarded = req?.headers['x-forwarded-for'] || req.ip;
                const clientIp = forwarded ? forwarded?.split(',')[0] : req?.connection?.remoteAddress;
                sesstionCtr.insertSessionFun({userId: sessionData.userId}, req.headers['user-agent'] || "", clientIp, (sData) => {
                    if (!(sData && sData.status)) {
                        res.status(400).json({message: 'Invalid Refresh Token'})
                        return;
                    }
                    exports.generateTokenV2Fun(sessionData.userId, sData.data.refreshToken, (gData) => {
                        if (!(gData && gData.status)) {
                            res.status(400).json({message: 'Invalid Refresh Token'})
                            return;
                        }
                        res.status(200).json({
                            uid: sessionData.userId,
                            refreshToken: sData.data.refreshToken,
                            accessToken: gData.token
                        });
                    });
                });
                return;
            } else {
                res.status(400).json({message: 'Invalid Refresh Token'})
            }
        })
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
}


/**
 * Change Password
 * @param {Object} req 
 * @param {Object} res 
 */
exports.changePassword = async (req, res) => {
    try {
        const reqData = req.body;
        if (!(req.params && req.params.id)) {
            res.status(400).json({message: "user id is require"});
            return;
        }
        if (!(reqData && reqData.oldPassword)) {
            res.status(400).json({message: "Old Password is require"});
            return;
        }
        if (!(reqData && reqData.newPassword)) {
            res.status(400).json({message: "New Password is require"});
            return;
        }
        let obj = {
            type: dbCollections.USER_AUTH,
            data: [{
                _id: req.params.id
            }]
        }
        
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne").then(async (resUserData)=>{
            if (!(resUserData && resUserData._id)) {
                res.status(400).json({message: "user not found"});
                return;
            }
            const checkOldPass = resUserData._id + reqData.oldPassword;
            const isValid = await bcrypt.compare(checkOldPass, resUserData.passwordHash);
            if (!isValid) {
                res.status(400).json({message: "Auth.previous_wasnot_valid"});
                return;
            }

            const salt = await bcrypt.genSalt(10);
            const checkNewPass = resUserData._id + reqData.newPassword;
            const passwordHash = await bcrypt.hash(checkNewPass, salt);
            const isNewValid = await bcrypt.compare(checkNewPass, passwordHash);
            if (!isNewValid) {
                res.status(400).json({message: "Auth.password_wasnot_valid"});
                return;
            }
            let object = {
                type: dbCollections.USER_AUTH,
                data: [
                    {
                        _id: req.params.id
                    },
                    {
                        passwordHash: passwordHash
                    }
                ]
            }
            mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOneAndUpdate").then(()=>{
                res.status(200).json({
                    status: true,
                    message: "Your password has been successfully changed."
                });
            }).catch((error)=>{
                res.status(400).json({message: serviceCtr.mongoErrorMessage(error)});
            })
        }).catch((error)=>{
            res.status(400).json({message: serviceCtr.mongoErrorMessage(error)});
        })
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};

exports.sendForgotPassword = (req, res, next) => {
    try {
        const reqData = req.body;
        const token = generateToken(600); // 10 minute
        let object = {
            type: dbCollections.USER_AUTH,
            data: [{
                email: reqData.email
            },{
                token: token
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOneAndUpdate").then((resData) => {
            if (!(resData && resData._id)) {
                req.errorMessageObject = {message: "user not found."};
                next();
                return;
            }
            let link = `${config.WEBURL}/#/reset-password/${token}`;
            if (reqData.key === "admin") {
                link = `${config.WEBURL}/admin/#/reset-password/${token}`;
            }
            let mail = require("../Template/forgotPassword")(reqData.email, link);
            sendMail.SendEmail(mail.subject, mail.mail, reqData.email, true, (result) => {
                if (result.status) {
                    res.status(200).json({
                        status: true,
                        message: "Forgot Password Email sent successfully."
                    });
                } else {
                    req.errorMessageObject = {message: result.error};
                    next();
                }
            });
        }).catch((error) => {
            req.errorMessageObject = {message: serviceCtr.mongoErrorMessage(error)};
            next();
        })
    } catch (error) {
        req.errorMessageObject = {message: error.message ? error.message : error};
        next();
    }
};


/**
 * Forgot Password
 * @param {Object} req 
 * @param {Object} res 
 */
exports.forgotPassword = (req, res, next) => {
    try {
        const reqData = req.body;
        if (!(reqData && reqData.email)) {
            res.status(400).json({message: `email is required`});
            return;
        }
        exports.sendForgotPassword(req, res, next);
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};


/**
 * Token Verfiy Forgot Password
 * @param {Object} req 
 * @param {Object} res 
 * @returns 
 */
exports.tokenVerfiyForgotPassword = (req, res) => {
    try {
        const reqData = req.body;
        const isValid = verifyToken(reqData.token);
        if (!isValid.status) {
            res.status(400).json({message: isValid.statusText, key: isValid.key});
            return;
        }
        let object = {
            type: dbCollections.USER_AUTH,
            data: [{
                token: reqData.token
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOne").then((resData) => {
            if (!(resData && resData._id)) {
                res.status(400).json({message: "user not found", key: 5});
                return;
            }
            res.status(200).json({
                status: true,
                data: {
                    _id: resData._id,
                    email: resData.email
                }
            });
        }).catch((error) => {
            res.status(400).json({message: serviceCtr.mongoErrorMessage(error)});
        })
    } catch (error) {
        res.status(400).json({message: error.message ? error.message : error});
    }
};


/**
 * Reset Password
 * @param {Object} req 
 * @param {Object} res 
 */
exports.resetPassword = async (req, res, next) => {
    try {
        const reqData = req.body;
        const isValid = verifyToken(reqData.token);
        if (!isValid.status) {
            req.errorMessageObject = {message: isValid.statusText, key: isValid.key};
            next();
            return;
        }
        // Security fix: validate token against DB to prevent token reuse after reset
        // JWT signature alone is not sufficient — the stored token must match exactly.
        // After a successful reset, token is cleared (""), so any replay is rejected.
        const tokenRecord = await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.USER_AUTH,
            data: [{ _id: reqData.id, token: reqData.token }]
        }, "findOne");
        if (!(tokenRecord && tokenRecord._id)) {
            req.errorMessageObject = {message: "Reset link is invalid or has already been used.", key: 5};
            next();
            return;
        }
        const salt = await bcrypt.genSalt(10);
        const setNewPass = reqData.id + reqData.password;
        const passwordHash = await bcrypt.hash(setNewPass, salt);
        const isNewValid = await bcrypt.compare(setNewPass, passwordHash);
        if (!isNewValid) {
            req.errorMessageObject = {message: "Auth.password_wasnot_valid"};
            next();
            return;
        }
        let object = {
            type: dbCollections.USER_AUTH,
            data: [
                {
                    _id: reqData.id
                },
                {
                    passwordHash: passwordHash,
                    token: ""
                }
            ]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, object, "findOneAndUpdate").then(()=>{
            let object = {
                type: dbCollections.USERS,
                data: [
                    {
                        _id: reqData.id
                    },
                    {
                        verificationToken: "",
                        isEmailVerified: true
                    }
                ]
            }
            updateUserFun(dbCollections.GLOBAL,object,"findOneAndUpdate").then(()=>{
                res.status(200).json({
                    status: true,
                    message: "Your password has been successfully changed."
                });
            }).catch((error)=>{
                req.errorMessageObject = {message: error.message ? error.message : error};
                next();
            })
        }).catch((error)=>{
            req.errorMessageObject = {message: serviceCtr.mongoErrorMessage(error)};
            next();
        })
    } catch (error) {
        req.errorMessageObject = {message: error.message ? error.message : error};
        next();
    }
};


/**
 * Logout Function
 * @param {Object} req 
 * @param {Object} res 
 */
exports.logout = (req, res) => {
    sesstionCtr.removeSession(req, async(data) => {
        if (!data.status) {
            res.status(400).json({
                message: data.message
            });
            return;
        }
        const deleteCookie = { 
            domain: process.env.NODE_ENV === "production" ? req.hostname : undefined,
            expires: new Date(0)
        }
        const updateData = [
            { _id: new mongoose.Types.ObjectId(req.body.id) },
            {
                $set: { isOnline: false, lastActive: new Date() }
            }
        ];
        let obj = {
            type: dbCollections.USERS,
            data: updateData
        }
        const cacheKey = `UserData:${req.body.id}`;
        await mongoC.MongoDbCrudOpration('global', obj, "updateOne");         
        removeCache(cacheKey)
        removeCache('UserAllData:',true)
            
        res.cookie("accessToken","deleted",{...deleteCookie})
        res.cookie("refreshToken","deleted",{...deleteCookie})
        
        res.status(200).json({
            status: true,
            message: data
        });
    });
};


exports.testV2 = (req, res) => {
    res.json(req.body);
}