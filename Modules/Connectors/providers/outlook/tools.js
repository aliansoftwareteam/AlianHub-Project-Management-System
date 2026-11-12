const ME = 'https://graph.microsoft.com/v1.0/me';
const MAIL = 'Mail.ReadWrite';
const CALENDAR = 'Calendars.ReadWrite';

const STAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})';
const DEFAULT_ITEMS = 10;
const MAX_MAIL_ITEMS = 25;
const MAX_EVENTS = 50;
const PREVIEW_CHARS = 200;
const REPLY_MAX = 8000;
const DEFAULT_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
const LIST_FIELDS = 'id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments';
const READ_FIELDS = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,webLink';
const EVENT_FIELDS = 'id,subject,start,end,location,organizer,isAllDay,isCancelled,bodyPreview,webLink';

// Graph ids are base64; a '.' never occurs in one, so no id can be a '..' step out of its URL path.
const messageId = { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_=+/-]+$', description: 'The id a search answered in [id: …].' };
const stamp = { type: 'string', maxLength: 40, pattern: `^${STAMP}$`, description: 'An ISO time with its offset, like 2026-11-05T10:00:00+05:30.' };
const limitOf = (max) => ({ type: 'integer', minimum: 1, maximum: max, default: DEFAULT_ITEMS });

const json = (res) => JSON.parse(res.body);
const refuse = (message) => Object.assign(new Error(message), { code: 'bad_input', status: 400, deterministic: true });
const present = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== ''));
const lines = (rows) => rows.filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => `${name}: ${value}`).join('\n');
const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const clipped = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' });
const entity = (all, name) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] || all;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
};

/* A mail body is HTML more often than not, and the model is handed its words only: no markup, no links to follow. */
const textOfHtml = (html) => String(html || '')
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, entity)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const bodyText = (body) => {
    if (!body) return '';
    return String(body.contentType).toLowerCase() === 'html' ? textOfHtml(body.content) : String(body.content || '').replace(/\r\n?/g, '\n').trim();
};

const person = (recipient) => {
    const { name = '', address = '' } = (recipient && recipient.emailAddress) || {};
    if (name && address && name !== address) return `${name} <${address}>`;
    return name || address;
};
const people = (list) => (Array.isArray(list) ? list.map(person).filter(Boolean).join(', ') : '');

const minuteOf = (value) => {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? '' : `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

/* Graph answers an event's times as a wall-clock time and the zone it is in, UTC unless asked otherwise. */
const wallClock = (moment) => String((moment && moment.dateTime) || '').slice(0, 16).replace('T', ' ');
const zoneOf = (moment) => String((moment && moment.timeZone) || 'UTC');
const lastDay = (moment) => {
    const end = new Date(`${String((moment && moment.dateTime) || '').slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(end.getTime()) ? '' : new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10);
};
const spanOf = (event) => {
    if (event.isAllDay) {
        const first = wallClock(event.start).slice(0, 10);
        const last = lastDay(event.end);
        return last && last !== first ? `${first} to ${last}, all day` : `${first}, all day`;
    }
    const start = wallClock(event.start);
    const end = wallClock(event.end);
    const sameDay = start.slice(0, 10) === end.slice(0, 10);
    return `${start} to ${sameDay ? end.slice(11) : end} ${zoneOf(event.start)}`;
};

const messageLine = (message) => {
    const marks = [!message.isRead && 'unread', message.hasAttachments && 'attachments'].filter(Boolean);
    const head = `- ${minuteOf(message.receivedDateTime)}, from ${person(message.from) || 'unknown'}: ${oneLine(message.subject) || '(no subject)'}${marks.length ? ` (${marks.join(', ')})` : ''} [id: ${message.id}]`;
    const preview = clipped(oneLine(message.bodyPreview), PREVIEW_CHARS);
    return preview ? `${head}\n  ${preview}` : head;
};

const eventLine = (event) => {
    const where = oneLine(event.location && event.location.displayName);
    const organizer = person(event.organizer);
    const head = `- ${spanOf(event)}: ${oneLine(event.subject) || '(no title)'}${where ? ` at ${where}` : ''}${organizer ? ` (organizer ${organizer})` : ''}${event.isCancelled ? ' (cancelled)' : ''} [id: ${event.id}]`;
    const preview = clipped(oneLine(event.bodyPreview), PREVIEW_CHARS);
    return preview ? `${head}\n  ${preview}` : head;
};

// KQL wants the whole search in double quotes, so a quote or backslash inside it would end it early.
const searchOf = (query) => oneLine(String(query || '').replace(/["\\]/g, ' '));

const messageUrl = (id) => `${ME}/messages/${encodeURIComponent(id)}`;
const utc = (value) => new Date(value).toISOString().slice(0, 19);

const windowOf = (input) => {
    const start = input.start ? new Date(input.start) : new Date();
    const end = input.end ? new Date(input.end) : new Date(start.getTime() + DEFAULT_DAYS * DAY_MS);
    if (end.getTime() <= start.getTime()) throw refuse('The end of the window must come after its start.');
    return { startDateTime: start.toISOString(), endDateTime: end.toISOString() };
};

const replyTextOf = (value) => {
    const text = String(value || '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw refuse('A reply needs text.');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw refuse('A reply cannot hold control characters.');
    return text;
};

/* Graph reads a reply's comment as HTML. Escaping it keeps the draft to exactly the words on the card: no markup,
 * no remote image or link the model could slip in. */
const asHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');

const eventTimes = (input) => {
    if (new Date(input.end).getTime() <= new Date(input.start).getTime()) throw refuse('An event must end after it starts.');
    return { start: { dateTime: utc(input.start), timeZone: 'UTC' }, end: { dateTime: utc(input.end), timeZone: 'UTC' } };
};

const eventBody = (input) => present({
    subject: input.subject,
    body: input.description ? { contentType: 'text', content: input.description } : undefined,
    location: input.location ? { displayName: input.location } : undefined,
    ...eventTimes(input),
});

module.exports = [{
    key: 'outlook.mail.search',
    label: 'Connectors.tool.outlookMailSearch',
    kind: 'read',
    product: 'mail',
    scope: MAIL,
    input: {
        type: 'object',
        description: 'Searches the person\'s Outlook mail, newest first: the date, sender, subject and a short preview of each message. With no query, the latest messages in the Inbox.',
        properties: {
            query: { type: 'string', maxLength: 200, description: 'Words to look for, or Outlook search terms such as from:ana@example.com or subject:budget.' },
            limit: limitOf(MAX_MAIL_ITEMS),
        },
        additionalProperties: false,
    },
    caps: { maxItems: MAX_MAIL_ITEMS, maxChars: 8000 },
    run: async ({ input, connection, caps }) => {
        const top = Math.min(input.limit || DEFAULT_ITEMS, caps.maxItems);
        const search = searchOf(input.query);
        const { value = [] } = json(search
            ? await connection.request(`${ME}/messages`, { query: { $search: `"${search}"`, $top: top, $select: LIST_FIELDS } })
            : await connection.request(`${ME}/mailFolders/inbox/messages`, { query: { $orderby: 'receivedDateTime desc', $top: top, $select: LIST_FIELDS } }));
        if (!value.length) return search ? 'No messages match that search.' : 'The Inbox is empty.';
        return value.slice(0, top).map(messageLine).join('\n');
    },
}, {
    key: 'outlook.mail.read',
    label: 'Connectors.tool.outlookMailRead',
    kind: 'read',
    product: 'mail',
    scope: MAIL,
    input: {
        type: 'object',
        description: 'One Outlook email in full, as plain text with its formatting removed: who sent it and to whom, when, and its body.',
        properties: { messageId },
        required: ['messageId'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 12000 },
    run: async ({ input, connection }) => {
        const message = json(await connection.request(messageUrl(input.messageId), { query: { $select: READ_FIELDS } }));
        const head = lines([
            ['Subject', oneLine(message.subject) || '(no subject)'],
            ['From', person(message.from)],
            ['To', people(message.toRecipients)],
            ['Cc', people(message.ccRecipients)],
            ['Received', minuteOf(message.receivedDateTime)],
            ['Attachments', message.hasAttachments ? 'yes, not read here' : ''],
            ['Link', message.webLink],
            ['Id', message.id],
        ]);
        const body = bodyText(message.body);
        return body ? `${head}\n\n${body}` : head;
    },
}, {
    key: 'outlook.calendar.events.list',
    label: 'Connectors.tool.outlookCalendarEventsList',
    kind: 'read',
    product: 'calendar',
    scope: CALENDAR,
    input: {
        type: 'object',
        description: `The events on the person's Outlook calendar in a time window, oldest first, with times in UTC. Without start and end, from now to ${DEFAULT_DAYS} days ahead.`,
        properties: { start: stamp, end: stamp, limit: limitOf(MAX_EVENTS) },
        additionalProperties: false,
    },
    caps: { maxItems: MAX_EVENTS, maxChars: 8000 },
    run: async ({ input, connection, caps }) => {
        const top = Math.min(input.limit || DEFAULT_ITEMS, caps.maxItems);
        const { value = [] } = json(await connection.request(`${ME}/calendarView`, {
            query: { ...windowOf(input), $orderby: 'start/dateTime', $top: top, $select: EVENT_FIELDS },
        }));
        if (!value.length) return 'No events in that window.';
        return value.slice(0, top).map(eventLine).join('\n');
    },
}, {
    key: 'outlook.mail.reply.draft',
    label: 'Connectors.tool.outlookMailReplyDraft',
    kind: 'write',
    product: 'mail',
    scope: MAIL,
    input: {
        type: 'object',
        description: 'Saves a plain-text reply to one Outlook email as a draft in the person\'s Drafts folder. It never sends: the person reads the draft in Outlook and sends it from there.',
        properties: {
            messageId,
            text: { type: 'string', maxLength: REPLY_MAX, description: 'The reply, as plain text. Outlook adds the earlier message below it.' },
            replyAll: { type: 'boolean', default: false, description: 'Whether the draft replies to everyone on the message rather than its sender only.' },
        },
        required: ['messageId', 'text'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 500 },
    card: (input) => ({
        target: '',
        targetLabel: 'Connectors.card.outlookDrafts',
        headline: input.messageId,
        text: replyTextOf(input.text),
        rows: [
            { label: 'Connectors.card.replyToMessage', value: input.messageId },
            { label: 'Connectors.card.replyAll', valueLabel: input.replyAll ? 'Connectors.card.yes' : 'Connectors.card.no' },
        ],
    }),
    editable: [
        { param: 'text', label: 'Connectors.card.text', long: true },
        { param: 'replyAll', label: 'Connectors.card.replyAll', toggle: true },
    ],
    run: async ({ input, connection }) => {
        const comment = asHtml(replyTextOf(input.text));
        const draft = json(await connection.request(`${messageUrl(input.messageId)}/${input.replyAll ? 'createReplyAll' : 'createReply'}`, { method: 'post', json: { comment } }));
        const to = people(draft.toRecipients);
        return `Saved a draft reply${to ? ` to ${to}` : ''} in your Outlook Drafts; nothing was sent. ${draft.webLink || ''}`.trim();
    },
}, {
    key: 'outlook.calendar.events.create',
    label: 'Connectors.tool.outlookCalendarEventsCreate',
    kind: 'write',
    product: 'calendar',
    scope: CALENDAR,
    input: {
        type: 'object',
        description: 'Adds an event to the person\'s default Outlook calendar. Nobody is invited, so Outlook sends no invitation; the person can invite people from Outlook afterwards.',
        properties: {
            subject: { type: 'string', maxLength: 255 },
            start: stamp,
            end: stamp,
            location: { type: 'string', maxLength: 255 },
            description: { type: 'string', maxLength: 8000 },
        },
        required: ['subject', 'start', 'end'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 500 },
    card: (input) => {
        eventTimes(input);
        return {
            target: '',
            targetLabel: 'Connectors.card.outlookCalendar',
            title: input.subject,
            text: input.description,
            rows: [
                { label: 'Connectors.card.start', value: input.start },
                { label: 'Connectors.card.end', value: input.end },
                { label: 'Connectors.card.where', value: input.location },
                { label: 'Connectors.card.attendees', valueLabel: 'Connectors.card.nobody' },
            ].filter((row) => row.value || row.valueLabel),
        };
    },
    editable: [
        { param: 'subject', label: 'Connectors.card.title' },
        { param: 'start', label: 'Connectors.card.start', hint: 'Connectors.card.timeHintWithOffset' },
        { param: 'end', label: 'Connectors.card.end', hint: 'Connectors.card.timeHintWithOffset' },
        { param: 'location', label: 'Connectors.card.where' },
        { param: 'description', label: 'Connectors.card.description', long: true },
    ],
    run: async ({ input, connection }) => {
        const event = json(await connection.request(`${ME}/events`, { method: 'post', json: eventBody(input) }));
        return `Created event ${event.id} on your Outlook calendar: ${event.webLink || ''}`.trim();
    },
}];
