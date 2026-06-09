const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const sendMailRef = require('../../Modules/service.js');
const config = require('../../Config/config.js');
process.on('uncaughtException', (err) => {
    if(err.name.includes("MongoNetworkError")) {
        logger.error(err);
    } else if(err.name.includes("MongoServerError")) {
        if(err?.code === 8000 && err.message.includes("cannot create a new collection")) {
            sendMailRef.sendAttachMail(`Mongo Collection Error in ${config.NODE_ENV} Environment`,err.message,config.ERRORRECIVEREMAIL,[],(result) => {
                if (!result.status) {
                    logger.error(`Mail Sent Error: ${result.statusText}`);
                    return;
                }
            })
        }
    } else {
        sendMailRef.sendAttachMail(`CRASHED: Mongo Error in ${config.NODE_ENV} Environment`,`${err?.message} > ${err}`,config.ERRORRECIVEREMAIL,[],(result) => {
            if (!result.status) {
                logger.error(`Mail Sent Error: ${result.statusText}`);
                return;
            }
        })
        throw err;
    }
})
exports.connect = (db) => {
    return new Promise(async (resolve, reject) => {
        let MONGODB_URL = process.env.MONGODB_URL;
        if (!process.env.MONGODB_URL) {
            const installation = require("../../installationSteps.json");
            MONGODB_URL = installation?.envVar?.MONGODB_URL;
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
                    connectTimeoutMS: 60000, // CONNECT_TIMEOUT
                    serverSelectionTimeoutMS: 60000 // SERVER_SELECTION_TIMEOUT
                }
            );

            connection.on('connected', () => {
                logger.info(`MONGO CONNECTION ${db}: connected`);
                console.log(`MONGO CONNECTION ${db}: connected`);
                resolve(connection);
            });
            connection.on('open', () => {
                logger.info(`MONGO CONNECTION ${db}: open`);
                console.log(`MONGO CONNECTION ${db}: open`);
                // resolve(connection);
            });
            connection.on('disconnected', () => {
                logger.info(`MONGO CONNECTION ${db}: disconnected`);
                console.log(`MONGO CONNECTION ${db}: disconnected`);
            });
            connection.on('reconnected', () => {
                logger.info(`MONGO CONNECTION ${db}: reconnected`);
                console.log(`MONGO CONNECTION ${db}: reconnected`);
            });
            connection.on('disconnecting', () => {
                logger.info(`MONGO CONNECTION ${db}: disconnecting`);
                console.log(`MONGO CONNECTION ${db}: disconnecting`);
            });
            connection.on('close', () => {
                logger.info(`MONGO CONNECTION ${db}: close`);
                console.log(`MONGO CONNECTION ${db}: close`);
            });

            connection.on('error', (error) => {
                logger.error(`MONGO CONNECTION: error >> ${JSON.stringify(error)}`)
                reject(error)
            });
        } catch (error) {
            reject(error)
        }
    })
}