const jwt = require('jsonwebtoken');
const logger = require("./loggerConfig");
const mongoC = require("../utils/mongo-handler/mongoQueries");
const { dbCollections } = require("../Config/collections.js");
const {myCache} = require('./config');

// Mongo ObjectId pattern — used to reject regex/control characters in the
// `companyid` request header before any token-membership check.
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

// Strict membership check against a JWT `aud` claim that may be a comma-joined
// string (current shape — see `generateJWTToken`) or an array. Replaces the
// previous `new RegExp(companyId)` audience option, which let header values
// like `.*` match any audience and cross tenants.
const isCompanyInAudience = (audClaim, companyId) => {
    if (!audClaim || !companyId) return false;
    const list = Array.isArray(audClaim)
        ? audClaim
        : String(audClaim).split(',');
    const target = String(companyId).trim();
    return list.some((entry) => String(entry).trim() === target);
};


const generateToken = (time) => {
    return jwt.sign({}, process.env.JWT_SECRET, {
        algorithm: process.env.JWT_ALGORITHM,
        expiresIn: time || process.env.JWT_EXP,
    });
};


/**
 * generate JWT auth token
 * @param {Object} obj 
 * @returns 
 */
const generateJWTToken = (obj) => {
    const companyIds = [...obj.companyIds];
    delete obj.companyIds;
    logger.info(`companyIds ${companyIds.join(',')}`);
    return jwt.sign({...obj}, process.env.JWT_SECRET, {
        audience: companyIds.join(','),
        algorithm: process.env.JWT_ALGORITHM,
        expiresIn: process.env.JWT_EXP,
    });
};

const removeCacheAndCookie = (key, cacheKey, res, refreshToken) => {
    if (key === "accessToken") {
        res.clearCookie('accessToken');
        return;
    }
    myCache.del(cacheKey);
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    if (refreshToken) {
        let obj = {
            type: dbCollections.SESSIONS,
            data: [{
                refreshToken: refreshToken,
            }]
        }
        mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "deleteMany").then((resData)=>{
            if (!(resData && resData.deletedCount)) {
                logger.error("refresh token not found");
                return;
            }
        }).catch((error)=>{
            logger.error(`Refresh Token Remove Error ${error.message || error}`);
        })
    }
}

const checkToken = (isValid, req, res, next) => {
    if (isValid) {
        const { uid, refreshToken,aud } = isValid;
        req.uid = uid;
        req.aud = aud;
        req.body.refreshToken = refreshToken; 
        const cacheKey = `session:${uid}:${refreshToken}`;
        const value = myCache.get(cacheKey);
        try {
            if (value) {
                const isRefreshTokenValid = jwt.verify(refreshToken, process.env.JWT_SECRET);
                if (isRefreshTokenValid) {
                    req.uid = uid;
                    next();
                } else {
                    removeCacheAndCookie("", cacheKey, res, refreshToken);
                    // Access Denied
                    return res.status(401).json({
                        status: false,
                        error: 'Refresh Token has expired',
                        statusText: 'Refresh Token has expired',
                        isRefreshTokenError: true,
                        isJwtError: true,
                        isLogout: true
                    });
                }
            } else {
                let obj = {
                    type: dbCollections.SESSIONS,
                    data: [{
                        userId: uid,
                        refreshToken: refreshToken,
                    }]
                }
                mongoC.MongoDbCrudOpration(dbCollections.GLOBAL, obj, "findOne").then((resData)=>{
                    if (!(resData && resData._id)) {
                        removeCacheAndCookie("", cacheKey, res, refreshToken);
                        return res.status(401).json({
                            status: false,
                            error: "Your session is expired",
                            statusText: 'Unauthorized',
                            isJwtError: true,
                            isRefreshTokenError: true,
                            isLogout: true
                        });
                    }
                    const isRefreshTokenValid = jwt.verify(refreshToken, process.env.JWT_SECRET);
                    if (isRefreshTokenValid) {
                        myCache.set(cacheKey, JSON.stringify({_id: resData._id, userId: uid, refreshToken: refreshToken}), 600);
                        req.uid = uid;
                        next();
                    } else {
                        removeCacheAndCookie("", cacheKey, res, refreshToken);
                        // Access Denied
                        return res.status(401).json({
                            status: false,
                            error: 'Refresh Token has expired',
                            statusText: 'Refresh Token has expired',
                            isRefreshTokenError: true,
                            isJwtError: true,
                            isLogout: true
                        });
                    }
                }).catch((error)=>{
                    removeCacheAndCookie("", cacheKey, res, refreshToken);
                    return res.status(401).json({
                        status: false,
                        error: error.message,
                        statusText: 'Unauthorized',
                        isJwtError: true,
                        isRefreshTokenError: true,
                        isLogout: true
                    });
                })
            }
        } catch (error) {
            removeCacheAndCookie("", cacheKey, res, refreshToken);
            return res.status(401).json({
                status: false,
                error: error.message,
                statusText: 'Unauthorized',
                isJwtError: true,
                isRefreshTokenError: true,
                isLogout: true
            });
        }
    } else {
        removeCacheAndCookie("accessToken", "", res);
        // Access Denied
        return res.status(401).json({
            status: false,
            error: 'Token has expired',
            statusText: 'Token has expired',
            isJwtError: true
        });
    }
}

/**
 * Verify JWT Auth token is valid or not
 * @param {Object} req
 * @param {Object} res
 * @param {Object} next
 * @returns 
 */
const verifyJWTTokenWithC = (req, res, next) => {
    try {
        let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
        const companyId = req.headers['companyid'] || "";
        if (!companyId) {
            return res.status(401).json({
                status: false,
                error: 'Company id is required',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
        if (!OBJECT_ID_PATTERN.test(companyId)) {
            return res.status(401).json({
                status: false,
                error: 'Invalid company id',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
        if (token) {
            if (token.startsWith('Bearer ')) {
                // Remove Bearer from string
                token = token.slice(7, token.length);
            }
            const isValid = jwt.verify(token, process.env.JWT_SECRET);
            if (isValid && isCompanyInAudience(isValid.aud, companyId)) {
                const { uid } = isValid;

                req.uid = uid;
                next();
            } else {
                // Access Denied
                return res.status(401).json({
                    status: false,
                    error: 'Token has expired',
                    statusText: 'Token has expired',
                    isJwtError: true
                });
            }
        } else {
            return res.status(401).json({
                status: false,
                error: 'Unauthorized',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
    }
    catch (error) {
        return res.status(401).json({
            status: false,
            error: error.message,
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
}

const verifyJWTTokenWithCV2 = (req, res, next) => {
    let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
    const companyId = req.headers['companyid'] || "";
    if (!companyId) {
        return res.status(401).json({
            status: false,
            error: 'Company id is required',
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
    if (!OBJECT_ID_PATTERN.test(companyId)) {
        return res.status(401).json({
            status: false,
            error: 'Invalid company id',
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
    if (token) {
        try {
            if (token.startsWith('Bearer ')) {
                // Remove Bearer from string
                token = token.slice(7, token.length);
            }
            const isValid = jwt.verify(token, process.env.JWT_SECRET);
            if (!isCompanyInAudience(isValid.aud, companyId)) {
                res.clearCookie('accessToken');
                return res.status(401).json({
                    status: false,
                    error: 'Unauthorized',
                    statusText: 'Unauthorized',
                    isJwtError: true
                });
            }
            checkToken(isValid, req, res, next);
        } catch (error) {
            res.clearCookie('accessToken');
            return res.status(401).json({
                status: false,
                error: 'Unauthorized',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
    } else {
        return res.status(401).json({
            status: false,
            error: 'Unauthorized',
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
}

const verifyJWTToken = (req, res, next) => {
    try {
        let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
        
        if (token) {
            if (token.startsWith('Bearer ')) {
                // Remove Bearer from string
                token = token.slice(7, token.length);
            }
            const isValid = jwt.verify(token, process.env.JWT_SECRET);
            if (isValid) {
                const { uid } = isValid;
                
                req.uid = uid;
                next();
            } else {
                // Access Denied
                return res.status(401).json({
                    status: false,
                    error: 'Token has expired',
                    statusText: 'Token has expired',
                    isJwtError: true
                });
            }
        } else {
            return res.status(401).json({
                status: false,
                error: 'Unauthorized',
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
    }
    catch (error) {
        return res.status(401).json({
            status: false,
            error: error.message,
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
}

const verifyJWTTokenV2 = (req, res, next) => {
    let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase
    
    if (token) {
        if (token.startsWith('Bearer ')) {
            // Remove Bearer from string
            token = token.slice(7, token.length);
        }

        try {
            const isValid = jwt.verify(token, process.env.JWT_SECRET);
            checkToken(isValid, req, res, next);
        } catch (error) {
            res.clearCookie('accessToken');
            return res.status(401).json({
                status: false,
                error: error.message,
                statusText: 'Unauthorized',
                isJwtError: true
            });
        }
    } else {
        return res.status(401).json({
            status: false,
            error: 'Unauthorized',
            statusText: 'Unauthorized',
            isJwtError: true
        });
    }
}

const verifyToken = (token) => {
        if (token) {
            try {
                const isValid = jwt.verify(token, process.env.JWT_SECRET);
                return {
                    status: true,
                    isValid
                }
            } catch(error) {
                if (error.name === 'TokenExpiredError') {
                    return {
                        status: false,
                        key: 1,
                        error: 'Token has expired',
                        statusText: 'Token has expired',
                        isJwtError: true
                    };
                } else if (error.name === 'JsonWebTokenError') {
                    return {
                        status: false,
                        key: 2,
                        error: 'Invalid token',
                        statusText: 'Invalid token',
                        isJwtError: true
                    };
                } else {
                    return {
                        status: false,
                        key: 3,
                        error: error.message,
                        statusText: 'Unauthorized',
                        isJwtError: true
                    };
                }
            }
        } else {
            return {
                status: false,
                key: 4,
                error: 'Unauthorized',
                statusText: 'Unauthorized',
                isJwtError: true
            };
        }
}

module.exports = {
    generateToken: generateToken,
    generateJWTToken: generateJWTToken,
    verifyJWTTokenWithC: verifyJWTTokenWithC,
    verifyJWTTokenWithCV2: verifyJWTTokenWithCV2,
    verifyJWTToken: verifyJWTToken,
    verifyJWTTokenV2: verifyJWTTokenV2,
    verifyToken: verifyToken,
    removeCacheAndCookie: removeCacheAndCookie
}