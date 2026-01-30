
const mongoRef = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');
/**
 * 
 * @param {Object} req 
 * @param {Object} res 
 * @returns 
 */
exports.verifyEmail = (req , res) => {
    try {
        if(!req.body.uid || req.body.uid === '') {
            res.send({
                status: false,
                statusText: "uid is required."
            });
            return;
        }

        if(!req.body.token || req.body.token === '') {
            res.send({
                status: false,
                statusText: "token is required."
            });
            return;
        }

        let obj = {
            type: dbCollections.USERS,
            data: [
                {
                    _id: req.body.uid
                },
            ]
        }
        mongoRef.MongoDbCrudOpration("global",obj,"findOne").then((response)=>{
            if (response && response !== null) {          
                const tokenTime = new Date(response.verificationTokenTime);
                const ValidTime = new Date(tokenTime.setMinutes(tokenTime.getMinutes() + 10));
                if (response.isEmailVerified === true) {
                    let object = {
                        type: dbCollections.USERS,
                        data: [
                            {
                                _id: req.body.uid
                            },
                            {
                                $set: {
                                    verificationToken: ""
                                }
                            }
                        ]
                    }
                    mongoRef.MongoDbCrudOpration("global",object,"findOneAndUpdate").then(()=>{
                        res.send({
                            status: false,
                            alreadyVarified: true,
                            statusText: 'Your email is already verified',
                            showResendVerification: false
                        });
                        return;
                    }).catch((error)=>{
                        res.send({
                            status: false, 
                            statusText:error.message
                        });  
                    })
                } else if ((ValidTime < new Date()) || (response.verificationToken !==  "" && response.verificationToken !== req.body.token)) {
                    res.send({
                        status: false,
                        email: response.Employee_Email,
                        statusText: 'This link is expired',
                        showResendVerification: true
                    });
                    return;
                } else if (response.verificationToken == req.body.token) {
                    let object = {
                        type: dbCollections.USERS,
                        data: [
                            {
                                _id: req.body.uid
                            },
                            {
                                $set: {
                                    verificationToken: "",
                                    isEmailVerified: true
                                }
                            }
                        ]
                    }
                    mongoRef.MongoDbCrudOpration("global",object,"findOneAndUpdate").then(()=>{
                        res.send({
                            status: true, 
                            statusText:'Email verified successfully.',
                            showResendVerification: false
                        });
                        return;
                    }).catch((error)=>{
                        res.send({
                            status: false, 
                            statusText:error.message
                        });  
                    })
                }   
            } else {
                res.send({
                    status: false, 
                    statusText:'Couldn’t find your Account',
                    showResendVerification: false
                });
                return;
            }
        }).catch((error)=>{
            res.send({
                status: false,
                statusText: error
            })
        })
    } catch(error) {
        res.send({
            status: false,
            statusText: error.message
        });
    }
};