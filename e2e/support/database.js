const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('./env');

const SYSTEM_DATABASES = new Set(['admin', 'config', 'local']);

async function resetDatabase(mongoUrl = resolveMongoUrl()) {
    const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
        const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
        for (const { name } of databases) {
            if (!SYSTEM_DATABASES.has(name)) await client.db(name).dropDatabase();
        }
    } finally {
        await client.close();
    }
}

async function listCompanyIds(mongoUrl = resolveMongoUrl()) {
    const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
        const rows = await client.db('global').collection('companies').find({}, { projection: { _id: 1 } }).toArray();
        return rows.map((row) => String(row._id));
    } finally {
        await client.close();
    }
}

module.exports = { resetDatabase, listCompanyIds };
