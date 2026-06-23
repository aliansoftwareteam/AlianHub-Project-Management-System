const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { SendEmail } = require("../../service");
const { usersNeedingReminder, reminderSubject, reminderHtml } = require("../helpers/reminderRules");
const logger = require("../../../Config/loggerConfig");

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

// Email a "log your time today" reminder to each company member who hasn't logged today.
const sendTimeRemindersForCompany = async (companyId) => {
    if (!companyId) return { reminded: 0, total: 0, users: [] };
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
    const targets = usersNeedingReminder({ users: users || [], loggedUserIds: loggedIds });
    const subject = reminderSubject();
    const results = [];
    for (const u of targets) {
        // eslint-disable-next-line no-await-in-loop
        const sent = await sendOne(subject, reminderHtml(u.Employee_Name), u.Employee_Email);
        results.push({ userId: String(u._id), email: u.Employee_Email, sent });
    }
    return { reminded: results.filter((r) => r.sent).length, total: targets.length, users: results };
};

// Cron entry — every company. nextRun advancement is N/A; idempotent per day.
const runRemindersForAllCompanies = async () => {
    try {
        const companies = await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1 }],
        }, 'find');
        for (const c of (companies || [])) {
            // eslint-disable-next-line no-await-in-loop
            await sendTimeRemindersForCompany(String(c._id)).catch((e) => logger.error(`[timeReminders] ${c._id}: ${e.message}`));
        }
    } catch (error) {
        logger.error(`[timeReminders] runForAllCompanies: ${error.message}`);
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

exports.sendTimeRemindersForCompany = sendTimeRemindersForCompany;
exports.runRemindersForAllCompanies = runRemindersForAllCompanies;
