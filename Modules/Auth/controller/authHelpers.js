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
 * Server-side verification for GitLab social login — same threat model as
 * GitHub/Google: never trust the client-supplied {email, gitlabId}. When an
 * accessToken is supplied we round-trip it through GitLab's /user API and
 * reject the login unless the id/email returned by GitLab match the claim.
 * GITLAB_BASE_API_URL lets self-managed instances point at their own host.
 */
const verifyGitlabAccessToken = async (accessToken) => {
    const axios = require('axios');
    const apiBase = process.env.GITLAB_BASE_API_URL || 'https://gitlab.com/api/v4';
    const response = await axios.get(`${apiBase}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 8000,
    });
    return response.data;
};

const verifyGitlabAuth = async (reqData, cb) => {
    if (!reqData.gitlabId) {
        cb({ status: false, message: "gitlabId is required" });
        return;
    }

    if (reqData.accessToken) {
        try {
            const glUser = await verifyGitlabAccessToken(reqData.accessToken);
            if (String(glUser.id) !== String(reqData.gitlabId)) {
                cb({ status: false, message: "GitLab identity verification failed (id mismatch)" });
                return;
            }
            if (glUser.email && reqData.email && glUser.email.toLowerCase() !== reqData.email.toLowerCase()) {
                cb({ status: false, message: "GitLab identity verification failed (email mismatch)" });
                return;
            }
        } catch (error) {
            cb({ status: false, message: `GitLab identity verification failed: ${error.message}` });
            return;
        }
    } else if (process.env.GITLAB_OAUTH_REQUIRED !== 'false') {
        cb({ status: false, message: "accessToken is required for GitLab login" });
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

        // Link gitlabId if not set
        if (!resData.gitlabId) {
            const updateObject = {
                type: dbCollections.USER_AUTH,
                data: [
                    { email: reqData.email },
                    { gitlabId: reqData.gitlabId },
                ],
            };
            await mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, updateObject, "findOneAndUpdate");
        }

        cb({
            status: true,
            data: resData,
            message: "Gitlab login successful",
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
// The Google client id used to verify the id-token's audience. Historically
// this read GOOGLE_OAUTH_CLIENT_ID, but the token exchange and the settings UI
// use GOOGLE_CLIENT_ID — so an operator who configured the latter left
// verification silently disabled. Accept either name (prefer the explicit
// OAuth one) so one configured value hardens the whole flow.
const getGoogleAudience = () => process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';

const verifyGoogleIdToken = async (idToken) => {
    const { OAuth2Client } = require('google-auth-library');
    const audience = getGoogleAudience();
    if (!audience) {
        throw new Error('Google client id not configured (set GOOGLE_CLIENT_ID)');
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
    const googleAudience = getGoogleAudience();
    if (reqData.idToken && googleAudience) {
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
    } else if (googleAudience && process.env.GOOGLE_OAUTH_REQUIRED !== 'false') {
        cb({ status: false, message: "idToken is required for Google login" });
        return;
    } else if (!googleAudience) {        logger.warn("Google login: client id not configured (GOOGLE_CLIENT_ID) — running unhardened (BUG-039).");
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

            const mail = require("../../Template/passwordExpiredMail")(reqData.email, link);
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
            // twoFactorEnabled tells loginAuth whether to gate this login behind
            // the TOTP second-step. Password login only (Phase 1); the OAuth
            // paths don't set it, so they are unaffected.
            data: { ...reqData, _id: resData._id, twoFactorEnabled: !!(resData.twoFactor && resData.twoFactor.enabled) },
            message: "User Login Successfully",
        });
    } catch (error) {
        cb({ status: false, message: serviceCtr.mongoErrorMessage(error) });
    }
};

/**
 * User Auth Function
 * @param {Object} req 
 * @param {Object} res 
 */

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
        } else if (reqData.authProvider === "gitlab") {
            verifyGitlabAuth(reqData, cb);
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
            let mail = require("../../Template/forgotPassword")(reqData.email, link);
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
