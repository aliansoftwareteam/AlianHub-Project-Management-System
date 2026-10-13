// Read on every call like the other feature flags: off, no task is routed and every dispatcher route is closed.
const enabled = () => ['on', 'true', '1'].includes(String(process.env.DISPATCHER || 'off').trim().toLowerCase());

module.exports = { enabled };
