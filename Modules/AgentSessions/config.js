const ENV_KEY = 'EXTERNAL_AGENT_SESSIONS';

const isOn = (env = process.env) => ['on', 'true', '1', 'yes'].includes(String(env.EXTERNAL_AGENT_SESSIONS || '').trim().toLowerCase());

const LIMITS = Object.freeze({
    firstActivityMs: 10 * 1000,
    handleMs: 5 * 60 * 1000,
    textChars: 4000,
    activitiesKept: 200,
    activitiesShown: 50,
    activitiesPerMinute: 60,
    sweepMs: 15 * 1000,
    deliveryTimeoutMs: 5000,
    replayWindowSeconds: 300,
    deliveryResponseBytes: 16 * 1024,
});

module.exports = { ENV_KEY, isOn, LIMITS };
