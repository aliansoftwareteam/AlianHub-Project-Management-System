const KEY = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})(?!\d)/g;

const keysIn = (...texts) => {
    const found = new Set();
    for (const text of texts) {
        for (const m of String(text || '').matchAll(KEY)) found.add(`${m[1].toUpperCase()}-${Number(m[2])}`);
    }
    return [...found];
};

const keysOfPull = (pull) => keysIn(pull.title, pull.head && pull.head.ref, pull.body);

const eventsOfPull = (repo, pull) => {
    const base = { number: pull.number, title: String(pull.title || ''), url: pull.html_url, author: pull.user && pull.user.login, repo, keys: keysOfPull(pull) };
    const at = pull.updated_at;
    const out = [];
    if (pull.state === 'open' || pull.merged_at) out.push({ key: `github:${repo}#${pull.number}:opened`, at, kind: 'opened', data: base });
    if (pull.merged_at) out.push({ key: `github:${repo}#${pull.number}:merged`, at, kind: 'merged', data: { ...base, mergeCommit: pull.merge_commit_sha || '', mergedAt: pull.merged_at } });
    return out;
};

module.exports = { keysIn, keysOfPull, eventsOfPull };
