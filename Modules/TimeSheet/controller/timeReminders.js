const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { SendEmail } = require("../../service");
const { usersNeedingReminder, reminderSubject, reminderHtml } = require("../helpers/reminderRules");
const reminderSettings = require("../helpers/reminderSettings");
const logger = require("../../../Config/loggerConfig");

const ROLE_TYPE_COMPANY_OWNER = 1;

// TIME-06 — time-entry reminders. A daily nudge (prod cron) to members who
// haven't logged time today; the /send-reminders endpoint runs the same path
// on demand for testing. Delivery is email via service.SendEmail (Resend/SMTP),
// which fails gracefully when mail isn't configured (e.g. local dev).

const sendOne = (subject, html, email) => new Promise((resolve) => {
    try {
        SendEmail(subject, html, email, true, (r) => resolve(!!(r && r.status)));
    } catch (e) {
        resolve(false);
    }
});

// userIds (as strings) that logged time in [startSec, endSec] (LogStartTime is seconds).
const loggedUserIdsInWindow = async (companyId, startSec, endSec) => {
    const entries = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [{ LogStartTime: { $gte: startSec, $lte: endSec } }, { Loggeduser: 1 }],
    }, 'find');
    return [...new Set((entries || []).map((e) => String(e.Loggeduser)).filter(Boolean))];
};

// Email a "log your time today" reminder to each SELECTED company member who
// hasn't logged today. Governed by the per-company opt-in policy: the reminder
// is OFF by default, and when ON it targets only the explicitly chosen users.
const sendTimeRemindersForCompany = async (companyId) => {
    if (!companyId) return { reminded: 0, total: 0, users: [], skipped: 'no-company' };

    // Opt-in gate. A company must explicitly enable the reminder; disabled is
    // the default so no mail goes out until an owner turns it on.
    const settings = await reminderSettings.getCompanySettings(companyId);
    if (!settings.enabled) return { reminded: 0, total: 0, users: [], skipped: 'disabled' };
    // Enabled but no recipients chosen ⇒ nobody to nudge.
    if (!settings.userIds.length) return { reminded: 0, total: 0, users: [], skipped: 'no-recipients' };

    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    const loggedIds = await loggedUserIdsInWindow(
        companyId, Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000),
    );
    const users = await MongoDbCrudOpration('global', {
        type: SCHEMA_TYPE.USERS,
        data: [{ AssignCompany: companyId }, { Employee_Email: 1, Employee_Name: 1 }],
    }, 'find');
    const targets = usersNeedingReminder({
        users: users || [],
        loggedUserIds: loggedIds,
        allowedUserIds: settings.userIds,
    });
    const subject = reminderSubject();
    const results = [];
    for (const u of targets) {
        // eslint-disable-next-line no-await-in-loop
        const sent = await sendOne(subject, reminderHtml(u.Employee_Name), u.Employee_Email);
        results.push({ userId: String(u._id), email: u.Employee_Email, sent });
    }
    return { reminded: results.filter((r) => r.sent).length, total: targets.length, users: results };
};

// Cron entry — only companies that have opted in. Enumerating on the
// `timeReminderSettings.enabled` flag (rather than every company) keeps the
// nightly pass cheap now that the reminder is off by default. Idempotent per day.
const runRemindersForAllCompanies = async () => {
    try {
        const companies = await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{ 'timeReminderSettings.enabled': true }, { _id: 1 }],
        }, 'find');
        for (const c of (companies || [])) {
            // eslint-disable-next-line no-await-in-loop
            await sendTimeRemindersForCompany(String(c._id)).catch((e) => logger.error(`[timeReminders] ${c._id}: ${e.message}`));
        }
    } catch (error) {
        logger.error(`[timeReminders] runForAllCompanies: ${error.message}`);
    }
};

// Confirm the caller is the company owner. `req.uid` is the only trustworthy
// userId source (set by the JWT middleware); never trust a body-supplied id.
const isCompanyOwner = async (companyId, userId) => {
    if (!companyId || !userId) return false;
    try {
        const record = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(userId) }, { _id: 1, roleType: 1 }],
        }, 'findOne');
        return !!record && Number(record.roleType) === ROLE_TYPE_COMPANY_OWNER;
    } catch (err) {
        logger.error(`[timeReminders] role check failed companyId=${companyId} userId=${userId} ${err && err.message}`);
        return false;
    }
};

// POST /api/v1/timesheet/send-reminders — manual trigger for the caller's company.
exports.triggerReminders = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || (req.body && req.body.companyId);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const result = await sendTimeRemindersForCompany(companyId);
        return res.send({ status: true, statusText: 'Reminders processed.', data: result });
    } catch (error) {
        logger.error(`ERROR in triggerReminders: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

// GET /api/v1/timesheet/reminder-settings
// Returns the caller company's reminder policy. Any authenticated member may
// read it (the Settings card renders a read-only state for non-owners).
exports.getReminderSettings = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || req.headers['companyId'];
        if (!companyId) return res.status(400).send({ status: false, statusText: 'companyId header is required.' });
        const settings = await reminderSettings.getCompanySettings(companyId);
        return res.send({ status: true, statusText: 'OK', data: { settings } });
    } catch (error) {
        logger.error(`[timeReminders] getReminderSettings: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

// PUT /api/v1/timesheet/reminder-settings
// Body: { enabled?: boolean, userIds?: string[] }. Owner-only.
exports.updateReminderSettings = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || req.headers['companyId'];
        const userId = req.uid;
        if (!companyId) return res.status(400).send({ status: false, statusText: 'companyId header is required.' });
        if (!userId) return res.status(401).send({ status: false, statusText: 'authentication required.' });

        const ownerOk = await isCompanyOwner(companyId, userId);
        if (!ownerOk) return res.status(403).send({ status: false, statusText: 'Only the company owner can change reminder settings.' });

        const body = req.body || {};
        const patch = {};
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
        if (body.userIds !== undefined) {
            if (!Array.isArray(body.userIds)) {
                return res.status(400).send({ status: false, statusText: 'userIds must be an array.' });
            }
            patch.userIds = body.userIds;
        }
        if (Object.keys(patch).length === 0) {
            return res.status(400).send({ status: false, statusText: 'No supported fields in body.' });
        }

        const prior = await reminderSettings.getCompanySettings(companyId);
        const markEnabled = patch.enabled === true && !prior.enabled;
        const settings = await reminderSettings.updateCompanySettings(companyId, patch, { markEnabled, userId });

        return res.send({ status: true, statusText: 'Reminder settings updated.', data: { settings } });
    } catch (error) {
        logger.error(`[timeReminders] updateReminderSettings: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

exports.sendTimeRemindersForCompany = sendTimeRemindersForCompany;
exports.runRemindersForAllCompanies = runRemindersForAllCompanies;
