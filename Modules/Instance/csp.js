const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const contentSecurityPolicy = require('../../Config/contentSecurityPolicy');

const DAYS = 7;
const TOP = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const aggregate = (pipeline) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.CSP_REPORTS, data: [pipeline] }, 'aggregate');

const since = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (DAYS - 1) * DAY_MS);
};

exports.summary = async (req, res) => {
    try {
        const recent = { $match: { day: { $gte: since() } } };
        const [hosts, directives] = await Promise.all([
            aggregate([recent, { $group: { _id: { blockedHost: '$blockedHost', directive: '$directive' }, count: { $sum: '$count' }, lastSeen: { $max: '$lastSeen' } } }, { $sort: { count: -1 } }]),
            aggregate([recent, { $group: { _id: '$directive', count: { $sum: '$count' } } }, { $sort: { count: -1 } }]),
        ]);
        const header = contentSecurityPolicy.headerOf();
        return res.send({
            status: true,
            statusText: 'Content security policy.',
            data: {
                mode: contentSecurityPolicy.modeOf(),
                header: header ? header.name : null,
                policy: contentSecurityPolicy.policyOf(process.env, { reportingApi: Boolean(req.secure) }),
                reportPath: contentSecurityPolicy.REPORT_PATH,
                days: DAYS,
                total: directives.reduce((sum, row) => sum + row.count, 0),
                hosts: hosts.slice(0, TOP).map((row) => ({ blockedHost: row._id.blockedHost, directive: row._id.directive, count: row.count, lastSeen: row.lastSeen })),
                directives: directives.slice(0, TOP).map((row) => ({ directive: row._id, count: row.count })),
            },
        });
    } catch (error) {
        return res.status(500).send({ status: false, statusText: error.message });
    }
};
