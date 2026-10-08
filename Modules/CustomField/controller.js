const { myCache } = require("../../Config/config");
const { removeCache } = require("../../utils/commonFunctions");
const { dbCollections } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { recordFieldCreated, recordFieldRenamed } = require("./helpers/customFieldHistory");
const { withFieldDefaults } = require("./helpers/fieldDefaults");
const { PROJECTS_CHANGED, PROJECTS_CHANGED_TEXT, linkPlan, applyLinks, announceFields } = require("./helpers/fieldProjects");

const COMPUTED_KEYS = ['fieldType', 'rollupFunction', 'rollupSourceFieldId', 'formulaExpression'];
const computedChanged = (previous, update) => COMPUTED_KEYS.some((key) => key in update && String(update[key] ?? '') !== String(previous[key] ?? ''));
const logFill = (error) => logger.error(`computed field fill: ${(error && error.message) || error}`);

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
        await this.fillComputed(companyId, response).catch(logFill);
        recordFieldCreated({ companyId, field: response, actorId: req.uid })
            .catch((error) => logger.error(`custom field created history: ${error && error.message}`));

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
                ...withFieldDefaults(updateObject),
                updatedAt: currentDate,
                createdAt: currentDate
            };

            const query = {
                type: dbCollections.CUSTOM_FIELDS,
                data: updateObjectDate
            };

            MongoDbCrudOpration(companyId, query, type)
                .then((response) => {
                    announceFields(companyId, 'insert');
                    removeCache(`aiFieldAutoRefill:${companyId}`);
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
        const { key,type,id } = req.body;
        const updateObject = req.body.updateObject || {};
        const namesProjects = Boolean((req.body.addProjects || []).length || (req.body.removeProjects || []).length);

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
            if (!(Object.keys(updateObject).length || namesProjects) || !(key) || !(id)) {
                return res.status(400).json({message: `${!Object.keys(updateObject).length ? 'Update Object' : !key ? 'Key' : !id ? 'Id' : '' } is Required`});
            }
        }else{
            return res.status(400).json({message: 'Invalid type'});
        }
        const guard = await this.guardFormulaDefinition(companyId, updateObject, id);
        if (!guard.valid) {
            return res.status(400).json({ message: guard.reason });
        }

        const filter = { _id: new mongoose.Types.ObjectId(id) };
        const previous = await MongoDbCrudOpration(companyId, { type: dbCollections.CUSTOM_FIELDS, data: [filter] }, 'findOne');
        const links = linkPlan(previous, req.body);
        if (links.dropped.length) {
            return res.status(409).json({ status: false, code: PROJECTS_CHANGED, statusText: PROJECTS_CHANGED_TEXT, message: PROJECTS_CHANGED_TEXT });
        }

        const updateObjectDate = { ...updateObject, updatedAt: new Date() };
        if (links.clears) updateObjectDate.projectId = [];
        else delete updateObjectDate.projectId;
        const query = {
            type: dbCollections.CUSTOM_FIELDS,
            data:[
                filter,
                { $set: updateObjectDate },
            ]
        };
        const response = await MongoDbCrudOpration(companyId, query, type);
        if (previous) await applyLinks(companyId, previous, links);
        announceFields(companyId, 'update');
        if (previous && (computedChanged(previous, updateObject) || links.add.length || links.clears)) {
            const current = await MongoDbCrudOpration(companyId, { type: dbCollections.CUSTOM_FIELDS, data: [filter] }, 'findOne');
            await this.fillComputed(companyId, current).catch(logFill);
        }
        removeCache(`aiFieldAutoRefill:${companyId}`);
        if (previous) {
            recordFieldRenamed({ companyId, previous, next: updateObject, actorId: req.uid })
                .catch((error) => logger.error(`custom field renamed history: ${error && error.message}`));
        }
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
const { COMPUTED_TYPES, computeTaskFields, descendantsOf, validateFormulaDefinition, slug, builtinScope } = require("./helpers/computeFields");
const { MAX_DEPTH } = require("../Tasks/helpers/taskTreeRules");
const { readableTaskIds } = require("../Tasks/helpers/taskWritePlacement");
const { COMPUTED_SOURCE } = require("../../utils/entityEvents");

const SYSTEM_ACTOR = Object.freeze({ kind: "system", userId: null });

const isObjectIdString = (value) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

const definitionsOf = (rows, projectId) => rows.filter((row) => {
    if (row.global) return true;
    const ids = Array.isArray(row.projectId) ? row.projectId : [row.projectId];
    return ids.map(String).includes(String(projectId));
});

const loadDefinitions = async (companyId, projectId) => {
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [] }, "find") || [];
    return projectId ? definitionsOf(rows, projectId) : rows;
};

const readable = async (companyId, uid, tasks) => {
    const ids = await readableTaskIds(companyId, uid, tasks.map((task) => String(task._id)));
    return tasks.filter((task) => ids.includes(String(task._id)));
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
        if (isObjectIdString(taskId) && (await readableTaskIds(companyId, req.uid, [taskId])).length) {
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

/* A conversation is kept in the tasks collection and is no task: it holds no field and counts under nothing. */
const liveTasks = async (companyId, filter) => await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ ...filter, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true } }]
}, "find") || [];

/* A rollup counts every level under its task, so a change on one row moves the rollups of each task above it.
 * `opened` keeps the tasks the caller can open, and the climb stops at one they cannot: nothing above it is computed or written for them. */
const withTasksAbove = async (companyId, tasks, opened) => {
    const all = [...tasks];
    const known = new Set(all.map((task) => String(task._id)));
    let level = tasks;
    for (let step = 0; step < MAX_DEPTH && level.length; step += 1) {
        const wanted = [...new Set(level.map((task) => String(task.ParentTaskId || "")))].filter((id) => isObjectIdString(id) && !known.has(id));
        // eslint-disable-next-line no-await-in-loop
        level = wanted.length ? await opened(await liveTasks(companyId, { _id: { $in: wanted.map((id) => new mongoose.Types.ObjectId(id)) } })) : [];
        level.forEach((task) => { known.add(String(task._id)); all.push(task); });
    }
    return all;
};

const rowsBelow = async (companyId, tasks) => {
    const rows = [];
    const known = new Set();
    let level = tasks.map((task) => String(task._id));
    for (let step = 0; step < MAX_DEPTH && level.length; step += 1) {
        // eslint-disable-next-line no-await-in-loop
        const found = (await liveTasks(companyId, { ParentTaskId: { $in: level } })).filter((row) => !known.has(String(row._id)));
        found.forEach((row) => { known.add(String(row._id)); rows.push(row); });
        level = found.map((row) => String(row._id));
    }
    return rows;
};

const depthIn = (byId, task) => {
    let depth = 0;
    let at = task;
    while (at && at.ParentTaskId && depth < MAX_DEPTH) {
        at = byId.get(String(at.ParentTaskId));
        depth += 1;
    }
    return depth;
};

const sameStored = (task, id, entry) => {
    const held = ((task && task.customField) || {})[id];
    return Boolean(held) && typeof held === "object" && held.fieldValue === entry.fieldValue && held.fieldType === entry.fieldType;
};

/* Works out every formula and rollup of each task from `rows`, stores it on the task and tells the open clients.
 * The deepest task goes first and its new numbers are put on its row, so a rollup above reads them in the same pass.
 * `onlyChanged` leaves a task whose stored numbers already match alone: no write and no event. */
const storeComputed = async ({ companyId, tasks, rows, everyDefinition, bySprint = false, onlyChanged = false, depth = 0 }) => {
    const out = {};
    const errors = {};
    const rowById = new Map(rows.map((row) => [String(row._id), row]));
    const byId = new Map([...rows, ...tasks].map((row) => [String(row._id), row]));
    const deepestFirst = [...tasks].sort((a, b) => depthIn(byId, b) - depthIn(byId, a));
    for (const task of deepestFirst) {
        const definitions = definitionsOf(everyDefinition, task.ProjectID);
        const computed = definitions.filter((definition) => COMPUTED_TYPES.includes(definition.fieldType));
        if (!computed.length) continue;
        const kids = bySprint
            ? rows.filter((row) => String(row.sprintId) === String(task.sprintId) && String(row._id) !== String(task._id))
            : descendantsOf(task, rows);
        const subtasks = bySprint ? kids : kids.filter((row) => String(row.ParentTaskId) === String(task._id));
        const result = computeTaskFields({ definitions, task, children: kids, subtasks });
        out[String(task._id)] = result.values;
        if (Object.keys(result.errors).length) errors[String(task._id)] = result.errors;

        const $set = {};
        const entries = {};
        computed.forEach((definition) => {
            const id = String(definition._id);
            const value = result.values[id];
            entries[id] = {
                fieldValue: value === null || value === undefined ? "" : value,
                fieldTitle: definition.fieldTitle || "",
                fieldType: definition.fieldType,
                computedAt: new Date()
            };
            if (!onlyChanged || !sameStored(task, id, entries[id])) $set[`customField.${id}`] = entries[id];
        });
        const row = rowById.get(String(task._id));
        if (row) row.customField = { ...(row.customField || {}), ...entries };
        if (!Object.keys($set).length) continue;

        // Nobody edited the task, so the time it was last changed stays: lists sorted by it and the notices that read it are not moved.
        // eslint-disable-next-line no-await-in-loop
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: task._id }, { $set }, { returnDocument: "after", timestamps: false }]
        }, "findOneAndUpdate");

        // The relay places a change by the row's project, list and people, so the stored row is what is sent.
        if (updated) socketEmitter.emit("update", { type: "update", data: updated, updatedFields: $set, module: "task", companyId, source: COMPUTED_SOURCE, actor: SYSTEM_ACTOR, depth });
    }
    return { out, errors };
};

const ROLLUP_FILL_LIMIT = 500;
const FILL_BATCH = 200;
exports.ROLLUP_FILL_LIMIT = ROLLUP_FILL_LIMIT;

const hasValue = { $exists: true, $nin: ["", null] };

const fieldProjectsFilter = (field) => {
    if (field.global === true) return {};
    const projectIds = [].concat(field.projectId || []).map(String).filter(isObjectIdString);
    return projectIds.length ? { ProjectID: { $in: projectIds.map((id) => new mongoose.Types.ObjectId(id)) } } : null;
};

/* A rollup made or changed after its source values were entered has nothing stored, and a task shows a dash until
 * one of its subtasks is saved again. The tasks above a subtask that holds a source value are computed here, from at
 * most ROLLUP_FILL_LIMIT such subtasks; past that the rest fill in as their subtasks change. */
const fillRollup = async (companyId, field) => {
    const inProjects = fieldProjectsFilter(field);
    if (!inProjects) return 0;
    const sourceId = isObjectIdString(String(field.rollupSourceFieldId || "")) ? String(field.rollupSourceFieldId) : "";

    const holders = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            { ...inProjects, deletedStatusKey: { $ne: 1 }, ParentTaskId: hasValue, ...(sourceId ? { [`customField.${sourceId}.fieldValue`]: hasValue } : {}) },
            { ParentTaskId: 1, ancestors: 1 },
            { limit: ROLLUP_FILL_LIMIT, lean: true }
        ]
    }, "find") || [];
    const above = [...new Set(holders.flatMap((row) => [row.ParentTaskId, ...(Array.isArray(row.ancestors) ? row.ancestors : [])]).map(String))].filter(isObjectIdString);
    if (!above.length) return 0;

    const tasks = await liveTasks(companyId, { ...inProjects, _id: { $in: above.map((id) => new mongoose.Types.ObjectId(id)) } });
    const { out } = await storeComputed({ companyId, tasks, rows: await rowsBelow(companyId, tasks), everyDefinition: await loadDefinitions(companyId, null) });
    return Object.keys(out).length;
};

/* A formula made or changed after the values it reads were entered: the newest ROLLUP_FILL_LIMIT live tasks of its
 * projects are worked out at once, a batch at a time, with every rollup above them; the rest fill in as they change. */
const fillFormula = async (companyId, field) => {
    const inProjects = fieldProjectsFilter(field);
    if (!inProjects) return 0;
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ...inProjects, deletedStatusKey: { $nin: [1, 2, 3] }, mainChat: { $ne: true } }, { _id: 1 }, { sort: { _id: -1 }, limit: ROLLUP_FILL_LIMIT, lean: true }]
    }, "find") || [];
    const ids = rows.map((row) => String(row._id));
    let filled = 0;
    for (let at = 0; at < ids.length; at += FILL_BATCH) {
        // eslint-disable-next-line no-await-in-loop
        filled += await exports.refreshComputed(companyId, ids.slice(at, at + FILL_BATCH));
    }
    return filled;
};

exports.fillComputed = async (companyId, field) => {
    if (!companyId || !field) return 0;
    if (field.fieldType === "rollup") return fillRollup(companyId, field);
    return field.fieldType === "formula" ? fillFormula(companyId, field) : 0;
};

/* POST /api/v2/custom-fields/compute
 * body: { taskIds: [], scope?: 'subtask' | 'sprint' }
 * Evaluates every formula/rollup field of each task's own project for the given tasks, and for the tasks above
 * them, and STORES the result on each task, so the value a client renders was computed on the server.
 * A rollup counts every subtask under its task, on every level, each once: the stored number is the whole one,
 * which is what a list shows while part of the tree is not loaded. Only tasks the caller can open are loaded,
 * computed, written and answered. */
exports.computeFields = async (req, res) => {
    try {
        const companyId = req.headers["companyid"];
        const { taskIds, scope } = req.body || {};
        if (!companyId) return res.send({ status: false, message: "Company ID is required in headers." });

        const ids = (Array.isArray(taskIds) ? taskIds : []).filter(isObjectIdString);
        if (!ids.length) return res.send({ status: false, message: "At least one task id is required." });
        if (ids.length > 200) return res.send({ status: false, message: "At most 200 tasks per request." });

        const everyDefinition = await loadDefinitions(companyId, null);
        if (!everyDefinition.some((definition) => COMPUTED_TYPES.includes(definition.fieldType))) {
            return res.send({ status: true, statusText: "Nothing to compute.", data: { updated: 0, values: {} } });
        }

        const openable = await readableTaskIds(companyId, req.uid, ids);
        const asked = openable.length ? await liveTasks(companyId, { _id: { $in: openable.map((id) => new mongoose.Types.ObjectId(id)) } }) : [];
        const bySprint = scope === "sprint";
        const tasks = bySprint ? asked : await withTasksAbove(companyId, asked, (found) => readable(companyId, req.uid, found));
        const rows = bySprint
            ? await liveTasks(companyId, { sprintId: { $in: [...new Set(tasks.map((task) => task.sprintId).filter(Boolean))] } })
            : await rowsBelow(companyId, tasks);

        const { out, errors } = await storeComputed({ companyId, tasks, rows, everyDefinition, bySprint });

        return res.send({ status: true, statusText: "Computed fields updated.", data: { updated: Object.keys(out).length, values: out, errors } });
    } catch (error) {
        console.error("Error in computeFields:", error);
        return res.send({ status: false, message: error.message || "Could not compute these fields." });
    }
};

/* A task write changed something a formula or a rollup reads (computedRefresh.js). Those tasks and every task above
 * them are worked out again and stored. Nobody is answered, so no caller's access narrows the climb; open clients hear
 * of it through the relay, which sends a row only to those who can open it. */
exports.refreshComputed = async (companyId, taskIds, { depth = 0 } = {}) => {
    const ids = [...new Set((Array.isArray(taskIds) ? taskIds : []).map(String))].filter(isObjectIdString);
    if (!companyId || !ids.length) return 0;
    const everyDefinition = await loadDefinitions(companyId, null);
    if (!everyDefinition.some((definition) => COMPUTED_TYPES.includes(definition.fieldType))) return 0;
    const asked = await liveTasks(companyId, { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } });
    if (!asked.length) return 0;
    const tasks = await withTasksAbove(companyId, asked, (found) => found);
    const { out } = await storeComputed({ companyId, tasks, rows: await rowsBelow(companyId, tasks), everyDefinition, onlyChanged: true, depth });
    return Object.keys(out).length;
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
