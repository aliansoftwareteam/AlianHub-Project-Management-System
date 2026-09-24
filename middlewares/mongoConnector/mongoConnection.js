const mongoose = require("mongoose");
const { checkConnectionExists, createConnection, updateConnectionRecord, connections, closeConnection } = require("./helper");
const { isRetiring, retiringRefusal } = require("./retiring");
const { dbCollections } = require("../../Config/collections");

const COMPANY_DB = /^[a-f0-9]{24}$/i;

const requestedDbs = []
function removeFromArray(db) {
    if(requestedDbs.includes(db)) {
        const index = requestedDbs.findIndex(x => x === db)
        requestedDbs.splice(index, 1);
    }
}

const openConnection = (companyId) => {
    return new Promise((resolve, reject) => {
        try {
            const db = companyId
            if (!db) {
                reject({ status: false, statusText: "No db included" });
            }

            let locals;

            if(requestedDbs.includes(db)) {
                // console.log("INCLUDES REQUEST");
                let reCheck = 0
                const interval = setInterval(() => {
                    if(reCheck >= 60) {
                        // console.log("INTERVAL >> CONNECTION CREATE");
                        clearInterval(interval);
                        createConnection(db)
                        .then((conData) => {
                            // console.log("REQUESTED DB FOUND", db);
                            updateConnectionRecord(db, conData);
                            locals = conData.connection
                            resolve({ status: true, database: locals });
                        })
                        .catch((error) => {
                            // throw error;
                            // console.log("REQUESTED DB NOT FOUND", db);
                            removeFromArray(db)
                            reject({ status: false, statusText: error.message });
                        })

                        return;
                    }
                    reCheck++;
                    const connection = checkConnectionExists({ connections, db })
                    if(connection) {
                        // console.log("INTERVAL >> CONNECTION FOUND");
                        clearInterval(interval);
                        locals = connection.connection
                        removeFromArray(db)
                        resolve({ status: true, database: locals });
                    }
                }, 1000)
            } else {
                // console.log("PUSH REQUESTED DB: ", db);

                if (connections.length) {
                    const connection = checkConnectionExists({ connections, db })
                    if (connection) {
                        updateConnectionRecord(db)
                        // console.log("REQUESTED DB FOUND", db);
                        // removeFromArray(db)
                        locals = connection.connection
                        resolve({ status: true, database: locals });
                    } else {
                        requestedDbs.push(db);
                        createConnection(db)
                            .then((conData) => {
                                // console.log("REQUESTED DB FOUND", db);
                                updateConnectionRecord(db, conData);
                                removeFromArray(db)
                                locals = conData.connection
                                resolve({ status: true, database: locals });
                            })
                            .catch((error) => {
                                // throw error;
                                removeFromArray(db)
                                // console.log("REQUESTED DB NOT FOUND", db);
                                reject({ status: false, statusText: error.message });
                            })
                    }
                } else {
                    requestedDbs.push(db);
                    createConnection(db)
                        .then((conData) => {
                            removeFromArray(db)
                            // console.log("REQUESTED DB FOUND", db);
                            updateConnectionRecord(db, conData);
                            locals = conData.connection
                            resolve({ status: true, database: locals });
                        })
                        .catch((error) => {
                            removeFromArray(db)
                            // console.log("REQUESTED DB NOT FOUND", db);
                            reject({ status: false, statusText: error.message });
                            // throw error;
                        })
                }
            }
        } catch (err) {
            reject(err);
        }
    })
}

/* The deleting process marks the company's global row before it drops the database, so a process
 * that never saw the deletion start still refuses to open a connection that would recreate it.
 * Only a pooled global connection is asked: opening one here would leave a connection nobody
 * asked for, which kept test processes alive, and a serving process has global pooled anyway. */
const deletingElsewhere = async (db) => {
    if (!COMPANY_DB.test(String(db)) || checkConnectionExists({ connections, db })) return false;
    const global = checkConnectionExists({ connections, db: dbCollections.GLOBAL });
    if (!global) return false;
    try {
        const row = await global.connection.db.collection(dbCollections.COMPANIES).findOne(
            { _id: new mongoose.Types.ObjectId(String(db)), deletingAt: { $exists: true } },
            { projection: { _id: 1 } },
        );
        return Boolean(row);
    } catch (error) {
        return false;
    }
};

exports.handleConnection = async (companyId) => {
    if (isRetiring(companyId) || await deletingElsewhere(companyId)) throw retiringRefusal();
    const opened = await openConnection(companyId);
    // A connection that was still opening when the deletion started must not outlive the drop.
    if (isRetiring(companyId)) {
        closeConnection(companyId);
        throw retiringRefusal();
    }
    return opened;
};