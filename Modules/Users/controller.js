const { myCache } = require("../../Config/config.js");
const { dbCollections } = require("../../Config/collections.js");
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType.js");
const { removeCache } = require("../../utils/commonFunctions.js");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const mongoose = require("mongoose")

exports.updateUserStatus = (req,res) => {
    const { userId, updateObject,newObj} = req.body;

    if(!userId) {
        res.send({status: false, message: 'userId is required'});
        return;
    }
    if(!updateObject) {
        res.send({status: false, message: 'userId is required'});
        return;
    }

    let data =  [
        { _id: new mongoose.Types.ObjectId(req.body.userId) }, 
        updateObject,
        newObj
    ]

    let obj = {
        type: dbCollections.USERS,
        data: data
    }

    try {
        const cacheKey = `UserData:${req.body.userId}`;
        MongoDbCrudOpration('global', obj, "findOneAndUpdate").then((response)=>{
            removeCache(cacheKey)
            removeCache('UserAllData:',true)
            res.send({
                status: true,
                statusText: "User Status Updated",
                data:response
            });
        }).catch((error)=>{
            res.send({
                status: false,
                statusText: "User Status Not Updated"
            });
            logger.error('USER STATUS UPDATE ERROR updateUserStatus: ',error);
        })
    } catch (error) {
        res.send({
            status: false,
            statusText: "User Status Not Updated"
        });
        logger.error('USER STATUS UPDATE ERROR updateUserStatus: ',error);
    }
}

exports.checkUserAndCompany = (req, res) => {
    if(!req.body.userId) {
        res.send({status: false, message: 'userId is required'});
        return;
    }
    let obj = {
        type: dbCollections.USERS,
        data: [
            {
                _id : new mongoose.Types.ObjectId(req.body.userId)
            }
        ]
    }

    // BUG-027 / #81 fix: this handler has six different res.send sites
    // across nested .then / .catch chains. Pre-fix, a sync throw in
    // res.send (e.g. ERR_HTTP_HEADERS_SENT triggered by middleware) on
    // the inner .then could land in the inner .catch which would also
    // try to res.send — and the outer .catch would do it a third time.
    // Wrap every res.send through a `sendOnce` so duplicate writes are
    // suppressed instead of throwing.
    let responded = false;
    const sendOnce = (payload) => {
        if (responded) {
            logger.warn('checkUserAndCompany suppressed a duplicate res.send');
            return;
        }
        responded = true;
        res.send(payload);
    };

    try {
        MongoDbCrudOpration('global', obj, "findOne").then((response)=>{
            if(response && response.isEmailVerified === false) {
                sendOnce({
                    status: false,
                    statusText: "Email Not Verified",
                    data: {userData:response}
                });
                return;
            }
            if(response && response.AssignCompany && response.AssignCompany.length > 0) {
                const exists = response?.AssignCompany?.includes(response?.lastSelectedCompany);
                let cObj = {
                    type: dbCollections.COMPANIES,
                    data: [
                        {
                            _id: { $in: exists ? [new mongoose.Types.ObjectId(response?.lastSelectedCompany)] : [...response.AssignCompany.map((x) => new mongoose.Types.ObjectId(x))] },
                            isDisable: { $in : [false,undefined]}
                        }
                    ]
                }

                MongoDbCrudOpration('global', cObj, "findOne").then((company)=>{
                    if(company) {
                        sendOnce({
                            status: true,
                            statusText: "Comapny Found",
                            data: {isCompanyFind: true,companyId: company._id,userData:response}
                        });
                        return;
                    } else {
                        sendOnce({
                            status: true,
                            statusText: "Comapny Not Found",
                            data: {isCompanyFind: false,companyId: '',userData:response}
                        });
                        return;
                    }
                }).catch((error)=>{
                    sendOnce({
                        status: false,
                        statusText: "Comapny Not Found",
                        data: {isCompanyFind: false,companyId: '',userData:response}
                    });
                    logger.error('USER STATUS UPDATE ERROR checkUserAndCompany: ',error);
                })

            } else {
                sendOnce({
                    status: true,
                    statusText: "Comapny Not Found",
                    data: {isCompanyFind: false,companyId: '',userData:response}
                });
                return;
            }
        }).catch((error)=>{
            sendOnce({
                status: false,
                statusText: "User Not Found",
                data: {isCompanyFind: false,companyId: '',userData: null}
            });
            logger.error('USER STATUS UPDATE ERROR checkUserAndCompany: ',error);
        })
    } catch (error) {
        sendOnce({
            status: false,
            statusText: "User Not Found",
            data: {}
        });
        logger.error('USER STATUS UPDATE ERROR checkUserAndCompany: ',error);
    }
}

exports.getUserById = async(req, res) => {
    try {
        let { id } = req.params;
        const { query } = req.query;
        
        if(!id) {
            return res.status(400).json({
                status: false,
                message: 'id is required.'
            });
        }

        const customerCacheKey = `customerId:${id}`;
        let key = '_id';
        
        if (query === 'customerId') {
            const cachedCustomerId = myCache.get(customerCacheKey);
            if (cachedCustomerId) {                
                id = cachedCustomerId;
            } else {
                key = 'customerId';
            }
        }
        const cacheKey = `UserData:${id}`;

        const value = myCache.get(cacheKey);
        
        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }
        
        const userObj = {
            type: SCHEMA_TYPE.USERS,
            data: [
                {[key] : id}
            ]
        };
        const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, userObj, 'findOne');

        if (!users) {
            return res.status(404).json({ message: "user not found" });
        }
        const userId = users._id;
        const userData = JSON.stringify(users);

        if (query === 'customerId') {
            myCache.set(customerCacheKey, userId);
            myCache.set(`UserData:${userId}`, userData, 604800);
        } else {
            if (users?.customerIds && users?.customerIds?.length) {
                for (let i = 0; i < users?.customerIds?.length; i += 1) {
                    myCache.set(`customerId:${users?.customerIds[i]}`, userId);
                }
            }

            // if (users?.customerId) {
            //     myCache.set(`customerId:${users.customerId}`, userId);
            // }
            myCache.set(cacheKey, userData, 604800);
        }
        return res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while getting the user",error: error });
    }
}

exports.getUserByQuey = async(req, res) => {
    exports.getUserByQueyFun(req.body.query,req.body.companyId,req.body.fetchFromCache).then((data) => {
        res.json(data);
    }).
    catch((error) => {
        res.json(error);
    })
}

exports.getUserByQueyFun = async(query = {},companyId = '',fetchFromCache = false, preAggregate = false) => {
    return new Promise(async(resolve, reject) => {
        try {
            const cacheKey = `UserAllData:${companyId}`;

            const value = myCache.get(cacheKey);

            if (value && fetchFromCache) {
                return resolve(JSON.parse(value)); 
            }

            let userQuery = [
                {
                    $match: query
                }
            ];
            if (preAggregate) {
                userQuery = query
            } 

            const userObj = {
                type: SCHEMA_TYPE.USERS,
                data: [userQuery]
            };
            const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, userObj, 'aggregate');

            if (!users) {
                return resolve({ message: "user not found" });
            }
            if(fetchFromCache){
                myCache.set(cacheKey,JSON.stringify(users), 604800);
            }
            users.forEach((user) => {
                myCache.set(`UserData:${user._id.toString()}`,JSON.stringify(user),604800);
            })

            return resolve(users);
        } catch (error) {
            reject({ message: "An error occurred while getting the users",error:error })
        }
    })
}

exports.updateUserFun = (type,companyObj,method,companyId = "",userId = "",updateMany = false) => {
    return new Promise (async(resolve,reject) => {
        try {
            const userData = await MongoDbCrudOpration(type, companyObj, method);

            if (!userData) {
                return resolve({ message: "user not updated"});
            }

            if(userId === ''){
                if(!updateMany){
                    userId = JSON.parse(JSON.stringify(userData._id));
                }else{
                    removeCache(`UserData:`,true);
                }
            }

            if(userId){
                removeCache(`UserData:${userId}`);
            }

            if(companyId){
                removeCache(`UserAllData:${companyId}`,true);
            }else{
                removeCache(`UserAllData:`,true);
            }

            return resolve({message: "user updated",data: userData || {}});
        } catch (error) {
            reject(error);
        }
    })
}