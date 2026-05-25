const { connect } = require("../../utils/mongo-handler/mongoConnector.js");
const logger = require("../../Config/loggerConfig.js")

/**
 * CONNECTION SCHEMA
 * {
 *  db: "db",
 *  connection: mongoConnection,
 *  createdAt: timestamp,
 *  lastRequest: timestamp
 * }
*/
exports.connections = [];

exports.updateConnectionRecord = (db, conData = {}) => {
    const index = exports.connections.findIndex((x) => x.db === db)
    if (index !== -1) {
        exports.connections[index].lastRequest = new Date().getTime();
        // console.log("EXISTING CONNECTION", exports.connections.map((x) => ({ db: x.db, last: x.lastRequest })));
    } else {
        exports.connections.push({ ...conData })
        // console.log("NEW CONNECTION", exports.connections.map((x) => ({ db: x.db, last: x.lastRequest })));
    }
}

exports.checkConnectionExists = ({ connections = [], db = null }) => {
    const connection = connections.find(x => x.db === db)
    if (connection) {
        return connection;
    } else {
        return null;
    }
}

exports.createConnection = (db) => {
    return new Promise((resolve, reject) => {
        try {
            let retries = 0;

            function handleMongoConnection() {
                connect(db)
                .then((connection) => {
                    retries=0;
                    resolve({
                        db: db,
                        connection: connection,
                        createdAt: new Date().getTime(),
                        lastRequest: new Date().getTime()
                    })
                    logger.info("MONGO CONNECTION SUCCESS!!");
                })
                .catch((error) => {
                    if(retries > 5) {
                        logger.error("ERROR in mongo connection: ", error);
                        reject(error);
                    } else {
                        logger.error("CONNECTION FAILED! ", error?.message);
                        logger.error("RETRYING in 5sec");
                        setTimeout(() => {
                            retries++;
                            logger.error("RETRIES>", retries);
                            handleMongoConnection();
                        }, 5000);
                    }
                });
            };
            handleMongoConnection();
        } catch (err) {
            reject(err)
        }
    })
}

exports.closeConnection = (db) => {
    const index = exports.connections.findIndex((x) => x.db === db)

    if (index !== -1) {
        exports.connections[index].connection.close();
        exports.connections.splice(index, 1);
        console.log("NEW CONNECTION", exports.connections.map((x) => ({ db: x.db, last: x.lastRequest })));
    }
}

exports.startInterval = () => {
    const minute = 60 * 1000;
    const timeout = 5 * minute;
    const terminate = 30 * minute
    setInterval(() => {
        const terminateConnections = exports.connections.filter((x) => new Date().getTime() - x.lastRequest >= terminate)

        terminateConnections.forEach((x) => {
            x.connection.close();

            const index = exports.connections.findIndex((y) => y.db === x.db)
            if (index !== -1) {
                exports.connections.splice(index, 1);
            }
        })
        console.log("ACTIVE CONNECTIONS: ", exports.connections.length)
        console.log("ACTIVE CONNECTIONS: ", exports.connections.map((x) => ({state: x.connection?.readyState, db: x.db})))
    }, timeout)
}