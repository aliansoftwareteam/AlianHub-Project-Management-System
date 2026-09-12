const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const sendMailRef = require('../../Modules/service.js');
const config = require('../../Config/config.js');
const { mongoTimeoutOptions } = require('../../Modules/Agents/engine/timeouts');
const { onFatal } = require('../../Config/processGuards');

// A connection closes asynchronously, so its last lifecycle events land after
// the Jest suite that opened it has torn down; a console write there fails the
// suite with "Cannot log after tests are done". The log file keeps every event.
const reportConnectionState = (message) => {
    logger.info(message);
    if (process.env.NODE_ENV !== 'test') console.log(message);
};

const mailReport = (subject, body) => new Promise((resolve) => {
    sendMailRef.sendAttachMail(subject, body, config.ERRORRECIVEREMAIL, [], (result) => {
        if (!result.status) console.error(`[FATAL] crash report mail failed: ${result.statusText}`);
        resolve();
    });
});

exports.crashReport = async (err) => {
    if (!config.ERRORRECIVEREMAIL) return;
    const name = String(err && err.name || '');
    if (name.includes('MongoNetworkError')) return;
    if (name.includes('MongoServerError')) {
        if (err.code === 8000 && String(err.message).includes('cannot create a new collection')) {
            await mailReport(`Mongo Collection Error in ${config.NODE_ENV} Environment`, err.message);
        }
        return;
    }
    await mailReport(`CRASHED: Mongo Error in ${config.NODE_ENV} Environment`, `${err?.message} > ${err}`);
};

onFatal('crash-report-mail', exports.crashReport);

exports.connect = (db) => {
    return new Promise(async (resolve, reject) => {
        const MONGODB_URL = process.env.MONGODB_URL;
        if (!MONGODB_URL) {
            reject(new Error('No database configured. Set MONGODB_URL in .env or the environment and restart.'));
            return;
        }
        try {
            const baseMongoUrl = MONGODB_URL.replace(/\/+$/, ''); // strip trailing slashes
            // Note: do NOT append ?authSource=admin for mongodb+srv — Atlas SRV TXT records handle auth
            const connStr = baseMongoUrl.startsWith('mongodb+srv')
                ? `${baseMongoUrl}/${db}`
                : `${baseMongoUrl}/${db}?authSource=admin`;
            // Phase 1 perf tuning (SOCKET-PERFORMANCE-PLAN #6, #13):
            //   - maxPoolSize 3 -> 10 (env-overridable). The previous cap of 3
            //     queued any 4th concurrent query per tenant; task-heavy flows
            //     (create, history write, sprint count, notification) easily
            //     saturate that and stack up behind waitQueueTimeoutMS.
            //   - minPoolSize 2 keeps warm sockets so the first request after
            //     idle doesn't pay handshake latency.
            //   - waitQueueTimeoutMS 30000 -> 5000. A queued query that can't
            //     get a socket inside 5s is almost always doomed; failing fast
            //     surfaces the real problem instead of pinning a request
            //     worker for 30s.
            const connection = await mongoose.createConnection(
                connStr, // CONNECTION STRING
                {
                    waitQueueTimeoutMS: Number(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS) || 5000,
                    maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 10,
                    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 2,
                    ...mongoTimeoutOptions(),
                }
            );

            const announce = (state) => reportConnectionState(`MONGO CONNECTION ${db}: ${state}`);

            connection.on('connected', () => {
                announce('connected');
                resolve(connection);
            });
            connection.on('open', () => announce('open'));
            connection.on('disconnected', () => announce('disconnected'));
            connection.on('reconnected', () => announce('reconnected'));
            connection.on('disconnecting', () => announce('disconnecting'));
            connection.on('close', () => announce('close'));

            connection.on('error', (error) => {
                logger.error(`MONGO CONNECTION: error >> ${JSON.stringify(error)}`)
                reject(error)
            });
        } catch (error) {
            reject(error)
        }
    })
}