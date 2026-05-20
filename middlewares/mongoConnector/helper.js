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

// Issue #162 — bound the per-tenant Mongoose connection pool.
// Defaults: 100 tenants, 30min idle terminate, 5min sweep, 5s grace window.
const MINUTE_MS = 60 * 1000;
const DEFAULT_MAX_TENANT_CONNECTIONS = 100;
const DEFAULT_IDLE_MS = 30 * MINUTE_MS;
const DEFAULT_SWEEP_MS = 5 * MINUTE_MS;
const EVICTION_GRACE_MS = 5 * 1000;

const parsePositiveInt = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

exports.getMaxTenantConnections = () =>
    parsePositiveInt(process.env.MAX_TENANT_CONNECTIONS, DEFAULT_MAX_TENANT_CONNECTIONS);

const closeAndRemove = (index) => {
    const entry = exports.connections[index];
    if (!entry) return;
    try {
        entry.connection.close();
    } catch (err) {
        logger.error(`Error closing tenant connection ${entry.db}: ${err?.message}`);
    }
    exports.connections.splice(index, 1);
};

/**
 * Evict the single least-recently-used connection that is outside the grace
 * window. Returns true if an eviction happened. Grace window prevents closing
 * a connection that was handed to a concurrent request seconds ago and may
 * still be executing queries against it.
 */
exports.evictLeastRecentlyUsed = () => {
    if (exports.connections.length === 0) return false;
    const now = Date.now();
    let oldestIndex = -1;
    let oldestStamp = Infinity;
    for (let i = 0; i < exports.connections.length; i++) {
        const c = exports.connections[i];
        if (now - c.lastRequest < EVICTION_GRACE_MS) continue;
        if (c.lastRequest < oldestStamp) {
            oldestStamp = c.lastRequest;
            oldestIndex = i;
        }
    }
    if (oldestIndex === -1) return false;
    const evicted = exports.connections[oldestIndex].db;
    closeAndRemove(oldestIndex);
    logger.info(`LRU eviction: closed tenant connection ${evicted}`);
    return true;
};

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
        closeAndRemove(index);
    }
}

exports.startInterval = () => {
    const terminate = parsePositiveInt(process.env.TENANT_CONNECTION_IDLE_MS, DEFAULT_IDLE_MS);
    const sweep = parsePositiveInt(process.env.TENANT_CONNECTION_SWEEP_MS, DEFAULT_SWEEP_MS);
    setInterval(() => {
        const now = Date.now();
        // Iterate in reverse so splices inside closeAndRemove don't skip entries.
        for (let i = exports.connections.length - 1; i >= 0; i--) {
            if (now - exports.connections[i].lastRequest >= terminate) {
                closeAndRemove(i);
            }
        }
    }, sweep);
}