// What a task is, and what it carries — the one copy, read by the server
// (taskSplit, the router) and by the frontend picker through the `@agentWork`
// alias. Pure and dependency-free so it can be bundled; the server passes its
// stricter host check in, the browser falls back to the literal private ranges.

const READ_ACTIONS = ['tasks.next', 'tasks.search', 'task.get', 'docs.read'];

/* Ordered: the first kind that matches wins, so "fix the failing accessibility
 * tests" is code work, not a report. */
const WORK_KINDS = [
    {
        kind: 'human',
        label: 'a judgement call',
        labelKey: 'human_decision',
        whyKey: 'human_decision',
        test: /\b(decide|decision|choose|pick between|pricing|positioning|roadmap|strateg|approve|negotiat|hire|interview)\w*\b/i,
        why: 'It asks for a decision, and a decision needs someone accountable for it.'
    },
    {
        kind: 'human',
        label: 'talking to someone',
        labelKey: 'human_talk',
        whyKey: 'human_talk',
        test: /\b(call|phone|meet|meeting|vendor|customer|client visit|workshop|demo to)\w*\b/i,
        why: 'It happens outside the tool, with a person on the other end.'
    },
    {
        kind: 'code',
        label: 'change code and hand back a branch',
        labelKey: 'code',
        test: /\b(fix|bug|refactor|implement|migrate|upgrade|bump|dependenc|snapshot|failing|test|patch|typo in code)\w*\b/i,
        actions: ['task.get', 'task.comment', 'task.status.set', 'task.link'],
        skills: ['code', 'repo', 'pr', 'test', 'refactor', 'dependency']
    },
    {
        kind: 'review',
        label: 'find the problems and report them',
        labelKey: 'review',
        test: /\b(audit|review|check|contrast|accessib|a11y|copy|consistency|qa|verify)\w*\b/i,
        actions: ['task.get', 'task.comment'],
        skills: ['review', 'qa', 'audit', 'a11y', 'accessibility', 'design', 'copy', 'risk']
    },
    {
        kind: 'write',
        label: 'draft something for a person to approve',
        labelKey: 'write',
        test: /\b(write|draft|summar|release notes|changelog|digest|report|document)\w*\b/i,
        actions: ['task.get', 'page.draft', 'task.comment'],
        skills: ['write', 'digest', 'summary', 'report', 'docs', 'release']
    },
    {
        kind: 'plan',
        label: 'break the work down',
        labelKey: 'plan',
        test: /\b(plan|break down|estimate|scope|backlog|groom|split)\w*\b/i,
        actions: ['task.get', 'subtask.create', 'task.update'],
        skills: ['plan', 'brief', 'project', 'intake', 'scope']
    }
];

const FALLBACK_KIND = {
    kind: 'general',
    label: 'read it and comment',
    labelKey: 'general',
    actions: ['task.get', 'task.comment'],
    skills: []
};

const MIN_BRIEF_CHARS = 40;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const PR_RE = /\/pull\/\d+|\/merge_requests\/\d+|\/compare\//;
const LOCAL_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[?::1)/i;

const text = (value) => String(value === null || value === undefined ? '' : value);
const words = (value) => text(value).toLowerCase().match(/[a-z0-9]+/g) || [];
const plain = (html) => text(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const taskText = (task = {}) => [task.TaskName, task.TaskKey, (task.tagsArray || []).join(' '), task.rawDescription || task.description]
    .map(text).join(' ');

const classifyTask = (task = {}) => {
    const found = WORK_KINDS.find((k) => k.test.test(taskText(task)));
    if (!found) return { ...FALLBACK_KIND, needsPerson: false };
    if (found.kind === 'human') return { kind: 'human', label: found.label, labelKey: found.labelKey, why: found.why, whyKey: found.whyKey, actions: [], skills: [], needsPerson: true };
    return { kind: found.kind, label: found.label, labelKey: found.labelKey, actions: found.actions, skills: found.skills, needsPerson: false };
};

const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ''; } };
const urlsIn = (task) => [task.TaskName, task.description, task.rawDescription].map(text).join(' ').match(URL_RE) || [];
const docLinkOf = (task) => (Array.isArray(task.links) ? task.links : []).find((l) => /^doc$/i.test(text(l.kind)) && l.url) || null;

const localHost = (host) => LOCAL_HOST_RE.test(host);

/* `task.inputs` is what the server already worked out for this task
 * (/api/v2/agents/routable sends it); it wins over re-deriving from the body. */
const inputsOf = (task = {}, isBlockedHost = localHost) => {
    if (task.inputs && typeof task.inputs === 'object') {
        return { prUrl: task.inputs.prUrl || null, publicUrl: task.inputs.publicUrl || null, briefChars: Number(task.inputs.briefChars) || 0 };
    }
    const isPublic = (url) => { const host = hostOf(url); return Boolean(host) && !isBlockedHost(host); };
    const links = Array.isArray(task.links) ? task.links : [];
    const urls = urlsIn(task);
    const prLink = links.find((l) => /^(pr|branch)$/i.test(text(l.kind)) && l.url) || links.find((l) => PR_RE.test(text(l.url)));
    const linkedPage = links.map((l) => text(l.url)).find((u) => /^https?:\/\//i.test(u) && !PR_RE.test(u) && isPublic(u));
    return {
        prUrl: prLink ? text(prLink.url) : (urls.find((u) => PR_RE.test(u)) || null),
        publicUrl: linkedPage || urls.find((u) => !PR_RE.test(u) && isPublic(u)) || null,
        briefChars: plain(task.description || task.rawDescription).length
    };
};

/* What each declared input is worth on a given task: the value a template reads,
 * and null when the task does not carry it. Presence is `!= null`, so the editor,
 * the run and the picker cannot disagree about whether a skill can start. */
const INPUT_VALUE = {
    brief: (task, isBlockedHost) => { const body = plain(task.description || task.rawDescription); return inputsOf(task, isBlockedHost).briefChars >= MIN_BRIEF_CHARS ? body : null; },
    public_url: (task, isBlockedHost) => inputsOf(task, isBlockedHost).publicUrl,
    pr_link: (task, isBlockedHost) => inputsOf(task, isBlockedHost).prUrl,
    project_task: (task) => (task.ProjectID ? text(task.ProjectID) : null),
    linked_doc: (task) => { const link = docLinkOf(task); return link ? text(link.url) : null; }
};

/* Presence, where it is not simply "the value is there": a brief the server
 * only counted for us has a length but no text. */
const INPUT_PRESENT = {
    brief: (task, isBlockedHost) => inputsOf(task, isBlockedHost).briefChars >= MIN_BRIEF_CHARS
};

/* An input a whole project satisfies: a skill that declares one reports on the
 * project, so it is never the agent for a single task. */
const INPUT_SCOPE = { project_task: 'project' };

const INPUT_CODES = Object.keys(INPUT_VALUE);

const scopeOfInput = (code) => INPUT_SCOPE[code] || 'task';

const valueOfInput = (code, task = {}, isBlockedHost) => (INPUT_VALUE[code] ? INPUT_VALUE[code](task, isBlockedHost) : null);

const hasInput = (code, task = {}, isBlockedHost) => {
    if (INPUT_PRESENT[code]) return INPUT_PRESENT[code](task, isBlockedHost);
    const value = valueOfInput(code, task, isBlockedHost);
    return !(value === null || value === undefined || value === '');
};

const skillKeyOf = (skill) => {
    if (!skill) return '';
    if (typeof skill === 'string') return skill;
    return text(skill.key || skill.slug || skill.name);
};

/* Manifest entries by key and by alias, so an agent naming "risk.today"
 * resolves to the skill that declares the inputs. */
const indexSkills = (manifest = []) => {
    const index = new Map();
    (Array.isArray(manifest) ? manifest : []).forEach((entry) => {
        if (!entry) return;
        const key = skillKeyOf(entry).toLowerCase();
        if (key) index.set(key, entry);
        (entry.aliases || []).forEach((alias) => index.set(text(alias).toLowerCase(), entry));
    });
    return index;
};

/* What this skill needs before it can start, as { code, needs, scope }: taken
 * from the entry itself when the server already answered, else from the
 * manifest index by key. Null means it needs nothing but the task. */
const requiresOf = (skill, index = null) => {
    if (skill && typeof skill === 'object' && skill.requires !== undefined) return skill.requires;
    const found = index ? index.get(skillKeyOf(skill).toLowerCase()) : null;
    return (found && found.requires) || null;
};

module.exports = {
    WORK_KINDS, FALLBACK_KIND, READ_ACTIONS, MIN_BRIEF_CHARS, INPUT_SCOPE, INPUT_CODES,
    classifyTask, inputsOf, taskText, docLinkOf, valueOfInput, hasInput, scopeOfInput,
    skillKeyOf, indexSkills, requiresOf, text, words, plain
};
