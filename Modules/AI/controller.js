const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { default: mongoose } = require("mongoose");
const { pushChat,addChat, getChat, deleteChat, removeChat} = require("./helper");
const { escapeRegex } = require("../../utils/escapeRegex");
const config = require('../../Config/config');
const logger = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType")
const fs = require('fs');
const path = require('path');
const { emitListener } = require("./eventController.js");
const { getCachedPromptData, getCachedAllPromptData, getCachedCategoryData, getCachedAiModelData } = require("../../utils/enterpriseHelper.js");
const { updateCompanyFun, getCompanyDataFun } = require('../Company/controller/updateCompany.js');
const { updateMemberFunction } = require('../settings/Members/controller.js');
const aiPrompts = require('../../utils/aiPrompts.json');
const { generateDescription } = require('./aiDescriptionWriter');
const { summarizeTask } = require('./taskSummary');

// AI-Assist used to post straight to OpenAI, so LLM_PROVIDER had no effect here
// even though every other AI feature in the app honours it. It now goes through
// the same provider factory as the project generator, which makes that one
// setting drive all of them. Required lazily and defensively for the same
// reason the description writer does it: a missing or broken provider module
// should degrade to "AI is not integrated" rather than take this controller
// down at load time.
let providerFactory = null;
try {
    providerFactory = require('../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

/**
 * Is there any usable LLM?
 *
 * Replaces the old `config.AI_API_KEY && config.AI_MODEL` gate, which really
 * asked "is OpenAI set up" — so a company that had selected Anthropic or
 * DeepSeek and held no OpenAI key at all was told AI was not integrated. Falls
 * back to the original check if the factory cannot be loaded, so behaviour is
 * unchanged for an existing OpenAI setup either way.
 */
function isAiConfigured() {
    if (providerFactory && typeof providerFactory.isAnyProviderConfigured === 'function') {
        return providerFactory.isAnyProviderConfigured();
    }
    return Boolean(config.AI_API_KEY && config.AI_MODEL);
}

/**
 * One AI-Assist call, through whichever provider LLM_PROVIDER selects.
 *
 * `temperature: 1` is deliberate and is not the factory's default of 0.4. The
 * old direct call sent no temperature at all, so OpenAI applied its own default
 * of 1 — and AI-Assist writes prose, where dropping to 0.4 would visibly change
 * the character of every answer. Pinning it keeps existing output as it is.
 * (Providers that reject an explicit temperature, such as OpenAI's reasoning
 * models, already drop it inside their own implementation.)
 */
function askProvider(messages, { jsonMode = false } = {}) {
    if (!providerFactory || typeof providerFactory.getProvider !== 'function') {
        return Promise.reject(new Error('No LLM provider is available.'));
    }
    let provider;
    try {
        // Throws a specific message when the selected provider has no key or
        // model — worth surfacing as-is rather than flattening to "AI failed".
        provider = providerFactory.getProvider();
    } catch (error) {
        return Promise.reject(error);
    }
    return provider.chat({ messages, jsonMode, temperature: 1 });
}

/**
 * Cut an answer into the small pieces the typing effect consumes.
 *
 * The pieces are concatenated back together on the other side, so this splits
 * on a fixed width rather than on words: a word-wise split has to make choices
 * about the whitespace it swallows, and getting that wrong corrupts the text.
 * Six characters is about a word, which paces the typing like the per-token
 * pieces OpenAI used to hand back.
 */
function splitForTyping(text) {
    if (!text) return [];
    return text.match(/[\s\S]{1,6}/g) || [];
}

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
        if(isAiConfigured()){
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
                    // Kept verbatim, including the JSON.stringify: it wraps the prompt in
                    // quotes and escapes it, which is part of what these prompts have been
                    // tuned against. Sending the bare text would be a different prompt.
                    const messages = [{"role": "user", "content": `${JSON.stringify(promptsText)}`}];
                    if(stream === true){
                        exports.generateWithStream(messages,req.body.userId,req.body.companyId,req.body.uniqueUserId,req.body.eventId).then((response) => {
                            res.send({status: true, statusText: response});
                        }).catch((error) => {
                            res.send({status: false, statusText: (error && error.message) || String(error)});
                            console.error(error,"ERROR IN GENERATE WITH STRAM:");
                        })
                    }else{
                        try {
                            // No jsonMode here, matching the old direct call: only the
                            // streamed prompts ever asked for JSON-only output.
                            askProvider(messages).then(async(result) => {
                                const userUpdate = await exports.limitCountUpdate(req.body.userId,req.body.companyId,(result && result.totalTokens) || 0);
                                res.send({status: true, statusText: (result && result.content) || '',userUpdate:userUpdate});
                            }).catch((error) => {
                                res.send({status: false, statusText: (error && error.message) || String(error)});
                                console.error(error,"ERROR:");
                            })
                        } catch (error) {
                            console.error(error,"ERROR:");
                            res.send({status: false, statusText: (error && error.message) || String(error)});
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
        if(isAiConfigured()){
            if(!req.body.isRegenerate){
                pushChat(req.body.uniqueUserId,{role: "user",content: req.body.message});
            }else{
                removeChat(req.body.uniqueUserId)
            }
            if(getChat(req.body.uniqueUserId) && getChat(req.body.uniqueUserId).length>0){
                // The stored chat is already a role/content list, which is exactly what
                // every provider takes.
                exports.generateWithStream(getChat(req.body.uniqueUserId),req.body.userId,req.body.companyId,req.body.uniqueUserId,req.body.eventId).then((response) => {
                    res.send({status: true, statusText: response});
                }).catch((error) => {
                    res.send({status: false, statusText: (error && error.message) || String(error)});
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
            logger.info("COMPLETE COMP");
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
            const regex = new RegExp(`^(${escapeRegex(key)}=).*`, 'm');
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

// "Write with AI" for the description editor (task + project). Provider-
// agnostic — uses the AIProjectGenerator llmProvider factory via
// aiDescriptionWriter, NOT the OpenAI-hardcoded generatePrompt path. One LLM
// call returns EITHER up to 3 clarifying questions (when the input is too
// vague) OR the generated markdown description. When the client sends back
// `answers`, the writer always returns a description (it never re-asks).
// This endpoint only GENERATES — the client previews the result and persists
// it through the normal description save path only after the user approves.
exports.writeDescription = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) {
            return res.status(400).send({ status: false, statusText: 'companyId header required' });
        }

        const {
            title = '',
            taskType = '',
            existingDescription = '',
            intent = '',
            answers = [],
            mode = 'rewrite',
        } = req.body || {};

        const result = await generateDescription({
            title,
            taskType,
            existingDescription,
            intent,
            answers,
            mode,
        });

        if (!result.status) {
            // No-provider / parse failure / LLM error → graceful failure in
            // the standard error response shape so the popover can show a
            // friendly message and offer a retry.
            return res.send({
                status: false,
                statusText: result.reason || 'Could not generate a description.',
            });
        }

        return res.send({ status: true, data: result.data });
    } catch (error) {
        logger.error(`writeDescription error: ${error && error.message ? error.message : error}`);
        return res.send({
            status: false,
            statusText: (error && error.message) || 'An error occurred while generating the description.',
        });
    }
};

/**
 * Run a prompt and feed the answer out piece by piece for the typing effect.
 *
 * It is worth being clear about what "stream" means here, because it is not
 * what the name suggests and never was. The old code asked OpenAI for a stream
 * but did not read the response as one — axios buffered the whole body, and
 * only then was it split apart and replayed through delayProvider at a fixed
 * 50ms per piece. So the answer already arrived complete before the first
 * character appeared on screen, and going through the provider factory changes
 * none of that timing.
 *
 * The pieces are cosmetic. `resolve(fullText)` is what reaches the caller and
 * becomes the HTTP response, and that is the authoritative result.
 */
exports.generateWithStream = (messages,userId,companyId,uniqueUserId,eventId) => {
    return new Promise((resolve,reject) => {
        try {
            // jsonMode because the streamed prompts have always been sent with
            // OpenAI's `response_format: json_object`, making JSON-only output
            // part of the contract with the frontend. The factory holds that
            // guarantee on every provider — natively where one exists, by
            // instruction where it does not.
            askProvider(messages, { jsonMode: true })
            .then(async(result) => {
                const fullText = (result && result.content) || '';

                // Prime the queue with an empty piece. delayProvider drops
                // whatever it is handed first — it schedules a send and then
                // shifts from a queue that is still empty — so without this the
                // opening characters of every answer go missing from the typing
                // effect. Harmless before, when a piece was one token; visible
                // now that a piece is a few characters wider.
                delayProvider('', eventId);
                for (const piece of splitForTyping(fullText)) {
                    delayProvider(piece, eventId);
                }

                // BUG-017 / #71: the quota update is awaited before resolving,
                // so a failure to record usage surfaces instead of being lost.
                const userUpdate = await exports.limitCountUpdate(userId, companyId, (result && result.totalTokens) || 0);
                emitListener(eventId, { step: "COUNT", value: userUpdate });

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
exports.summarizeTask = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!companyId) {
            return res.status(400).send({ status: false, statusText: 'companyId header required' });
        }
        const { taskId = '', force = false } = req.body || {};
        const result = await summarizeTask({ companyId, taskId: String(taskId), force: force === true });
        if (!result.status) {
            return res.send({ status: false, statusText: result.reason || 'Could not summarise this task.' });
        }
        return res.send({ status: true, data: result.data });
    } catch (error) {
        logger.error(`summarizeTask error: ${error && error.message ? error.message : error}`);
        return res.send({ status: false, statusText: (error && error.message) || 'An error occurred while summarising the task.' });
    }
};
