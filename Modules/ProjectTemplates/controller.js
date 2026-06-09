const axios = require('axios');
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { settingsCollectionDocs } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose")
const { myCache, AI_API_KEY, AI_MODEL } = require('../../Config/config');
const { removeCache } = require('../../utils/commonFunctions');
const { status } = require('migrate-mongo');

/**
 * This endpoint is used to create project template
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.createTemplate = async (req, res) => {
    try {
        const { data } = req.body

        const params = {
            type: SCHEMA_TYPE.PROJECT_TEMPLATES,
            data: data 
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, "save");

        const cacheKey = `project_template_${req.headers['companyid']}`;
        removeCache(cacheKey);

        if(data.customFiedlsValue && data.customFiedlsValue.length > 0) {
            removeCache(`customField:${req.headers['companyid']}`);
        }

        if(response) {
            return res.status(200).json({ status: true, data: response });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while saving the project template",
            error: error 
        });
    }
}

/**
 * This endpoint is used to delete project template
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.deleteTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const params = {
            type: SCHEMA_TYPE.PROJECT_TEMPLATES,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                }
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, "deleteOne")

        const cacheKey = `project_template_${req.headers['companyid']}`;
        removeCache(cacheKey);

        if (response) {
            return res.status(200).json({ status: true });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while delete the project template",
            error: error 
        });
    }
}

/**
 * This endpoint is used to get project template
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getTemplates = async (req, res) => {
    try {

        let params = {
            type: SCHEMA_TYPE.PROJECT_TEMPLATES,
            data: []
        }

        const cacheKey = `project_template_${req.headers['companyid']}`;
        const hasCache = myCache.get(cacheKey);
        if (hasCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json({ status: true, data: JSON.parse(hasCache) });
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'find');
        myCache.set(cacheKey, JSON.stringify(response), 604800);

        if (response) {
            return res.status(200).json({ status: true, data: response });
        } else {
            return res.status(404).json({ status: false });
        }

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while get the project template",
            error: error 
        });
    }
}

/**
 * AI data mapping with our existing settings data
 * @param {*} companyId
 * @param {*} existingData
 * @param {*} content
 * @returns
 */
exports.mapExistingSettingsData = async (
    existingData,
    content,
    matchKey = 'value',
    addTypeIfMissing = false
) => {
    const dataArray = [];

    // Set type as per the status
    const setStatusType = (name) => {
        const status = name?.toLowerCase().replace(/ /g, '_');
        switch (status) {
            case 'to_do':
                return 'default_active';
            case 'open':
                return 'default_active';
            case 'complete':
                return 'close';
            case 'completed':
                return 'close';
            case 'close':
                return 'close';
            case 'done':
                return 'done';
            default:
                return 'active';
        }
    }

    for (const item of content) {

        const normalizedItemValue = item[matchKey]?.toLowerCase().replace(/ /g, '_');
        const matched = existingData.find(existing => existing[matchKey]?.toLowerCase().replace(/ /g, '_') === normalizedItemValue);

        if (matched) {
            const obj = {
                ...matched,
                ...(addTypeIfMissing && (!item.type ? { type: 'active' } : { type: setStatusType(item[matchKey]) }))
            };

            dataArray.push(obj);
        } else {
            // Find the maximum key from existingData (assumes keys are numbers)
            const allKeys = [...existingData, ...dataArray];
            const maxKey = allKeys.reduce((max, curr) => {
                return typeof curr.key === 'number' && curr.key > max ? curr.key : max;
            }, 0);

            const obj = {
                ...item,
                key: maxKey + 1,
                ...((addTypeIfMissing && !item.type) && { type: 'active' })
            };

            dataArray.push(obj);
        }
    }

    return dataArray;
}

/**
 * This endpoint is used to create project template with AI
 * @param {*} req
 * @param {*} res
 * @returns
 */
exports.createTemplateWithAI = async (req, res) => {
    try {
        const { useCaseDescription, category } = req.body;
        const companyId = req.headers['companyid'];

        if (!category) {
            return res.status(400).json({
                status: false,
                error: "category parameter is required"
            });
        }

        // Get existing settings data from database
        const getQuery = {
            type: SCHEMA_TYPE.SETTINGS,
            data: [
                { name: { $in: [settingsCollectionDocs.TASK_STATUS, settingsCollectionDocs.TASK_TYPE, settingsCollectionDocs.PROJECT_STATUS] } }
            ]
        };
        const existingResponse = await MongoDbCrudOpration(companyId, getQuery, "find");
        const existingData = existingResponse.reduce((acc, item) => {
            acc[item.name] = item.settings;
            return acc;
        }, {});

        const template = {
            TemplateName: "",
            Description: "",
            taskStatusData: [
                { type: "default_active", name: "To Do", textColor: "#ff9600", key: 1, bgColor: "#ff960035", },
                { type: "active", name: "In Progress", textColor: "#cedb1f", key: 3, bgColor: "#cedb1f35" },
                { type: "done", name: "Done", textColor: "#24c110", key: 2, bgColor: "#24c11035" },
                { type: "close", name: "Complete", textColor: "#6BC950", key: 2, bgColor: "#6BC95035" }
            ],
            TemplateTaskType: [
                { name: "Task", taskImage: "setting/task_type/task.png", key: 1, value: "task" },
                { name: "Sub Task", taskImage: "setting/task_type/subtask.png", key: 3, value: "sub_task" },
                { name: "Bug", taskImage: "setting/task_type/bug.png", key: 4, value: "bug" }
            ],
            projectStatusData: [
                { type: "default_active", name: "Open", textColor: "#7367F0", key: 1, backgroundColor: null, value: "open" },
                { type: "active", name: "In Design", textColor: "#75e619", key: 3, backgroundColor: "#75e61935", value: "in_design" },
                { type: "close", name: "Close", textColor: "#6BC950", key: 2, backgroundColor: null, value: "close" }
            ]
        }

        const systemPrompt = `
            You are a strict JSON generator for MongoDB-style project templates.

            Rules (must never be broken):
            1. Always output a single valid JSON object, with no explanations, no markdown, and no extra text.
            2. The JSON must strictly follow the given template structure, including all field names and nesting.
            3. Each generated document must include:
            - Task Statuses
            - Task Types
            - Project Statuses
            4. For both Task Statuses and Project Statuses:
            - There must be exactly one item with "type": "default_active".
            - There must be at least one item with "type": "active".
            - There must be at least one item with "type": "close".
            5. Use the Template Category and Use Case Description to decide contextual names.
            6. Do not invent extra fields or change structure.
            7. Strictly follow the structure of the given template, including field names, nesting, and array formats.
            8. However, give *highest priority* to the template category and use case description.

            Your highest priority is structural correctness (rules above). Your second priority is semantic fit to the use case.
        `;

        const userPrompt = `
            Generate a MongoDB document using the following structure:
            ${JSON.stringify(template, null, 2)}

            Context:
            - Template Category: ${category}
            - Use Case Description: ${useCaseDescription}

            Instructions:
            1. Populate the document with relevant Task Statuses, Task Types, and Project Statuses.
            2. Ensure semantic relevance to the use case context.
            3. Quantity of items can vary depending on the context.
            4. Mandatory structural rules:
            - Task Statuses must include one "default_active", one "close", and other are "active".
            - Project Statuses must include one "default_active", one "close", and other are "active".
            - Do not skip these requirements under any circumstance.

            Return only a valid JSON object.
        `;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: AI_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${AI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        let content = response.data.choices[0].message.content;
        content = content.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, '$1');
        const AIContent = JSON.parse(content);

        const defaultActiveTaskIndex = AIContent["taskStatusData"]?.findIndex(item => item.type === 'default_active');
        const defaultActiveProjectIndex = AIContent["projectStatusData"]?.findIndex(item => item.type === 'default_active');
        if (defaultActiveTaskIndex === -1 || defaultActiveProjectIndex === -1) {
            return res.status(400).json({
                status: false,
                error: "Something went to wrong, Please try again"
            });
        }

        // Mapping AI data with an existing data
        const [finalTaskStatusData, finalTaskTypeData, finalProjectsStatusData] = await Promise.all([
            exports.mapExistingSettingsData(
                existingData[settingsCollectionDocs.TASK_STATUS],
                AIContent["taskStatusData"],
                "name", // comparision key for match value
                true    // add 'type' key if required
            ),
            exports.mapExistingSettingsData(
                existingData[settingsCollectionDocs.TASK_TYPE],
                AIContent["TemplateTaskType"],
                "value",
                false
            ),
            exports.mapExistingSettingsData(
                existingData[settingsCollectionDocs.PROJECT_STATUS],
                AIContent["projectStatusData"],
                "value",
                true
            )
        ]);

        const result = {
            ...AIContent,
            TemplateTaskType: finalTaskTypeData,
            taskStatusData: finalTaskStatusData,
            projectStatusData: finalProjectsStatusData,
            finalTemplateTaskStatusData: AIContent["taskStatusData"]?.map(item => {
                const match = finalTaskStatusData.find(t => t.value === item.value && t.type === item.type)
                return match ? { ...item, key: match.key } : item
            }),
            finalProjectStatusData: AIContent["projectStatusData"]?.map(item => {
                const match = finalProjectsStatusData.find(t => t.value === item.value && t.type === item.type)
                return match ? { ...item, key: match.key } : item
            })
        }

        return res.status(200).json({ status: true, data: result || {} });
    } catch (error) {
        console.error("Error in createTemplateWithAI hook => ", error)
        if (error.response?.data?.error?.type === 'invalid_request_error') {
            return res.status(400).json({
                message: "AI is not integrated in your system",
                error: "AI is not integrated in your system"
            });
        }
        return res.status(500).json({
            message: "An error occurred while generating project template with AI",
            error: error.response.data?.error?.message || error.message || "An error occurred while generating project template with AI"
        });
    }
}