// AUTO-02 — pure iCalendar (RFC 5545) builder + feed tokens. No DB/IO; DTSTAMP is
// passed in so output is deterministic and testable. The outbound .ics feed is the
// credential-free core of calendar sync (subscribe in Google/Outlook/Apple); 2-way
// OAuth is the documented, config-gated extension. Unit-tested in tests/ical-rules.test.js.

const crypto = require('crypto');

const generateFeedToken = () => crypto.randomBytes(18).toString('hex'); // 36 hex
const isFeedToken = (t) => /^[a-f0-9]{24,}$/.test(String(t || ''));

const pad = (n) => String(n).padStart(2, '0');

// All-day stamp YYYYMMDD (UTC) for DTSTART;VALUE=DATE.
const fmtDate = (d) => {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
};
// Full UTC timestamp YYYYMMDDTHHMMSSZ (DTSTAMP).
const fmtStamp = (d) => {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;
};
const escapeText = (s) => String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const hashCode = (s) => { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return h; };

const buildEvent = (ev, stamp) => {
    const date = fmtDate(ev.date);
    if (!date) return '';
    const uid = escapeText(ev.uid || `${date}-${Math.abs(hashCode(ev.summary || ''))}`);
    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid}@alianhub`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${date}`,
        `SUMMARY:${escapeText(ev.summary || '(task)')}`,
    ];
    if (ev.url) lines.push(`URL:${escapeText(ev.url)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    lines.push('END:VEVENT');
    return lines.join('\r\n');
};

const buildIcs = ({ calName = 'AlianHub', events = [], stamp } = {}) => {
    const ds = stamp || '19700101T000000Z';
    const body = (events || []).map((e) => buildEvent(e, ds)).filter(Boolean).join('\r\n');
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//AlianHub//Tasks//EN',
        'CALSCALE:GREGORIAN',
        `X-WR-CALNAME:${escapeText(calName)}`,
        body,
        'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
};

module.exports = { generateFeedToken, isFeedToken, fmtDate, fmtStamp, escapeText, buildIcs };
