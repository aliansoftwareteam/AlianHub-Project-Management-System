const enabled = () => /^(true|on|1)$/i.test(String(process.env.APP_CONNECTIONS || '').trim());

module.exports = { enabled };
