const TOKEN = 'google-test-token';

const answer = (status, body = {}, headers = {}) => ({ status, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const googleError = (status, reason, message) => answer(status, { error: { code: status, message, errors: [{ domain: 'global', reason, message }] } });

/* Stands in for Google behind safeFetch, so a tool's real URL, query and body are what is checked. Drive holds only
 * the files the person picked, because that is all drive.file ever shows. */
const create = () => {
    const state = {
        events: [
            { id: 'ev1', summary: 'Board meeting', location: 'Room 4', description: 'Budget', start: { dateTime: '2026-11-02T10:00:00+05:30' }, end: { dateTime: '2026-11-02T11:00:00+05:30' }, organizer: { email: 'prisha@example.com' }, attendees: [{ email: 'sam@example.com', responseStatus: 'accepted' }], htmlLink: 'https://calendar.google.com/event?eid=ev1' },
            { id: 'ev2', summary: 'Call the bank', start: { dateTime: '2026-11-03T10:00:00+05:30' }, end: { dateTime: '2026-11-03T10:30:00+05:30' }, htmlLink: 'https://calendar.google.com/event?eid=ev2' },
        ],
        spaces: [{ name: 'spaces/sp1', meetingUri: 'https://meet.google.com/abc-mnop-xyz', meetingCode: 'abc-mnop-xyz', config: { accessType: 'TRUSTED' } }],
        files: [
            { id: 'doc1', name: 'Q4 plan', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-01T09:00:00Z', webViewLink: 'https://docs.google.com/document/d/doc1', exported: { 'text/plain': 'The Q4 plan text' } },
            { id: 'sheet1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-10-02T09:00:00Z', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet1', exported: { 'text/csv': 'item,cost\nchairs,10' } },
            { id: 'txt1', name: 'notes.txt', mimeType: 'text/plain', size: '12', modifiedTime: '2026-10-03T09:00:00Z', content: 'Plain notes' },
            { id: 'img1', name: 'photo.png', mimeType: 'image/png', size: '900', modifiedTime: '2026-10-04T09:00:00Z' },
            { id: 'word1', name: 'contract.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: '900', modifiedTime: '2026-10-05T09:00:00Z', content: 'PK\u0003\u0004 binary' },
            { id: 'page1', name: 'page.html', mimeType: 'text/html', size: '40', modifiedTime: '2026-10-06T09:00:00Z', content: '<script>x</script>' },
        ],
        calls: [],
        next: null,
    };

    const listEvents = (query) => {
        const at = (event) => new Date(event.start.dateTime || event.start.date).getTime();
        const min = query.get('timeMin');
        const max = query.get('timeMax');
        const words = query.get('q');
        const items = state.events
            .filter((event) => (!min || at(event) >= new Date(min).getTime()) && (!max || at(event) < new Date(max).getTime()) && (!words || event.summary.includes(words)))
            .slice(0, Number(query.get('maxResults')) || undefined);
        return answer(200, { items });
    };

    const createEvent = (body) => {
        const event = { ...body, id: `ev${state.events.length + 1}`, htmlLink: `https://calendar.google.com/event?eid=ev${state.events.length + 1}` };
        state.events.push(event);
        return answer(200, event);
    };

    const event = (id, method, body) => {
        const found = state.events.find((row) => row.id === id);
        if (!found) return answer(404, { error: { code: 404, message: 'Not Found' } });
        if (method === 'patch') Object.assign(found, body);
        return answer(200, found);
    };

    const space = (id) => {
        const found = state.spaces.find((row) => row.name === `spaces/${id}` || row.meetingCode === id);
        return found ? answer(200, found) : answer(404, { error: { code: 404, message: 'Not Found' } });
    };

    const createSpace = (body) => {
        const made = { name: `spaces/sp${state.spaces.length + 1}`, meetingUri: 'https://meet.google.com/new-meet-ing', meetingCode: 'new-meet-ing', config: { accessType: 'TRUSTED', ...(body.config || {}) } };
        state.spaces.push(made);
        return answer(200, made);
    };

    const listFiles = (query) => {
        const named = /name contains '((?:[^'\\]|\\.)*)'/.exec(query.get('q') || '');
        const name = (named ? named[1].replace(/\\(.)/g, '$1') : '').toLowerCase();
        // Google's name contains matches the start of a word, never its middle.
        const files = state.files.filter((file) => file.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(name))).slice(0, Number(query.get('pageSize')) || undefined);
        return answer(200, { files });
    };

    const file = (id, rest, query) => {
        const found = state.files.find((row) => row.id === id);
        if (!found) return answer(404, { error: { code: 404, message: 'File not found' } });
        if (rest === '/export') {
            const text = (found.exported || {})[query.get('mimeType')];
            return text === undefined ? answer(400, { error: { code: 400, message: 'Export not supported' } }) : answer(200, text);
        }
        if (query.get('alt') === 'media') return answer(200, found.content);
        return answer(200, Object.fromEntries(Object.entries(found).filter(([name]) => !['exported', 'content'].includes(name))));
    };

    const route = (url, method, body) => {
        const path = decodeURIComponent(url.pathname);
        const eventMatch = /^\/calendar\/v3\/calendars\/[^/]+\/events(?:\/([^/]+))?$/.exec(path);
        const fileMatch = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(path);
        const spaceMatch = /^\/v2\/spaces\/([^/]+)$/.exec(path);
        if (url.hostname === 'www.googleapis.com' && eventMatch) {
            if (eventMatch[1]) return event(eventMatch[1], method, body);
            return method === 'post' ? createEvent(body) : listEvents(url.searchParams);
        }
        if (url.hostname === 'www.googleapis.com' && path === '/drive/v3/files') return listFiles(url.searchParams);
        if (url.hostname === 'www.googleapis.com' && fileMatch) return file(fileMatch[1], fileMatch[2], url.searchParams);
        if (url.hostname === 'meet.googleapis.com' && path === '/v2/spaces' && method === 'post') return createSpace(body);
        if (url.hostname === 'meet.googleapis.com' && spaceMatch) return space(spaceMatch[1]);
        return answer(404, { error: { code: 404, message: 'No such route' } });
    };

    const fetch = async (target, options = {}) => {
        const url = new URL(target);
        const method = String(options.method || 'get').toLowerCase();
        const body = options.data ? JSON.parse(options.data) : undefined;
        state.calls.push({ url, method, body });
        if ((options.headers || {}).Authorization !== `Bearer ${TOKEN}`) return answer(401, { error: { code: 401, message: 'Invalid Credentials' } });
        if (state.next) { const planned = state.next; state.next = null; return planned; }
        return route(url, method, body);
    };

    return { state, fetch, TOKEN };
};

module.exports = { create, answer, googleError, TOKEN };
