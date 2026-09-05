// What a task carries that a skill might need: a pull request, a public page, a
// brief. The router refuses an agent whose skills need an input the task lacks,
// instead of starting a run that skips.

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const PR_RE = /\/pull\/\d+|\/merge_requests\/\d+|\/compare\//;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[?::1)/i;
const MIN_BRIEF_CHARS = 40;

const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ''; } };
const isPublic = (url) => { const h = hostOf(url); return Boolean(h) && !PRIVATE_HOST.test(h); };

const urlsIn = (task) => [task.TaskName, task.description, task.rawDescription].map((v) => String(v || '')).join(' ').match(URL_RE) || [];

const prUrlOf = (task) => {
    const links = Array.isArray(task.links) ? task.links : [];
    const linked = links.find((l) => /^(pr|branch)$/i.test(String(l.kind || '')) && l.url) || links.find((l) => PR_RE.test(String(l.url || '')));
    if (linked) return String(linked.url);
    return urlsIn(task).find((u) => PR_RE.test(u)) || null;
};

const publicUrlOf = (task) => {
    const links = Array.isArray(task.links) ? task.links : [];
    const linked = links.map((l) => String(l.url || '')).find((u) => /^https?:\/\//i.test(u) && !PR_RE.test(u) && isPublic(u));
    if (linked) return linked;
    return urlsIn(task).find((u) => !PR_RE.test(u) && isPublic(u)) || null;
};

const inputsOf = (task = {}) => ({
    prUrl: prUrlOf(task),
    publicUrl: publicUrlOf(task),
    briefChars: plain(task.description || task.rawDescription || '').length,
});

module.exports = { inputsOf, MIN_BRIEF_CHARS };
