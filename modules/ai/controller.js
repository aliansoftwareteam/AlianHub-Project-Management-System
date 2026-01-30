const { default: axios } = require("axios");
const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require("mongoose");
const { pushChat,addChat, getChat, deleteChat, removeChat} = require("./helper");
const config = require('../../Config/config');
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType")
const fs = require('fs');
const path = require('path');
const { emitListener } = require("./event-controller.js");
const { getCachedPromptData, getCachedAllPromptData, getCachedCategoryData, getCachedAiModelData } = require("../../utils/enterpriseHelper.js");
const { updateCompanyFun, getCompanyDataFun } = require('../company/controller/update-company.js');
const { updateMemberFunction } = require('../settings/Members/controller.js');
const aiPrompts = require('../../utils/aiPrompts.json');

// GENERATE INITIAL REQUEST AND FOR FUNCTION USE (SUB TASK,CHECKLIST)
exports.generatePrompt = (req,res) => {
    try {
        if(!req.body.prompt || req.body.prompt === '') {
            res.send({
                status: false,
                statusText: "Prompt is required."
            });
            return;
        }

        if(req.body.isRegenerate){
            deleteChat(req.body.uniqueUserId);
        }
        if(config.AI_API_KEY && config.AI_MODEL){
                const promptData = aiPrompts.find((e) => e._id === req.body.prompt.id);
                if (promptData) {
                    let promptRes = promptData;
                    let promptsText = promptRes.predefinedPrompt;
                    let stream = promptRes.stream;
                    req.body.prompt.fields.forEach(prompt => {
                        if (promptsText.toLowerCase().includes(prompt.key.toLowerCase())) {
                            var parts = promptsText.split(prompt.key);
                            promptsText = parts.join(prompt.value);
                            promptsText = promptsText + promptRes.outputFormat
                        }
                    })
                    addChat(req.body.uniqueUserId,{role: "user",content: promptsText });
                    let curlUrl = "https://api.openai.com/v1/chat/completions";
                    let axiosData = {
                        "model": config.AI_MODEL,
                        "messages": [{"role": "user", "content": `${JSON.stringify(promptsText)}`}]
                    }
                    const header = {
                        headers: {
                          Authorization: `Bearer ${config.AI_API_KEY}`,
                          'Content-Type': 'application/json'
                        }
                    };
                    if(stream === true){
                        exports.generateWithStream(axiosData,header,req.body.userId,req.body.companyId,req.body.uniqueUserId,req.body.eventId).then((response) => {
                            res.send({status: true, statusText: response});
                        }).catch((error) => {
                            res.send({status: false, statusText: error});
                            console.error(error,"ERROR IN GENERATE WITH STRAM:");
                        })
                    }else{
                        try {
                            axios.post(curlUrl,axiosData,header).then(async(response) => {
                                let result = response.data.choices[0].message.content;
                                let totalTokenUsed = response.data.usage.total_tokens;
                                const userUpdate = await exports.limitCountUpdate(req.body.userId,req.body.companyId,totalTokenUsed);
                                res.send({status: true, statusText: result,userUpdate:userUpdate});
                            }).catch((error) => {
                                res.send({status: false, statusText: error});
                                console.error(error,"ERROR:");
                            })
                        } catch (error) {
                            console.error(error,"ERROR:");
                            res.send({status: false, statusText: error});
                        }
                    }
                } else {
                    res.send({ status: false, statusText: 'error' });
                }
        }else{
            res.send({status: true, statusText: 'AI is not integrated in your system',isNotAi : true});    
        }

    } catch (error) {
        res.send({status: false, statusText: error});
        console.error("ERROR :",error)
    }
}

// FOR MULTI CHAT PURPOSE
exports.generatePromptChat = (req,res) => {
    try {
        if(config.AI_API_KEY && config.AI_MODEL){
            if(!req.body.isRegenerate){
                pushChat(req.body.uniqueUserId,{role: "user",content: req.body.message});
            }else{
                removeChat(req.body.uniqueUserId)
            }
            const header = {
                headers: {
                  Authorization: `Bearer ${config.AI_API_KEY}`,
                  'Content-Type': 'application/json'
                }
            };
            if(getChat(req.body.uniqueUserId) && getChat(req.body.uniqueUserId).length>0){
                let axiosData = {
                    'model': config.AI_MODEL,
                    "messages": getChat(req.body.uniqueUserId)
                }
                exports.generateWithStream(axiosData,header,req.body.userId,req.body.companyId,req.body.uniqueUserId,req.body.eventId).then((response) => {
                    res.send({status: true, statusText: response});
                }).catch((error) => {
                    res.send({status: false, statusText: error});
                    console.error(error,"ERROR IN GENERATE WITH STRAM:");
                })
            }else{
                res.send({status: false, statusText: 'time out'}); 
            }
        }else{
            res.send({status: true, statusText: 'AI is not integrated in your system',isNotAi : true});
        }
    } catch (error) {
        res.send({status: false, statusText: error});
        console.error("ERROR :",error);
    }
}

// DELETE USER CHAT
exports.deleteUserChat = (req,res) => {
    try {
        deleteChat(req.body.userId);
        res.send({status: true, statusText: 'Done'});
    } catch (error) {
        res.send({status: false, statusText: error});
        console.error(error,"ERROR:");
    }
}

exports.getPrompts = (req,res) => {
    try {
        getCachedAllPromptData().then((resp) => {
            res.send(resp);
        })
        .catch((error) => {
            res.send({status: false,statusText: error});
        })
    } catch (error) {
        res.send({status: false,statusText: error});
    }
}

exports.findOnePrompts = (req,res) => {
    try {
        getCachedPromptData(req.body).then((resp) => {
            res.send(resp);
        })
        .catch((error) => {
            res.send({status: false,statusText: error});
        })
    } catch (error) {
        res.send({status: false,statusText: error});
    }
}

exports.getAiCategory = (req,res) => {
    try {
        getCachedCategoryData().then((response) => {
            res.send(response);
        })
        .catch((error) => {
            res.send({status: false,statusText: error});
        })
    } catch (error) {
        res.send({status: false,statusText: error});
    }
}

exports.limitCountUpdate = (userId,companyId,usedToken) => {
    return new Promise((resolve,reject) => {
        try {
            const memberObject = [
                { userId: userId },
                {
                    $inc: {
                        aiRequestedCount: usedToken
                    }
                },
                {
                    returnDocument : 'after'
                }
            ]

            updateMemberFunction(companyId, memberObject, "findOneAndUpdate").then((resp) => {
                resolve({status: true, data: resp.data});
            })
            .catch((error) => {
                reject({status: false, statusText: error});
                console.error("Error in update company user count", error);
            })

            let compObj = {
                type: dbCollections.COMPANIES,
                data: [
                    { _id: new mongoose.Types.ObjectId(companyId) },
                    {
                        $inc: {
                            aiTotalRequestedCount: usedToken
                        }
                    },
                    { new: true, useFindAndModify: false }
                ]
            }
            updateCompanyFun(SCHEMA_TYPE.GOLBAL,compObj,"findOneAndUpdate",companyId,true)
            .catch((err)=>{
                logger.error(`${err} Error in update company count`);
            })
        } catch (error) {
            logger.error(`${error} Error in limit count update`);
            reject({status: false, statusText: error});
        }
    })
}

// CORN FUNCTION FOR RESET COMPANY USER PER COUNT AND COMPANY TOTAL REQUEST COUNT
exports.resetAiRequestCount = async() => {
    try {
        const obj = {
            type: dbCollections.COMPANIES,
            data: [
                {},
                { $set: { aiTotalRequestedCount: 0 } },
            ]
        }
        MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL,obj,"updateMany").then(() => {
            console.log("COMPLETE COMP");
        }).catch((error)=> {
            logger.error(`${error} error in updatemany company count`);
        })
        exports.removeUserCount().then((resp) => {
            logger.info(resp);
        }).catch((err) => {
            logger.error(`Error in aad company Data ${err}`);
        });
    } catch (error) {
        console.error(error,"ERROR IN RESET AI COUNT");
    }
}

exports.removeUserCount = async() => {
    return new Promise(async(resolve, reject) => {
        try {
            let comapanies = await getCompanyDataFun([],true);
            let count = 0;
            let companyIdError = [];
            let countFunction = (company) => {
                if (count >= comapanies.length) {
                    resolve({ status: true, statusText: "Company user count updated", companyIdError});
                    return;
                } else {
                    try {
                        const memberObject = [
                            {},
                            { $set: { aiRequestedCount: 0 } },
                        ]
                        updateMemberFunction(company._id, memberObject, "updateMany").then(() => {
                            count++;
                            countFunction(comapanies[count]);
                        }).catch((err) => {
                            companyIdError.push({
                                id: company,
                                error: err
                            })
                            count++;
                            countFunction(comapanies[count]);
                        })
                    } catch (error) {   
                        logger.error(`${error}error in remove user count ${company._id}`)
                        companyIdError.push({
                            id: company,
                            error: error
                        })
                        count++;
                        countFunction(comapanies[count]);
                    }
                }
            }
            countFunction(comapanies[count]);
        } catch (error) {
            logger.error(`${error} Error in remove company user count`)
            reject(error)
        }
    })

}

exports.getAiModels = (req,res) => {
    try {
        getCachedAiModelData().then((response) => {
            res.send(response);
        })
        .catch((error) => {
            res.send({status: false,statusText: error});
        })
    } catch (error) {
        res.send({status: false,statusText: error});
    }
}

exports.findOneAiModel = (req,res) => {
    try {
        getCachedAiModelData().then((response) => {
            if(response.status === true){
                let data = response.statusText.find((x) => req.body.value === x.value)
                res.send({status: true,statusText: data});
            }else{ 
                res.send({status: false,statusText: 'Error'});
            }
        })
        .catch((error) => {
            res.send({status: false,statusText: error});
        })
    } catch (error) {
        res.send({status: false,statusText: error});
    }
}

exports.updateAiModel = (req,res) => {
    try {
        const envFilePath = path.join(__dirname, '../../.env');
        const key = req.body.key;
        fs.readFile(envFilePath, 'utf8', (err, data) => {
            if (err) {
                console.error(`Error reading the file: ${err}`);
                res.send({status : false,statusText: err})
                return;
            }
            const regex = new RegExp(`^(${key}=).*`, 'm');
            const replacement = `${key}="${req.body.value}"`;

            let updatedData;

            if (regex.test(data)) {
                updatedData = data.replace(regex, replacement);
            } else {
                updatedData = data.trim() + `\n${replacement}\n`;
            }

            fs.writeFile(envFilePath, updatedData, 'utf8', (err) => {
                if (err) {
                    console.error(`Error writing the file: ${err}`);
                    res.send({status : false,statusText: err})
                    return;
                }
                res.send({status : true,statusText: 'Updated'});
            });
        })
    } catch (error) {
        res.send({status : false,statusText: error})
        console.error(error,"ERROR IN UPDATE MODELS:")
    }
}

exports.generateWithStream = (axiosData,header,userId,companyId,uniqueUserId,eventId) => {
    return new Promise((resolve,reject) => {
        try {
            let curlUrl = "https://api.openai.com/v1/chat/completions";
            axiosData.stream = true;
            axiosData.stream_options = {"include_usage": true};
            axiosData.response_format = { "type": "json_object" };
            axios.post(curlUrl,axiosData,header)
            .then((response) => response.data)
            .then(async(response) => {
                const resP = response.toString();
                let chunks = [];
                let fullText = '';
                if (resP.includes('\n')) {
                    chunks = resP.split('\n');
                } else {
                    chunks = [resP];
                }
                let chunkObjects = chunks
                .map((chunk) => chunk.replace(/^data: /, '').trim())
                .filter((chunk) => chunk !== undefined && chunk !== '' && chunk !== '[DONE]')
                .map((chunk) => JSON.parse(chunk));
                chunkObjects.forEach(async(chunk) => {
                    if (chunk.choices && chunk.choices.length > 0 && chunk.choices[0].delta.content){
                        delayProvider(chunk.choices[0].delta.content,eventId)
                    }else if(chunk.usage){
                        const userUpdate = await exports.limitCountUpdate(userId,companyId,chunk.usage.total_tokens);
                        emitListener(eventId, {step: "COUNT",value : userUpdate});
                    }
                });
                chunkObjects.forEach(async(chunk) => {
                    if (chunk.choices && chunk.choices.length > 0 && chunk.choices[0].delta.content){
                        fullText += chunk.choices[0].delta.content;
                    }
                });
                resolve(fullText);
                await pushChat(uniqueUserId,{role: "system",content: JSON.stringify(fullText)});
            }).catch((error) => {
                reject(error);
                console.error(error,"ERROR:");
            })
        } catch (error) {
            console.error(error,"ERROR:");
            reject(error);
        }
    })
}

const queue = [];
let inProcess = false;
function delayProvider(data = "",eventId) {
    const fixedTime = 50;

    if(inProcess) {
        queue.push(data);
        return;
    }
    inProcess = true;

    setTimeout(() => {
        inProcess = false;
        const toBeSent = queue.shift();

        // CALL EVENT HERE
        emitListener(eventId, {step: 1,value : toBeSent});

        if(queue.length) {
            delayProvider(queue[0],eventId);
        }else{
            emitListener(eventId, {step: "STOP"});
        }
    }, fixedTime)
}