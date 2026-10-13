const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const DOTS_ONLY = /\/\.{1,2}$/;

const isRepo = (value) => REPO.test(String(value || '')) && !DOTS_ONLY.test(String(value || ''));
const sameRepo = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(String))];

const isMapped = (row) => Array.isArray(row && row.repos);

/* A row not yet migrated (or saved by the pasted-token form) holds one repository in config.repo and the projects it
 * feeds in projectIds; it reads as a one-entry mapping whose sync state is the row's own. */
const reposOf = (row) => {
    if (!row) return [];
    if (isMapped(row)) {
        return row.repos.filter((entry) => entry && isRepo(entry.repo))
            .map((entry) => ({ repo: String(entry.repo), projectIds: ids(entry.projectIds), sync: entry.sync || {} }));
    }
    const repo = String((row.config || {}).repo || '');
    return isRepo(repo) ? [{ repo, projectIds: ids(row.projectIds), sync: row.sync || {}, legacy: true }] : [];
};

const reposOfProject = (row, projectId) => reposOf(row).filter((entry) => entry.projectIds.includes(String(projectId)));

const mappedProjectIds = (row) => ids(reposOf(row).flatMap((entry) => entry.projectIds));

/* What the row stores once it holds a mapping: a repository feeding no project goes, and a legacy entry carries its cursor
 * over so nothing is read twice or skipped. */
const stored = (entries) => entries.filter((entry) => entry.projectIds.length).map(({ repo, projectIds, sync, legacy }) => ({
    repo, projectIds, sync: legacy ? { ...(sync.cursor ? { cursor: sync.cursor } : {}), ...(sync.lastSyncAt ? { lastSyncAt: sync.lastSyncAt } : {}) } : (sync || {}),
}));

const withProject = (row, repo, projectId, startAt) => {
    const entries = reposOf(row);
    const found = entries.find((entry) => sameRepo(entry.repo, repo));
    if (found) {
        if (found.projectIds.includes(String(projectId))) return { entries: stored(entries), changed: false };
        found.projectIds = [...found.projectIds, String(projectId)];
        return { entries: stored(entries), changed: true };
    }
    return { entries: [...stored(entries), { repo, projectIds: [String(projectId)], sync: startAt ? { cursor: startAt } : {} }], changed: true };
};

const withoutProject = (row, repo, projectId) => {
    const entries = reposOf(row);
    const found = entries.find((entry) => sameRepo(entry.repo, repo) && entry.projectIds.includes(String(projectId)));
    if (!found) return { entries: stored(entries), changed: false };
    found.projectIds = found.projectIds.filter((id) => id !== String(projectId));
    return { entries: stored(entries), changed: true };
};

/* The update that writes a mapping, dropping the old single-repository fields in the same write. */
const mappingUpdate = (entries) => ({ $set: { repos: entries }, $unset: { 'config.repo': '', projectIds: '' } });

module.exports = { REPO, isRepo, sameRepo, isMapped, reposOf, reposOfProject, mappedProjectIds, stored, withProject, withoutProject, mappingUpdate };
