const routes = require('./routes')
const scheduler = require('./scheduler')

exports.init = (app) => {
    routes.init(app)
    // Owns its own every-minute job so reminders fire in dev too — the shared
    // cron.js is production-only. Idempotent; disable with GENERAL_REMINDERS_CRON=off.
    scheduler.start()
}
