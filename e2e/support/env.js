const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ROOT, 'e2e', '.state');
const LOCAL_DB_HINT = 'Run `npm run e2e:db` and export E2E_MONGODB_URL=mongodb://127.0.0.1:27018';

function hostsOf(url) {
    const match = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(url);
    if (!match) throw new Error(`E2E_MONGODB_URL is not a MongoDB connection string: ${url}`);
    return { srv: Boolean(match[1]), hosts: match[2].split(',') };
}

function usesOwnerPort(url) {
    const { srv, hosts } = hostsOf(url);
    if (srv) return false;
    return hosts.some((host) => {
        const port = /:(\d+)$/.exec(host);
        return !port || Number(port[1]) === 27017;
    });
}

/* 27017 is where the owner's own alianhub-mongo container listens, and the harness
 * drops every database it can see. CI runs a disposable service container on that
 * port, so the rule only applies outside CI. */
function resolveMongoUrl(env = process.env) {
    const url = String(env.E2E_MONGODB_URL || '').trim().replace(/\/+$/, '');
    if (!url) throw new Error(`E2E_MONGODB_URL is not set. ${LOCAL_DB_HINT}`);
    if (!env.CI && usesOwnerPort(url)) {
        throw new Error(`Refusing to run against ${url}: port 27017 is the local development database. ${LOCAL_DB_HINT}`);
    }
    return url;
}

module.exports = { ROOT, STATE_DIR, resolveMongoUrl, usesOwnerPort };
