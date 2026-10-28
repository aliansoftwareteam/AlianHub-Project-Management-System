const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');
const buildInfo = require('../../Config/buildInfo');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { tenantOf } = require('../../Config/tenant');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const retention = require('../ScreenshotRetention/helper');
const { trackerAccess, trackerOnInstance } = require('./access');
const { latestRelease } = require('./feed');
const { buildHandshake, readProductName, minTrackerVersion, isManaged } = require('./handshake');
const { portalUrl } = require('../../Config/hostingMode');

const HANDSHAKE_KEY = 'tracker:handshake';
const HANDSHAKE_TTL_SECONDS = 60;
const BYTES_PER_MB = 1024 * 1024;

exports.handshake = async (req, res) => {
    try {
        let payload = myCache.get(HANDSHAKE_KEY);
        if (!payload) {
            const [name, enabled] = await Promise.all([readProductName(), trackerOnInstance()]);
            payload = buildHandshake({
                version: buildInfo.get().version,
                name: name || process.env.APP_NAME,
                enabled,
                minVersion: minTrackerVersion(),
                managed: isManaged(),
            });
            myCache.set(HANDSHAKE_KEY, payload, HANDSHAKE_TTL_SECONDS);
        }
        return res.send({ status: true, statusText: 'Tracker handshake.', data: payload });
    } catch (error) {
        logger.error(`tracker handshake failed: ${error.message}`);
        return res.status(500).send({ status: false, statusText: 'This workspace could not answer the tracker.' });
    }
};

const desktopAppView = ({ company, access, release, policy, managed, portalUrl }) => {
    const sizeMb = company.trackshotSize == null ? NaN : Number(company.trackshotSize);
    return {
        enabled: access.enabled,
        managed,
        portalUrl: managed && portalUrl ? portalUrl : null,
        seats: { used: Math.max(Number(company.trackerUsers) || 0, 0), limit: access.seatLimit },
        release: access.enabled ? release : null,
        screenshots: {
            bytes: Number.isFinite(sizeMb) ? Math.round(sizeMb * BYTES_PER_MB) : null,
            retention: { enabled: Boolean(policy && policy.enabled), maxAgeMonths: policy ? policy.maxAgeMonths : null },
        },
    };
};

exports.desktopAppView = desktopAppView;

exports.desktopApp = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        return res.status(error.statusCode || 403).send({ status: false, statusText: error.message });
    }
    try {
        const query = {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{ _id: new mongoose.Types.ObjectId(companyId) }, { _id: 1, planFeature: 1, trackerUsers: 1, trackshotSize: 1 }],
        };
        const [company, policy] = await Promise.all([
            MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, query, 'findOne'),
            retention.getCompanyPolicy(companyId),
        ]);
        const row = company || {};
        const access = trackerAccess(row.planFeature);
        const release = access.enabled ? await latestRelease({ channel: 'stable' }) : null;
        const data = desktopAppView({ company: row, access, release, policy, managed: isManaged(), portalUrl: portalUrl() });
        return res.send({ status: true, statusText: 'Desktop tracker.', data });
    } catch (error) {
        logger.error(`desktop tracker card failed companyId=${companyId}: ${error.message}`);
        return res.status(500).send({ status: false, statusText: 'The desktop tracker details could not be loaded.' });
    }
};
