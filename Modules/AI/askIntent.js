const { DateTime, IANAZone } = require('luxon');
const { escapeRegex } = require('../../utils/escapeRegex');
const { DONE_TYPES } = require('../Portfolio/helpers/portfolioRules');

// Phrases per language. readIntent reads every language at once, so adding one is adding a key here.
const RULES = {
    en: {
        notSelf: ['show me', 'tell me', 'give me', 'let me', 'help me', 'remind me', 'get me', 'find me', 'send me'],
        self: ['my', 'mine', 'me', 'myself', 'i have', 'i own', 'i am', "i'm", 'am i', 'should i'],
        unassigned: ['unassigned', 'not assigned to anyone', 'not assigned', 'no assignee', 'without an assignee', 'without assignee'],
        status: {
            open: ['open', 'not done', 'not closed', 'not completed', 'not finished', 'unfinished', 'incomplete', 'outstanding',
                'remaining', 'pending', 'left', 'left to do', 'still to do', 'to be done', 'working on'],
            done: ['done', 'completed', 'finished', 'closed', 'resolved'],
            active: ['in progress', 'in-progress', 'ongoing', 'underway'],
        },
        due: {
            overdue: ['overdue', 'past due', 'past their due date', 'past its due date', 'late', 'behind schedule', 'missed deadline', 'missed deadlines'],
            today: ['due today', 'due by today', 'due by end of today'],
            tomorrow: ['due tomorrow', 'due by tomorrow'],
            this_week: ['due this week', 'due by the end of the week', 'due by end of week', 'due by the end of this week'],
            next_week: ['due next week'],
            soon: ['due soon', 'coming due', 'due in the next few days', 'due in the next 7 days', 'upcoming deadlines'],
            none: ['no due date', 'no due dates', 'without a due date', 'without due dates', 'undated'],
            urgent: ['urgent', 'urgent work', 'urgent tasks', 'overdue or due soon', 'overdue, due soon or high priority', 'overdue, due soon, or high priority'],
        },
        sprint: {
            word: ['sprint', 'sprints'],
            current: ['current sprint', 'this sprint', 'active sprint', 'ongoing sprint', 'running sprint', 'current sprints', 'active sprints'],
        },
        listing: ['task', 'tasks', 'issue', 'issues', 'bug', 'bugs', 'ticket', 'tickets', 'item', 'items', 'todo', 'todos', 'to-do', 'to-dos', 'work', 'assignments', 'backlog'],
    },
};

const SHORT_CODE = 3;
const WORD = '[\\p{L}\\p{N}]';
const TASK_KEY = /(?<![\p{L}\p{N}-])[A-Z][A-Z0-9]{1,9}-\d+(?![\p{L}\p{N}])/gu;

const phrasesOf = (pick) => [...new Set(Object.values(RULES).flatMap((lang) => pick(lang) || []))];
const groupsOf = (pick) => {
    const out = {};
    Object.values(RULES).forEach((lang) => Object.entries(pick(lang) || {}).forEach(([group, list]) => { out[group] = [...(out[group] || []), ...list]; }));
    return out;
};
const byLength = (a, b) => b.phrase.length - a.phrase.length;
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/* Matched spans are blanked in both copies so a phrase is read once: "not done" never also counts as "done". */
const textOf = (question) => {
    const orig = norm(question);
    const lower = orig.toLowerCase();
    return lower.length === orig.length ? { orig, lower } : { orig: lower, lower };
};

const take = (text, phrase, { exact = false, notFollowedBy = '' } = {}) => {
    if (!phrase) return -1;
    const source = exact ? text.orig : text.lower;
    const rx = new RegExp(`(?<!${WORD})${escapeRegex(exact ? phrase : phrase.toLowerCase())}(?!${WORD})${notFollowedBy}`, 'u');
    const hit = rx.exec(source);
    if (!hit) return -1;
    const blank = ' '.repeat(hit[0].length);
    const cut = (s) => s.slice(0, hit.index) + blank + s.slice(hit.index + hit[0].length);
    text.orig = cut(text.orig);
    text.lower = cut(text.lower);
    return hit.index;
};

const first = (text, candidates, opts) => {
    for (const candidate of candidates) {
        const at = take(text, candidate.phrase, opts);
        if (at !== -1) return { ...candidate, at };
    }
    return null;
};

const taskKeysOf = (text, projects) => {
    const found = new Set();
    (text.orig.match(TASK_KEY) || []).forEach((key) => found.add(key));
    projects.filter((p) => p.code).forEach((p) => {
        const rx = new RegExp(`(?<!${WORD})${escapeRegex(p.code)}-\\d+(?!${WORD})`, 'giu');
        (text.orig.match(rx) || []).forEach((key) => found.add(key.toUpperCase()));
    });
    found.forEach((key) => { while (take(text, key.toLowerCase()) !== -1); });
    return [...found];
};

const projectsOf = (text, projects) => {
    const hits = new Map();
    const names = projects.filter((p) => norm(p.name)).map((p) => ({ phrase: norm(p.name), project: p })).sort(byLength);
    names.forEach(({ phrase, project }) => { while (take(text, phrase) !== -1) hits.set(project.id, project); });
    projects.filter((p) => p.code).forEach((p) => {
        const exact = p.code.length <= SHORT_CODE;
        while (take(text, p.code, { exact, notFollowedBy: '(?!-\\d)' }) !== -1) hits.set(p.id, p);
    });
    return [...hits.values()];
};

const mentionsSprint = (question) => phrasesOf((l) => l.sprint.word)
    .some((word) => new RegExp(`(?<!${WORD})${escapeRegex(word)}(?!${WORD})`, 'iu').test(String(question || '')));

const sprintOf = (text, sprints) => {
    if (!mentionsSprint(text.lower)) return null;
    if (first(text, phrasesOf((l) => l.sprint.current).map((phrase) => ({ phrase })).sort(byLength))) {
        return { current: true, ids: sprints.filter((s) => s.active).map((s) => s.id) };
    }
    const named = first(text, sprints.filter((s) => norm(s.name).length > 1).map((s) => ({ phrase: norm(s.name), sprint: s })).sort(byLength));
    if (!named) return null;
    const lower = named.phrase.toLowerCase();
    return { name: named.sprint.name, ids: sprints.filter((s) => norm(s.name).toLowerCase() === lower).map((s) => s.id) };
};

const dueOf = (text) => {
    const windows = groupsOf((l) => l.due);
    const hit = first(text, Object.entries(windows).flatMap(([window, list]) => list.map((phrase) => ({ phrase, window }))).sort(byLength));
    return hit ? hit.window : null;
};

/* A company's own status names are read before the generic words, a done-type name reads as the
 * done group, and a name that is itself a generic word ("Open") keeps its generic meaning. */
const statusOf = (text, projects) => {
    const groups = groupsOf((l) => l.status);
    const generic = new Set(groups.open);
    const named = new Map();
    projects.forEach((p) => (p.statuses || []).forEach((s) => {
        const phrase = norm(s.name).toLowerCase();
        if (!phrase || generic.has(phrase)) return;
        const entry = named.get(phrase) || { phrase, name: norm(s.name), done: false, keys: [] };
        entry.done = entry.done || DONE_TYPES.includes(String(s.type || '').toLowerCase());
        entry.keys.push({ projectId: p.id, key: s.key });
        named.set(phrase, entry);
    }));
    const candidates = [
        ...[...named.values()].map((entry) => ({ ...entry, kind: 'named' })),
        ...Object.entries(groups).flatMap(([group, list]) => list.map((phrase) => ({ phrase, group, kind: 'group' }))),
    ].sort((a, b) => byLength(a, b) || (a.kind === 'named' ? -1 : 0) - (b.kind === 'named' ? -1 : 0));
    const hit = first(text, candidates);
    if (!hit) return null;
    if (hit.kind === 'group') return { type: hit.group };
    return hit.done ? { type: 'done' } : { name: hit.name, keys: hit.keys };
};

const memberOf = (text, members) => {
    const full = members.flatMap((m) => [norm(m.name), norm(`${m.first || ''} ${m.last || ''}`)]
        .filter((phrase) => phrase.includes(' '))
        .map((phrase) => ({ phrase, member: m }))).sort(byLength);
    const byFull = first(text, full);
    if (byFull) return byFull.member;
    const counts = {};
    members.forEach((m) => { const f = norm(m.first).toLowerCase(); if (f) counts[f] = (counts[f] || 0) + 1; });
    for (const m of members) {
        const name = norm(m.first);
        if (name.length < 3 || counts[name.toLowerCase()] !== 1 || name[0] !== name[0].toUpperCase()) continue;
        const rx = new RegExp(`(?<!${WORD})${escapeRegex(name)}(?!${WORD})`, 'u');
        const hit = rx.exec(text.orig);
        if (hit && /\S/.test(text.orig.slice(0, hit.index))) {
            take(text, name, { exact: true });
            return m;
        }
    }
    return null;
};

const assigneeOf = (text, { members, selfId }) => {
    const member = memberOf(text, members);
    if (member) return { id: member.id, name: norm(member.name) || norm(`${member.first || ''} ${member.last || ''}`) };
    if (first(text, phrasesOf((l) => l.unassigned).map((phrase) => ({ phrase })).sort(byLength))) return { none: true };
    if (selfId && first(text, phrasesOf((l) => l.self).map((phrase) => ({ phrase })).sort(byLength))) return { self: true, id: String(selfId) };
    return null;
};

/* What the question asks of the task list, read without a model. Everything named is matched
 * against the context given, which holds only what the asker may see: a project, sprint or person
 * outside it reads exactly as a name that does not exist. */
const readIntent = (question, { selfId = '', projects = [], members = [], sprints = [] } = {}) => {
    const text = textOf(question);
    const taskKeys = taskKeysOf(text, projects);
    phrasesOf((l) => l.notSelf).forEach((phrase) => { while (take(text, phrase) !== -1); });
    const named = projectsOf(text, projects);
    const sprint = sprintOf(text, sprints);
    const due = dueOf(text);
    const status = statusOf(text, projects);
    const assignee = assigneeOf(text, { members, selfId });
    const listing = Boolean(first(text, phrasesOf((l) => l.listing).map((phrase) => ({ phrase })).sort(byLength)));
    const narrowed = named.length > 0 || Boolean(assignee);
    // "open" and "done" are also verbs, so on their own they do not ask for a list; a status name or "in progress" does.
    const unambiguous = Boolean(status && (status.keys || status.type === 'active'));
    const filtered = !taskKeys.length && Boolean(due || sprint || unambiguous || (status && (listing || narrowed)) || (listing && narrowed));
    return {
        taskKeys,
        projectIds: named.map((p) => p.id),
        projects: named.map((p) => ({ id: p.id, name: p.name })),
        status,
        assignee,
        due,
        sprint,
        listing,
        filtered,
        needsContext: !taskKeys.length && Boolean(due || sprint || status || listing || mentionsSprint(question)),
    };
};

const zoneFor = (...zones) => zones.find((zone) => zone && IANAZone.isValidZone(zone)) || 'UTC';

const dueWindow = (window, { now = new Date(), timeZone = 'UTC' } = {}) => {
    const today = DateTime.fromJSDate(now, { zone: zoneFor(timeZone) }).startOf('day');
    const at = (dt) => dt.toJSDate();
    const week = today.startOf('week');
    switch (window) {
        case 'overdue': return { before: at(today) };
        case 'today': return { from: at(today), before: at(today.plus({ days: 1 })) };
        case 'tomorrow': return { from: at(today.plus({ days: 1 })), before: at(today.plus({ days: 2 })) };
        case 'this_week': return { from: at(week), before: at(week.plus({ weeks: 1 })) };
        case 'next_week': return { from: at(week.plus({ weeks: 1 })), before: at(week.plus({ weeks: 2 })) };
        case 'soon': return { from: at(today), before: at(today.plus({ days: 8 })) };
        case 'none': return { none: true };
        case 'urgent': return { before: at(today.plus({ days: 8 })), urgent: true };
        default: return null;
    }
};

const localDate = (value, timeZone) => (value ? DateTime.fromJSDate(new Date(value), { zone: zoneFor(timeZone) }).toISODate() : '');

module.exports = { RULES, DONE_TYPES, readIntent, mentionsSprint, dueWindow, zoneFor, localDate };
