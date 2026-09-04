const fs = require('fs');
const path = require('path');
const config = require('./config.js');
const awsRef = require('./aws.js');

const FIREBASE_KEYS = new Set(['APIKEY', 'AUTODOMAIN', 'PROJECTID', 'STORAGEBUCKET', 'MESSAGINGSENDERID', 'APPID', 'MEASUREMENTID']);
const AWS_KEYS = {
    WASABI_ACCESS_KEY: 'wasabiAccessKey',
    WASABI_SECRET_ACCESS_KEY: 'wasabiSecretAccessKey',
    WASABIENDPOINT: 'wasabiEndPoint',
    WASABI_REGION: 'region',
    IAM_ENDPOINT: 'iamEndPoint',
    USERPROFILEBUCKET: 'userProfileBucket',
    WASABI_USERID: 'wasabiUserId',
};
const NUMERIC_KEYS = new Set(['PORT', 'NOOFPRESETCOMPANY']);

const isSet = (value) => value !== undefined && value !== null && String(value) !== '';

/* Pushes a key/value map into every place the app reads configuration from:
 * process.env, the config object and the AWS credential holder. With
 * `override:false` a key already set in the real environment keeps that value
 * (and config is synced to it), which is how the environment stays
 * authoritative over .env and over settings saved in the database. */
function applyEnvMap(map, { override = true } = {}) {
    const applied = [];
    for (const [key, raw] of Object.entries(map || {})) {
        if (raw === undefined || raw === null) continue;
        const envWins = !override && isSet(process.env[key]);
        const effective = envWins ? process.env[key] : String(raw);
        const value = NUMERIC_KEYS.has(key) ? Number(effective) : effective;
        process.env[key] = effective;
        if (FIREBASE_KEYS.has(key)) config[`FIREBASE_${key}`] = value;
        else config[key] = value;
        if (AWS_KEYS[key]) awsRef[AWS_KEYS[key]] = value;
        if (!envWins) applied.push(key);
    }
    return applied;
}

/* Docker images carry no .env: everything arrives through the environment, and
 * a variable set there beats the file even on bare metal. */
function loadDotEnv(envPath = path.join(__dirname, '..', '.env')) {
    if (!fs.existsSync(envPath)) return {};
    const parsed = require('dotenv').parse(fs.readFileSync(envPath));
    applyEnvMap(parsed, { override: false });
    return parsed;
}

module.exports = { applyEnvMap, loadDotEnv, isSet };
