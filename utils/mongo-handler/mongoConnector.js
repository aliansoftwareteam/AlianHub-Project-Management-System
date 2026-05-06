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
            const connection = await mongoose.createConnection(
                `${baseMongoUrl}/${db}?authSource=admin`, // CONNECTION STRING
                {
                    waitQueueTimeoutMS: 30000, // WAIT_QUEUE_TIMEOUT
                    maxPoolSize: 3, // MAX_POOL_SIZE
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