const { DateTime } = require('luxon');
const tools = require('../Automations/engine/tools');
const { whoOf, zoneOf } = require('./taskRequests');
const { runAs } = require('./actingAgent');

// The person's own timesheet week, Monday to Sunday as the timesheet screen shows it. An agent reads where the week
// stands and asks to submit it; the submit waits for the person, who alone can approve it, and runs the timesheet
// route's own handler as them. Reviewing a week (approve, send back, reopen) is a person's decision and has no action.

const READ = 'timesheet.week';
const SUBMIT = 'timesheet.week.submit';
const NOTE_MAX = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const NOT_THEIRS = 'A timesheet week is the person\'s own, so only the person whose week it is can approve sending it.';
const NO_PERSON = 'A timesheet week belongs to a person. Ask the person to connect you again.';

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const isDay = (value) => DAY.test(idOf(value)) && DateTime.fromISO(idOf(value)).isValid;

const controller = () => require('../TimesheetApproval/controller');

/* The Monday and Sunday of the week `day` falls in, written as the timesheet screen sends them. */
const weekOf = (day) => {
    const monday = DateTime.fromISO(day).startOf('week');
    return { periodStart: monday.toISODate(), periodEnd: monday.plus({ days: 6 }).toISODate() };
};

/* Today in the person's own zone, for a week that is not named. */
const todayOf = async (uid) => DateTime.now().setZone(await zoneOf(uid)).toISODate();

const handled = (handler, { companyId, uid, query = {}, body = {} }) => new Promise((resolve, reject) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (sent) => { resolve(sent || {}); return res; };
    res.send = res.json;
    Promise.resolve(handler({ uid: idOf(uid), aud: String(companyId), headers: { companyid: String(companyId) }, query, body }, res)).catch(reject);
});

const minutesOf = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const reopenedIn = (doc) => {
    const history = Array.isArray(doc.history) ? doc.history : [];
    return doc.status === 'submitted' && history.length > 0 && history[history.length - 1].action === 'reopen';
};

/* Where the person's week stands, as the timesheet screen reads it. */
const weekStatus = async ({ companyId, uid, day }) => {
    const week = weekOf(day || await todayOf(uid));
    const answer = await handled(controller().getStatus, { companyId, uid, query: { ...week, userId: uid } });
    if (answer.status !== true) throw refuse(answer.statusText || 'The timesheet week could not be read.');
    const doc = answer.data;
    if (!doc) return { ...week, status: 'not_submitted' };
    return {
        ...week,
        status: reopenedIn(doc) ? 'reopened' : String(doc.status),
        totalMinutes: minutesOf(doc.totalMinutes),
        entryCount: minutesOf(doc.entryCount),
        submittedAt: doc.submittedAt || null,
        reviewedAt: doc.reviewedAt || null,
        reviewerName: doc.reviewerName || '',
        ...(doc.rejectionReason ? { sentBackBecause: String(doc.rejectionReason) } : {}),
        ...(doc.note ? { note: String(doc.note) } : {}),
    };
};

/* What a caller names, kept to what the timesheet screen sends: whose week, which week, and an optional note. */
const draftOf = (given, userId) => {
    const asked = given && typeof given === 'object' ? given : {};
    const note = typeof asked.note === 'string' ? asked.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '';
    return {
        userId: OBJECT_ID.test(idOf(userId)) ? idOf(userId).toLowerCase() : '',
        ...(isDay(asked.periodStart) ? weekOf(asked.periodStart) : {}),
        ...(note ? { note } : {}),
    };
};

const approverRefusal = (approverId, requesterId) => (idOf(approverId) && idOf(approverId) === idOf(requesterId) ? '' : NOT_THEIRS);

/* What stops the week from being sent as the person would send it, or ''. */
const submitProblem = (status) => {
    if (status.status === 'approved') return 'That week is already approved, so it cannot be sent again. Ask an owner or admin to reopen it first.';
    if (status.status === 'submitted' || status.status === 'reopened') return 'That week is already waiting for approval.';
    return '';
};

/* The card's lines, for the person whose week it is; anyone else is shown none. */
const preview = async (change, { uid }) => {
    const draft = draftOf(change && change.params, change && change.params && change.params.userId);
    if (!draft.periodStart || !draft.userId || draft.userId !== idOf(uid).toLowerCase()) return null;
    return {
        kind: 'timesheetWeek',
        title: `${draft.periodStart} – ${draft.periodEnd}`,
        lines: [{ kind: 'timesheetWeek', from: draft.periodStart, to: draft.periodEnd }, ...(draft.note ? [{ kind: 'timesheetNote', text: draft.note }] : [])],
    };
};

const executors = {
    async [SUBMIT]({ companyId, actor, params, depth, approvedBy }) {
        const requester = whoOf(actor, depth);
        if (!OBJECT_ID.test(requester.uid)) throw refuse(NO_PERSON);
        const draft = draftOf(params, params && params.userId);
        if (draft.userId !== requester.uid.toLowerCase()) throw refuse(NOT_THEIRS);
        const stopped = approverRefusal(approvedBy, requester.uid);
        if (stopped) throw refuse(stopped);
        if (!draft.periodStart) throw refuse('Name the week by its Monday, written YYYY-MM-DD.');
        const problem = submitProblem(await weekStatus({ companyId, uid: requester.uid, day: draft.periodStart }));
        if (problem) throw refuse(problem);
        const answer = await runAs(requester.mark, () => handled(controller().submitTimesheet, {
            companyId, uid: requester.uid, body: { periodStart: draft.periodStart, periodEnd: draft.periodEnd, periodType: 'week', ...(draft.note ? { note: draft.note } : {}) },
        }));
        if (answer.status !== true) throw refuse(answer.statusText || 'The week was not sent. Try again, or tell the person.');
        const saved = answer.data || {};
        return {
            result: { periodStart: draft.periodStart, periodEnd: draft.periodEnd, status: 'submitted', totalMinutes: minutesOf(saved.totalMinutes) },
            undo: null, entityType: 'timesheet', entityId: idOf(saved._id), entityName: `${draft.periodStart} – ${draft.periodEnd}`,
        };
    },
};

module.exports = { READ, SUBMIT, NOTE_MAX, NOT_THEIRS, executors, weekOf, todayOf, weekStatus, draftOf, approverRefusal, submitProblem, preview };
