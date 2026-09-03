const { myCache } = require("../../Config/config");
const { removeCache } = require("../../utils/commonFunctions");
const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");

exports.insertCustomField = async (req, res) => {
    try {
        const { updateObject, type } = req.body;
        const companyId = req.headers["companyid"];

        if (!companyId) {
            return res.status(400).json({
                message: "Company ID is required in headers."
            });
        }
        const guard = await this.guardFormulaDefinition(companyId, updateObject);
        if (!guard.valid) {
            return res.status(400).json({ message: guard.reason });
        }

        const response = await this.insertCustomFieldPromise(updateObject, type, companyId);

        return res.status(200).json(response);
    } catch (error) {
        console.error("Error in insertCustomField:", error);
        return res.status(500).json({
            message: "An error occurred while updating or inserting custom field.",
            error: error.message || error
        });
    }
};

exports.insertCustomFieldPromise = (updateObject, type, companyId) => {
    return new Promise((resolve, reject) => {
        try {
            if (!type) {
                return reject(new Error("Type is required"));
            }
            if (type === "save") {
                if (!(updateObject && Object.keys(updateObject).length)) {
                    return reject(new Error("Update Object is required"));
                }
            } else {
                return reject(new Error("Invalid type"));
            }

            const currentDate = new Date();
            const updateObjectDate = {
                ...updateObject,
                updatedAt: currentDate,
                createdAt: currentDate
            };

            const query = {
                type: dbCollections.CUSTOM_FIELDS,
                data: updateObjectDate
            };

            MongoDbCrudOpration(companyId, query, type)
                .then((response) => {
                    removeCache(`customField:${companyId}`);
                    resolve(response);
                })
                .catch((error) => {
                    console.error("Error in MongoDbCrudOpration:", error);
                    reject(error);
                });

        } catch (error) {
            console.error("Error in insertCustomFieldPromise:", error);
            reject(error);
        }
    });
};


exports.updateCustomField = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { key,updateObject,type,id } = req.body;

        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the currency.",
                error: "Company ID is required in headers."
            });
        }
        if(!type){
            return res.status(400).json({message: 'Type is Required'});
        }
        if(type === 'updateOne'){
            if (!(updateObject && Object.keys(updateObject).length) || !(key) || !(id)) {
                return res.status(400).json({message: `${!updateObject ? 'Update Object' : !key ? 'Key' : !id ? 'Id' : '' } is Required`});
            }
        }else{
            return res.status(400).json({message: 'Invalid type'});
        }
        const guard = await this.guardFormulaDefinition(companyId, updateObject, id);
        if (!guard.valid) {
            return res.status(400).json({ message: guard.reason });
        }

        const currentDate = new Date();

        const updateObjectDate = {
            ...updateObject,
            updatedAt: currentDate
        };

        const query = {
            type: dbCollections.CUSTOM_FIELDS,
            data:[
                { _id: new mongoose.Types.ObjectId(id) },
                { [key]: updateObjectDate },
            ]
        };
        const response = await MongoDbCrudOpration(companyId, query, type);
        removeCache(`customField:${companyId}`);
        return res.status(200).json(response);
    } catch (error) {
        console.error(`Error updating or inserting custom field:`, error);
        return res.status(500).json({
            message: `An error occurred while updating or inserting custom field.`,
            error: error.message || error
        });
    }
};

exports.getCustomField = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { global } = req.query;
        // Validate company ID
        if (!companyId) {
            return res.status(400).json({
                message: "An error occurred while getting the currency.",
                error: "Company ID is required in headers."
            });
        }
        const isGlobal = global ? global : null;
        if (isGlobal === null) {
            return res.status(400).json({ message: "Invalid value for 'global'. Expected 'true' or 'false'." });
        }
        const cacheKey = isGlobal === 'true' ? `customField:global` : `customField:${companyId}`;
        const value = myCache.get(cacheKey);

        if (value) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
            return res.status(200).json(JSON.parse(value));
        }
        // Prepare query
        const query = {
            type: dbCollections.CUSTOM_FIELDS,
            data: []
        };

        const target = isGlobal === 'true' ? 'global' : companyId;
        const response = await MongoDbCrudOpration(target, query, 'find');
        myCache.set( cacheKey, JSON.stringify(response && response.length ? response : []), 604800 );
        return res.status(200).json(response && response.length ? response : []);
    } catch (error) {
        console.error(`Error retrieving custom fields:`, error);
        return res.status(500).json({
            message: "An error occurred while retrieving custom fields.",
            error: error.message || error
        });
    }
};

// ── Formula / rollup fields (handoff 22a) ────────────────────────────────────
//
// The expression text is untrusted, so it is only ever run through the
// sandboxed parser in helpers/formula.js — never in the browser, and never
// through eval/new Function. The computed number is written onto the task so
// every reader (list, board, export, report) sees the same stored value.

const socketEmitter = require("../../event/socketEventEmitter");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { evaluateFormula, extractReferences, FUNCTIONS, ROLLUP_FUNCTIONS } = require("./helpers/formula");
const { computeTaskFields, validateFormulaDefinition, slug, builtinScope } = require("./helpers/computeFields");

const isObjectIdString = (value) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

const loadDefinitions = async (companyId, projectId) => {
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [] }, "find") || [];
    if (!projectId) return rows;
    return rows.filter((row) => {
        if (row.global) return true;
        const ids = Array.isArray(row.projectId) ? row.projectId : [row.projectId];
        return ids.map(String).includes(String(projectId));
    });
};

/* POST /api/v2/custom-fields/formula/validate
 * body: { expression, fieldId?, fieldTitle?, projectId?, sample? }
 * Parses the expression, refuses circular references, and — when `sample` is a
 * plain { fieldName: value } map — returns the preview value the builder shows. */
exports.validateFormula = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { expression, fieldId, fieldTitle, projectId, sample } = req.body || {};
        if (!companyId) return res.send({ status: false, message: "Company ID is required in headers." });
        if (typeof expression !== "string") return res.send({ status: false, message: "An expression is required." });

        const definitions = await loadDefinitions(companyId, projectId);
        const check = validateFormulaDefinition({ definitions, fieldId, fieldTitle, expression });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason, message: check.reason, data: { code: check.code } });
        }

        let references = [];
        try {
            references = extractReferences(expression);
        } catch (error) {
            references = [];
        }

        const scope = Object.assign(Object.create(null), sample && typeof sample === "object" ? sample : {});
        const preview = evaluateFormula(expression, scope);

        return res.send({
            status: true,
            statusText: "Formula is valid.",
            data: {
                references,
                functions: FUNCTIONS,
                preview: preview.ok ? preview.value : null,
                previewError: preview.ok ? "" : preview.error
            }
        });
    } catch (error) {
        console.error("Error in validateFormula:", error);
        return res.send({ status: false, message: error.message || "Could not check this formula." });
    }
};

/* GET /api/v2/custom-fields/formula/scope?projectId=&taskId=
 * The names a formula may reference, with the current value where there is one. */
exports.formulaScope = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { projectId, taskId } = req.query || {};
        if (!companyId) return res.send({ status: false, message: "Company ID is required in headers." });

        const definitions = await loadDefinitions(companyId, projectId);
        let task = null;
        if (isObjectIdString(taskId)) {
            task = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: new mongoose.Types.ObjectId(taskId), deletedStatusKey: { $ne: 1 } }]
            }, "findOne");
        }

        const builtins = builtinScope(task || {}, []);
        const names = Object.keys(builtins).map((name) => ({ name, source: "task", value: builtins[name] }));
        definitions.forEach((definition) => {
            const key = slug(definition.fieldTitle);
            if (!key) return;
            const entry = ((task && task.customField) || {})[String(definition._id)];
            names.push({
                name: key,
                source: definition.fieldType,
                fieldId: String(definition._id),
                title: definition.fieldTitle || "",
                value: entry && typeof entry === "object" ? entry.fieldValue : entry
            });
        });

        return res.send({ status: true, statusText: "Scope fetched.", data: { names, functions: FUNCTIONS, rollupFunctions: ROLLUP_FUNCTIONS } });
    } catch (error) {
        console.error("Error in formulaScope:", error);
        return res.send({ status: false, message: error.message || "Could not read the formula scope." });
    }
};

/* POST /api/v2/custom-fields/compute
 * body: { projectId, taskIds: [], scope?: 'subtask' | 'sprint' }
 * Evaluates every formula/rollup field for the given tasks and STORES the result
 * on each task, so the value a client renders was computed on the server. */
exports.computeFields = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { projectId, taskIds, scope } = req.body || {};
        if (!companyId) return res.send({ status: false, message: "Company ID is required in headers." });

        const ids = (Array.isArray(taskIds) ? taskIds : []).filter(isObjectIdString);
        if (!ids.length) return res.send({ status: false, message: "At least one task id is required." });
        if (ids.length > 200) return res.send({ status: false, message: "At most 200 tasks per request." });

        const definitions = await loadDefinitions(companyId, projectId);
        const computed = definitions.filter((definition) => ["formula", "rollup"].includes(definition.fieldType));
        if (!computed.length) return res.send({ status: true, statusText: "Nothing to compute.", data: { updated: 0, values: {} } });

        const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: { $in: objectIds }, deletedStatusKey: { $ne: 1 } }]
        }, "find") || [];

        const bySprint = scope === "sprint";
        const parentQuery = bySprint
            ? { sprintId: { $in: [...new Set(tasks.map((task) => task.sprintId).filter(Boolean))] } }
            : { ParentTaskId: { $in: ids } };
        const children = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ ...parentQuery, deletedStatusKey: { $ne: 1 } }]
        }, "find") || [];

        const out = {};
        const errors = {};
        for (const task of tasks) {
            const kids = bySprint
                ? children.filter((child) => String(child.sprintId) === String(task.sprintId) && String(child._id) !== String(task._id))
                : children.filter((child) => String(child.ParentTaskId) === String(task._id));
            const result = computeTaskFields({ definitions, task, children: kids });

            const $set = {};
            computed.forEach((definition) => {
                const id = String(definition._id);
                const value = result.values[id];
                $set[`customField.${id}`] = {
                    fieldValue: value === null || value === undefined ? "" : value,
                    fieldTitle: definition.fieldTitle || "",
                    fieldType: definition.fieldType,
                    computedAt: new Date()
                };
            });

            // eslint-disable-next-line no-await-in-loop
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: task._id }, { $set }]
            }, "updateOne");

            socketEmitter.emit("update", { type: "update", data: { _id: task._id }, updatedFields: { customField: $set }, module: "task" });
            out[String(task._id)] = result.values;
            if (Object.keys(result.errors).length) errors[String(task._id)] = result.errors;
        }

        return res.send({ status: true, statusText: "Computed fields updated.", data: { updated: tasks.length, values: out, errors } });
    } catch (error) {
        console.error("Error in computeFields:", error);
        return res.send({ status: false, message: error.message || "Could not compute these fields." });
    }
};

/* A formula is refused at save when it will not parse or when it closes a cycle
 * with an already-stored formula — the two failures the mock warns about. */
exports.guardFormulaDefinition = async (companyId, updateObject, fieldId) => {
    const definition = updateObject && typeof updateObject === "object" ? updateObject : {};
    if (definition.fieldType !== "formula") return { valid: true, reason: "" };
    const expression = String(definition.formulaExpression || "").trim();
    if (!expression) return { valid: false, reason: "A formula field needs an expression." };
    const definitions = await loadDefinitions(companyId, null);
    return validateFormulaDefinition({ definitions, fieldId, fieldTitle: definition.fieldTitle, expression });
};
