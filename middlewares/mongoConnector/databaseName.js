const { dbCollections } = require('../../Config/collections');

const COMPANY_DB = /^[a-f0-9]{24}$/i;

// Callers pass request values straight through as database names, and Mongo creates whatever database it is asked for.
exports.isDatabaseName = (db) => {
    const name = String(db == null ? '' : db);
    return name === dbCollections.GLOBAL || COMPANY_DB.test(name);
};

exports.invalidDatabaseRefusal = () => ({ status: false, statusCode: 400, statusText: 'Invalid database name' });
