// A replyTo that is given but names no comment on the task is passed on as given, so the comment is refused rather
// than written outside the thread that was meant.

const REPLY_TO = 'To reply in a thread, give replyTo: the id of a comment on this task, as the task\'s comments show it. A reply to a reply joins the same thread.';

const MENTIONS = 'To mention a member so they are notified, write @[Their Name](their member id) with the id from members.list, or @Their Name exactly as members.list shows it; @[All](everyone) reaches everyone who can open the task. Only people who can open the task are notified, and never the person you act for: the answer lists who was told in mentioned, a named person who was not, and why, in notNotified, and a name that matched no one in notFound.';

const REPLY_INPUT = Object.freeze({ replyTo: { type: 'string', pattern: '^[a-fA-F0-9]{24}$', description: 'The comment on this task to reply to' } });

const replyParams = (args) => (args.replyTo === undefined || args.replyTo === null || args.replyTo === '' ? {} : { replyTo: String(args.replyTo).slice(0, 40) });

module.exports = { MENTIONS, REPLY_TO, REPLY_INPUT, replyParams };
