const PAGE_SIZE = 50;
const MAX_PAGES = 10;

const headers = (token) => ({
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AlianHub',
});

const defaultGet = async (url, { token, companyId }) => {
    const { safeFetch } = require('../../../Agents/engine/safeFetch');
    return safeFetch(url, { headers: headers(token), companyId, timeoutMs: 15000, maxBytes: 4 * 1024 * 1024 });
};

const refusal = (res) => {
    if (res.status === 401) return 'GitHub refused the token (401). Connect GitHub again with a new token.';
    if (res.status === 404) return 'GitHub cannot find the repository, or the token cannot read it (404).';
    const h = res.headers || {};
    if (res.status === 429 || (res.status === 403 && String(h['x-ratelimit-remaining']) === '0')) return 'GitHub rate limit reached; trying again later.';
    if (res.status === 403) return 'GitHub refused access to the repository (403).';
    return `GitHub answered ${res.status}.`;
};

/* Pull requests updated at or after `since`, newest first from GitHub and returned oldest first. A page limit that
 * cuts the list short is reported, so the caller does not move its cursor past pull requests it never saw. */
async function listPulls({ repo, token, companyId, since, get = defaultGet }) {
    const floor = since ? new Date(since).getTime() : 0;
    const pulls = [];
    let truncated = false;
    for (let page = 1; ; page += 1) {
        if (page > MAX_PAGES) { truncated = true; break; }
        const url = `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${page}`;
        const res = await get(url, { token, companyId });
        if (res.status !== 200) throw new Error(refusal(res));
        let rows;
        try { rows = JSON.parse(res.body); } catch (e) { throw new Error('GitHub sent a reply that is not JSON.'); }
        if (!Array.isArray(rows)) throw new Error('GitHub sent an unexpected reply.');
        const fresh = rows.filter((row) => new Date(row.updated_at).getTime() >= floor);
        pulls.push(...fresh);
        if (fresh.length < rows.length || rows.length < PAGE_SIZE) break;
    }
    return { pulls: pulls.reverse(), truncated };
}

module.exports = { listPulls, defaultGet, PAGE_SIZE, MAX_PAGES };
