const week = require('../Agents/timesheetWeek');
const { GRANT } = require('./manageFlag');
const { WRITE_TARGET } = require('../Goals/goalTokens');

// The person's own timesheet week. A week covers every project, so a connection kept to some projects reads and
// sends none. Sending is filed for the person to approve in AlianHub; approving a week is not a tool.

const REASON_MAX = 500;
const DAY_INPUT = Object.freeze({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Any day of the week, YYYY-MM-DD; this week when left out' });
const NARROWED = Object.freeze({ error: 'This connection is limited to some projects, and a timesheet week covers all of them. Ask the person to look at it in AlianHub.' });
const input = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });

const covered = (vis) => vis.allowsPage({ visibility: 'project' });

/* The week the call names, for the person; answered at once where it cannot be sent, so nobody approves what cannot be made. */
const weekToFile = async (ctx, args, vis) => {
    const filed = { ...args, userId: String(ctx.userId || '') };
    if (!covered(vis)) return { args: filed };
    const status = await week.weekStatus({ companyId: ctx.companyId, uid: ctx.userId, day: args.weekOf });
    const stopped = week.submitProblem(status);
    return stopped ? { answer: { ok: false, error: stopped, week: status } } : { args: { ...filed, periodStart: status.periodStart } };
};

const TOOLS = [
    {
        name: week.READ,
        action: week.READ,
        visibility: 'filtered',
        strict: true,
        description: 'Shows where the person\'s own timesheet week stands, Monday to Sunday: not_submitted, submitted, approved, rejected (sent back, with the reason) or reopened, with the time it holds. '
            + 'Only the person\'s own week. Changes nothing.',
        input: input({ weekOf: DAY_INPUT }),
        readParams: () => ({}),
        run: async (ctx, args, vis) => {
            if (!covered(vis)) return { ...NARROWED };
            return week.weekStatus({ companyId: ctx.companyId, uid: ctx.userId, day: args.weekOf });
        },
    },
    {
        name: week.SUBMIT,
        action: week.SUBMIT,
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: () => WRITE_TARGET,
        description: 'Asks to send the person\'s own timesheet week for approval, as the Submit week button does. Nothing is sent by this call: it answers that the week is waiting, '
            + 'and the person approves it in AlianHub. Only they can approve it, and once sent only an owner or admin can reopen it. '
            + 'Approving, sending back or reopening a week, the person\'s or anyone else\'s, is for a person to do in AlianHub. A connection limited to some projects cannot use this.',
        input: input({
            weekOf: DAY_INPUT,
            note: { type: 'string', maxLength: week.NOTE_MAX, description: 'A note for whoever reviews the week' },
            reason: { type: 'string', maxLength: REASON_MAX, description: 'Why, in one line. It is kept in the record of changes.' },
        }),
        prepare: weekToFile,
        params: (args) => week.draftOf(args, args.userId),
    },
];

const SCOPES = Object.freeze({ [week.READ]: 'time:read', [week.SUBMIT]: 'time:write' });

module.exports = { TOOLS, SCOPES };
