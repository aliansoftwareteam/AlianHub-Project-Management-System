const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const { unlimited } = require('./checks');

const MIB = 1024 * 1024;
const PLAN_EVENT = 'PLAN_UPDATED';
const PUBLIC_CONFIG_KEY = 'instance:public-config';

const UNLIMITED = Object.freeze({ seats: null, guests: null, workspaces: null, storageBytes: null, maxFileBytes: null, emailsPerDay: null });
const SELF_HOSTED_TRACKER = Object.freeze({ enabled: true, seats: null });

const platformEntitlements = () => require('../Platform/entitlements');

/* Self-hosted there is no document: every limit is open and the per-workspace planFeature keeps
 * deciding what it always decided. */
const document = () => (hostingMode.isManaged() ? platformEntitlements().currentEntitlements() : null);

function limits() {
    const doc = document();
    if (!doc) return { ...UNLIMITED };
    const given = doc.limits || {};
    return Object.fromEntries(Object.keys(UNLIMITED).map((key) => [key, unlimited(given[key]) ? null : Number(given[key])]));
}

function feature(name) {
    const doc = document();
    if (!doc) return name === 'timeTracker' ? { ...SELF_HOSTED_TRACKER } : true;
    const features = doc.features || {};
    if (name === 'timeTracker') {
        const tracker = features.timeTracker || {};
        return { enabled: tracker.enabled === true, seats: unlimited(tracker.seats) ? null : Number(tracker.seats) };
    }
    return features[name] === true;
}

const lifecycle = () => (hostingMode.isManaged() ? require('../Platform/lifecycle').lifecycle() : 'active');

function summary() {
    const doc = document();
    if (!doc) return { managed: false, plan: null, version: 0, limits: limits(), timeTracker: feature('timeTracker'), portalUrl: '' };
    return {
        managed: true,
        plan: doc.plan || '',
        version: Number(doc.version) || 0,
        issuedAt: doc.issuedAt || null,
        graceUntil: doc.graceUntil || null,
        limits: limits(),
        timeTracker: feature('timeTracker'),
        features: { customDomain: feature('customDomain'), ownSmtp: feature('ownSmtp'), sso: feature('sso') },
        portalUrl: hostingMode.portalUrl(),
    };
}

const mebibytes = (bytes) => (unlimited(bytes) ? null : Math.floor(Number(bytes) / MIB));

/* The numbers the browser screens already read off each workspace (Members, imports, upload size),
 * plus the two the desktop tracker handshake reads (066). */
function planFeaturePatch(doc) {
    const given = (doc && doc.limits) || {};
    const tracker = (doc && doc.features && doc.features.timeTracker) || {};
    const numberOrNull = (value) => (unlimited(value) ? null : Number(value));
    return {
        users: numberOrNull(given.seats),
        guestUser: numberOrNull(given.guests),
        bucketStorage: mebibytes(given.storageBytes),
        maxFileSize: mebibytes(given.maxFileBytes),
        timeTrackerUser: numberOrNull(tracker.seats),
        trackerTimesheet: tracker.enabled === true,
    };
}

/* A workspace created on a hosted instance starts from the plan, not from the unlimited default. */
function planFeatureFor(base) {
    if (!hostingMode.isManaged()) return base;
    return { ...(base || {}), ...planFeaturePatch(platformEntitlements().currentEntitlements()) };
}

function mongoWriter() {
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    const { SCHEMA_TYPE } = require('../../Config/schemaType');
    return (patch) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES,
        data: [{}, { $set: Object.fromEntries(Object.entries(patch).map(([key, value]) => [`planFeature.${key}`, value])) }],
    }, 'updateMany');
}

function forgetCaches() {
    const { myCache } = require('../../Config/config');
    const { removeCache } = require('../../utils/commonFunctions');
    removeCache('companyData_', true);
    myCache.del(PUBLIC_CONFIG_KEY);
    require('./seats').forgetSeats();
    require('./uploads').forgetStorage();
}

const defaultBroadcast = (event, payload) => require('../../socket/controller/instanceSocket').broadcast(event, payload);

/* Called by 062 after a newer verified document is stored, and at boot from the stored one (or the
 * Starter defaults). 061's ownership overrides and the portal URL live in memory only, so both are
 * set again every time. */
async function applyEntitlements(payload, { writePlanFeatures = mongoWriter(), broadcast = defaultBroadcast } = {}) {
    if (!hostingMode.isManaged()) return { applied: false };
    const doc = payload || platformEntitlements().currentEntitlements();
    hostingMode.setPortalUrl(doc.portalUrl || '');
    const features = doc.features || {};
    require('../../Config/instanceSettings').setOwnershipOverrides(features.ownSmtp === true ? { mail: 'customer' } : {});
    const patch = planFeaturePatch(doc);
    await writePlanFeatures(patch);
    forgetCaches();
    broadcast(PLAN_EVENT, { version: Number(doc.version) || 0, plan: doc.plan || '', at: new Date() });
    logger.info(`[entitlements] applied version ${Number(doc.version) || 0} (${doc.plan || 'default'})`);
    return { applied: true, version: Number(doc.version) || 0, planFeature: patch };
}

async function bootEntitlements(options) {
    if (!hostingMode.isManaged()) return { applied: false };
    try {
        return await applyEntitlements(null, options);
    } catch (error) {
        logger.error(`[entitlements] boot apply failed: ${error && error.message ? error.message : error}`);
        return { applied: false, error: error && error.message };
    }
}

module.exports = {
    PLAN_EVENT, UNLIMITED, limits, feature, lifecycle, summary, planFeaturePatch, planFeatureFor, applyEntitlements, bootEntitlements,
};
