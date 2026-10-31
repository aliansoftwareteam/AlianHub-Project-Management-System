const SCOPE = 'https://www.googleapis.com/auth/';
const CALENDARS = 'https://www.googleapis.com/calendar/v3/calendars';
const MEET_SPACES = 'https://meet.googleapis.com/v2/spaces';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

const STAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})';
const DAY_LENGTH = 10;
const DEFAULT_ITEMS = 10;
const EDITABLE = Object.freeze(['summary', 'description', 'location', 'start', 'end', 'attendees']);
const GOOGLE_DOCS = 'application/vnd.google-apps.';
const EXPORT_AS = Object.freeze({ [`${GOOGLE_DOCS}document`]: 'text/plain', [`${GOOGLE_DOCS}spreadsheet`]: 'text/csv', [`${GOOGLE_DOCS}presentation`]: 'text/plain' });
const TEXT_TYPE = /^text\/|json|xml|csv/;
const ACCESS_ROW = Object.freeze({ OPEN: 'Connectors.card.accessOpen', TRUSTED: 'Connectors.card.accessTrusted', RESTRICTED: 'Connectors.card.accessRestricted' });

const limit = { type: 'integer', minimum: 1, maximum: 50, default: DEFAULT_ITEMS };
const calendarId = { type: 'string', maxLength: 200, description: 'Leave out for the person\'s primary calendar.' };
const eventId = { type: 'string', minLength: 1, maxLength: 200 };
const fileId = { type: 'string', minLength: 1, maxLength: 200 };
const when = { type: 'string', maxLength: 40, pattern: `^(\\d{4}-\\d{2}-\\d{2}|${STAMP})$`, description: 'YYYY-MM-DD for an all-day event (its end is the day after it finishes), or an ISO time with its offset.' };
const stamp = { type: 'string', maxLength: 40, pattern: `^${STAMP}$`, description: 'An ISO time with its offset.' };
const eventFields = {
    summary: { type: 'string', maxLength: 250 },
    description: { type: 'string', maxLength: 8000 },
    location: { type: 'string', maxLength: 250 },
    start: when,
    end: when,
    attendees: { type: 'string', maxLength: 2000, description: 'Email addresses, separated by commas.' },
    notifyAttendees: { type: 'boolean', default: false, description: 'Whether Google emails the attendees.' },
};

const json = (res) => JSON.parse(res.body);
const present = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
const lines = (rows) => rows.filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => `${name}: ${value}`).join('\n');

const eventsUrl = (input) => `${CALENDARS}/${encodeURIComponent(input.calendarId || 'primary')}/events`;
const eventUrl = (input) => `${eventsUrl(input)}/${encodeURIComponent(input.eventId)}`;
const momentOf = (moment) => (moment ? moment.dateTime || moment.date : '');
const span = (event) => `${momentOf(event.start)} to ${momentOf(event.end)}`;
const moment = (value) => (value.length === DAY_LENGTH ? { date: value } : { dateTime: value });
const emails = (list) => String(list).split(',').map((email) => email.trim()).filter(Boolean);

const eventBody = (input) => present({
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: input.start && moment(input.start),
    end: input.end && moment(input.end),
    attendees: input.attendees === undefined ? undefined : emails(input.attendees).map((email) => ({ email })),
});

const eventDetail = (event) => lines([
    ['Title', event.summary || '(no title)'],
    ['When', span(event)],
    ['Where', event.location],
    ['Organizer', event.organizer && event.organizer.email],
    ['Attendees', (event.attendees || []).map((person) => `${person.email} (${person.responseStatus})`).join(', ')],
    ['Meet link', event.hangoutLink],
    ['Link', event.htmlLink],
    ['Id', event.id],
    ['Description', event.description],
]);

const eventCard = (input, attendeesLabel) => ({
    target: input.calendarId || '',
    targetLabel: input.calendarId ? undefined : 'Connectors.card.primaryCalendar',
    text: input.description,
    rows: [
        { label: 'Connectors.card.eventId', value: input.eventId },
        { label: 'Connectors.card.start', value: input.start },
        { label: 'Connectors.card.end', value: input.end },
        { label: 'Connectors.card.where', value: input.location },
        input.attendees === undefined ? null : { label: attendeesLabel, ...(emails(input.attendees).length ? { value: emails(input.attendees).join(', ') } : { valueLabel: 'Connectors.card.nobody' }) },
        { label: 'Connectors.card.notifyAttendees', valueLabel: input.notifyAttendees ? 'Connectors.card.yes' : 'Connectors.card.no' },
    ].filter((row) => row && (row.value || row.valueLabel)),
});

const notifyOf = (input) => ({ sendUpdates: input.notifyAttendees ? 'all' : 'none' });

const spaceId = (space) => encodeURIComponent(String(space).replace(/^spaces\//, ''));

const fileLine = (file) => `- ${file.name} (${file.mimeType}) [id: ${file.id}]`;
const quoted = (text) => String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const readFile = async ({ input, connection }) => {
    const url = `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}`;
    const file = json(await connection.request(url, { query: { fields: 'name,mimeType', supportsAllDrives: true } }));
    if (EXPORT_AS[file.mimeType]) return (await connection.request(`${url}/export`, { query: { mimeType: EXPORT_AS[file.mimeType] } })).body;
    if (TEXT_TYPE.test(file.mimeType)) return (await connection.request(url, { query: { alt: 'media', supportsAllDrives: true } })).body;
    return `${file.name} is ${file.mimeType}, which cannot be read as text.`;
};

module.exports = [{
    key: 'google.calendar.events.list',
    label: 'Connectors.tool.googleCalendarEventsList',
    kind: 'read',
    product: 'calendar',
    scope: `${SCOPE}calendar.events.readonly`,
    input: {
        type: 'object',
        description: 'The events on the person\'s Google Calendar in a time window, from now on unless timeMin says otherwise.',
        properties: { calendarId, timeMin: stamp, timeMax: stamp, search: { type: 'string', maxLength: 200 }, limit },
        additionalProperties: false,
    },
    caps: { maxItems: 50, maxChars: 8000 },
    run: async ({ input, connection, caps }) => {
        const { items = [] } = json(await connection.request(eventsUrl(input), {
            query: present({
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: Math.min(input.limit || DEFAULT_ITEMS, caps.maxItems),
                timeMin: input.timeMin || new Date().toISOString(),
                timeMax: input.timeMax,
                q: input.search,
            }),
        }));
        if (!items.length) return 'No events in that window.';
        return items.map((event) => `- ${span(event)}: ${event.summary || '(no title)'}${event.location ? ` at ${event.location}` : ''} [id: ${event.id}]`).join('\n');
    },
}, {
    key: 'google.calendar.events.get',
    label: 'Connectors.tool.googleCalendarEventsGet',
    kind: 'read',
    product: 'calendar',
    scope: `${SCOPE}calendar.events.readonly`,
    input: {
        type: 'object',
        description: 'One event on the person\'s Google Calendar: its time, place, attendees and description.',
        properties: { calendarId, eventId },
        required: ['eventId'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 8000 },
    run: async ({ input, connection }) => eventDetail(json(await connection.request(eventUrl(input)))),
}, {
    key: 'google.calendar.events.create',
    label: 'Connectors.tool.googleCalendarEventsCreate',
    kind: 'write',
    product: 'calendar',
    scope: `${SCOPE}calendar.events.owned`,
    input: {
        type: 'object',
        description: 'Adds an event to a Google Calendar the person owns.',
        properties: { calendarId, ...eventFields },
        required: ['summary', 'start', 'end'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 500 },
    card: (input) => ({ ...eventCard(input, 'Connectors.card.attendees'), title: input.summary }),
    run: async ({ input, connection }) => {
        const event = json(await connection.request(eventsUrl(input), { method: 'post', query: notifyOf(input), json: eventBody(input) }));
        return `Created event ${event.id}: ${event.htmlLink}`;
    },
}, {
    key: 'google.calendar.events.update',
    label: 'Connectors.tool.googleCalendarEventsUpdate',
    kind: 'write',
    product: 'calendar',
    scope: `${SCOPE}calendar.events.owned`,
    input: {
        type: 'object',
        description: 'Changes the named fields of an event on a Google Calendar the person owns; attendees replaces the whole list.',
        properties: { calendarId, eventId, ...eventFields },
        required: ['eventId'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 500 },
    card: (input) => {
        if (!EDITABLE.some((field) => input[field] !== undefined)) {
            throw Object.assign(new Error('This update names nothing to change, so it was not filed.'), { code: 'bad_input', status: 400, deterministic: true });
        }
        return { ...eventCard(input, 'Connectors.card.attendeesReplaced'), title: input.summary === undefined ? input.eventId : input.summary };
    },
    run: async ({ input, connection }) => {
        const event = json(await connection.request(eventUrl(input), { method: 'patch', query: notifyOf(input), json: eventBody(input) }));
        return `Updated event ${event.id}: ${event.htmlLink}`;
    },
}, {
    key: 'google.meet.spaces.get',
    label: 'Connectors.tool.googleMeetSpacesGet',
    kind: 'read',
    product: 'meet',
    scope: `${SCOPE}meetings.space.readonly`,
    input: {
        type: 'object',
        description: 'One Google Meet meeting space: its link, who can join and whether a call is live in it.',
        properties: { space: { type: 'string', maxLength: 140, pattern: '^(spaces/)?[A-Za-z0-9_-]+$', description: 'The space name or the meeting code.' } },
        required: ['space'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 2000 },
    run: async ({ input, connection }) => {
        const space = json(await connection.request(`${MEET_SPACES}/${spaceId(input.space)}`));
        return lines([
            ['Space', space.name],
            ['Link', space.meetingUri],
            ['Code', space.meetingCode],
            ['Access', space.config && space.config.accessType],
            ['Call live now', space.activeConference ? 'yes' : 'no'],
        ]);
    },
}, {
    key: 'google.meet.spaces.create',
    label: 'Connectors.tool.googleMeetSpacesCreate',
    kind: 'write',
    product: 'meet',
    scope: `${SCOPE}meetings.space.created`,
    input: {
        type: 'object',
        description: 'Creates a new Google Meet meeting space with its own link.',
        properties: { accessType: { type: 'string', maxLength: 10, enum: Object.keys(ACCESS_ROW), description: 'Who joins without knocking: OPEN anyone with the link, TRUSTED the organisation and people invited, RESTRICTED only people invited. Leave out for the default of the person\'s organisation.' } },
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 500 },
    card: (input) => ({ target: 'Google Meet', rows: [{ label: 'Connectors.card.access', valueLabel: ACCESS_ROW[input.accessType] || 'Connectors.card.accessDefault' }] }),
    run: async ({ input, connection }) => {
        const space = json(await connection.request(MEET_SPACES, { method: 'post', json: input.accessType ? { config: { accessType: input.accessType } } : {} }));
        return `Created meeting ${space.meetingCode}: ${space.meetingUri}`;
    },
}, {
    key: 'google.drive.files.list',
    label: 'Connectors.tool.googleDriveFilesList',
    kind: 'read',
    product: 'drive',
    scope: `${SCOPE}drive.file`,
    input: {
        type: 'object',
        description: 'The Google Drive files the person picked for AlianHub; no other file of theirs can be seen.',
        properties: { name: { type: 'string', maxLength: 200, description: 'Only files whose name contains this.' }, limit },
        additionalProperties: false,
    },
    caps: { maxItems: 50, maxChars: 8000 },
    run: async ({ input, connection, caps }) => {
        const { files = [] } = json(await connection.request(DRIVE_FILES, {
            query: {
                q: `trashed = false${input.name ? ` and name contains '${quoted(input.name)}'` : ''}`,
                pageSize: Math.min(input.limit || DEFAULT_ITEMS, caps.maxItems),
                orderBy: 'modifiedTime desc',
                fields: 'files(id,name,mimeType)',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
            },
        }));
        return files.length ? files.map(fileLine).join('\n') : 'No picked files found.';
    },
}, {
    key: 'google.drive.files.get',
    label: 'Connectors.tool.googleDriveFilesGet',
    kind: 'read',
    product: 'drive',
    scope: `${SCOPE}drive.file`,
    input: {
        type: 'object',
        description: 'The details of one Google Drive file the person picked: its name, type, date and link.',
        properties: { fileId },
        required: ['fileId'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 2000 },
    run: async ({ input, connection }) => {
        const file = json(await connection.request(`${DRIVE_FILES}/${encodeURIComponent(input.fileId)}`, { query: { fields: 'id,name,mimeType,modifiedTime,size,webViewLink', supportsAllDrives: true } }));
        return lines([['Name', file.name], ['Type', file.mimeType], ['Changed', file.modifiedTime], ['Bytes', file.size], ['Link', file.webViewLink], ['Id', file.id]]);
    },
}, {
    key: 'google.drive.files.read',
    label: 'Connectors.tool.googleDriveFilesRead',
    kind: 'read',
    product: 'drive',
    scope: `${SCOPE}drive.file`,
    input: {
        type: 'object',
        description: 'The text of one Google Drive file the person picked: a Google Doc, Slides file or text file, or the first tab only of a Google Sheet.',
        properties: { fileId },
        required: ['fileId'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 20000 },
    run: readFile,
}];
