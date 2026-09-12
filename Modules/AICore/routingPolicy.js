/**
 * The per-workspace routing policy: which model each task class prefers, and
 * the quality floor and latency target it must clear.
 *
 * Stored on the company row, like the agent budget already is, because it is
 * workspace configuration rather than tenant data. Nothing here routes a call:
 * `effective()` is what a router reads, and it answers with the platform
 * defaults — today's behaviour — until AI_MODEL_ROUTER is on and a class has
 * a model set.
 */
'use strict';

const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const taskClass = require('./taskClass');
const modelPin = require('./modelPin');
const { routerEnabled } = require('./llmProvider/normalise');

const LATENCY_MIN_MS = 250;
const LATENCY_MAX_MS = 600000;
const COMPANY_FIELD = 'aiRoutingPolicy';

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const readCompany = (companyId) => MongoDbCrudOpration(dbCollections.GLOBAL, {
    type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, COMPANY_FIELD],
}, 'findOne').catch(() => null);

const writeCompany = async (companyId, value) => {
    await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{ _id: oid(companyId) }, { $set: { [COMPANY_FIELD]: value } }] }, 'updateOne');
    removeCache(`companyData_${companyId}`);
};

const entryOf = (stored, key) => {
    const definition = taskClass.definitionOf(key);
    const saved = (stored && stored.classes && stored.classes[key]) || {};
    const latency = Number(saved.latencyTargetMs);
    return {
        taskClass: key,
        model: saved.model ? String(saved.model) : null,
        qualityFloor: taskClass.isQuality(saved.qualityFloor) ? saved.qualityFloor : definition.qualityFloor,
        latencyTargetMs: Number.isFinite(latency) && latency >= LATENCY_MIN_MS && latency <= LATENCY_MAX_MS ? Math.round(latency) : definition.latencyTargetMs,
        inputBudgetTokens: definition.inputBudgetTokens,
        features: [...definition.features],
    };
};

const policyOf = (company) => {
    const stored = (company && company[COMPANY_FIELD]) || null;
    return {
        classes: taskClass.TASK_CLASS_LIST.map((key) => entryOf(stored, key)),
        updatedAt: (stored && stored.updatedAt) || null,
        updatedBy: (stored && stored.updatedBy) || null,
        routerEnabled: routerEnabled(),
    };
};

const get = async (companyId) => policyOf(await readCompany(companyId));

/**
 * @returns {{error?: string, code?: string, value?: object}} One rejected class
 *          rejects the whole save: half a policy is worse than none.
 */
function validate(body, stored) {
    const given = (body && body.classes) || null;
    if (!given || typeof given !== 'object' || Array.isArray(given)) return { error: 'classes must be an object keyed by task class.' };

    const unknown = Object.keys(given).filter((key) => !taskClass.isTaskClass(key));
    if (unknown.length) return { error: `Unknown task class ${unknown.join(', ')}; known classes are ${taskClass.TASK_CLASS_LIST.join(', ')}.` };

    const classes = { ...((stored && stored.classes) || {}) };
    for (const key of Object.keys(given)) {
        const patch = given[key] || {};
        const current = { ...(classes[key] || {}) };

        if (patch.model !== undefined) {
            const pin = modelPin.validatePin(patch.model);
            if (!pin.ok) return { error: pin.message, code: pin.code };
            if (pin.model) current.model = pin.model; else delete current.model;
        }
        if (patch.qualityFloor !== undefined) {
            if (!taskClass.isQuality(patch.qualityFloor)) return { error: `qualityFloor must be one of ${taskClass.QUALITY_ORDER.join(', ')}.` };
            current.qualityFloor = patch.qualityFloor;
        }
        if (patch.latencyTargetMs !== undefined) {
            const ms = Number(patch.latencyTargetMs);
            if (!Number.isFinite(ms) || ms < LATENCY_MIN_MS || ms > LATENCY_MAX_MS) return { error: `latencyTargetMs must be between ${LATENCY_MIN_MS} and ${LATENCY_MAX_MS}.` };
            current.latencyTargetMs = Math.round(ms);
        }
        classes[key] = current;
    }
    return { value: { classes } };
}

const update = async (companyId, body, actorId) => {
    const company = await readCompany(companyId);
    const checked = validate(body, (company && company[COMPANY_FIELD]) || null);
    if (checked.error) return { error: checked.error, code: checked.code, status: 400 };
    await writeCompany(companyId, { ...checked.value, updatedAt: new Date(), updatedBy: actorId ? String(actorId) : null });
    return { policy: await get(companyId) };
};

/**
 * What a router should use for one task class. `model` is null — no preference,
 * the configured provider answers — whenever the flag is off, which is what
 * makes saving a policy a no-op until the instance turns the router on.
 */
async function effective(companyId, key) {
    const wanted = taskClass.isTaskClass(key) ? key : taskClass.DEFAULT_CLASS;
    const entry = entryOf((await readCompany(companyId) || {})[COMPANY_FIELD], wanted);
    return { ...entry, model: routerEnabled() ? entry.model : null, routerEnabled: routerEnabled() };
}

const effectiveForFeature = (companyId, feature) => effective(companyId, taskClass.classOfFeature(feature));

module.exports = { get, validate, update, effective, effectiveForFeature, policyOf, COMPANY_FIELD, LATENCY_MIN_MS, LATENCY_MAX_MS };
