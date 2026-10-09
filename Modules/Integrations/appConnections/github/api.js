const PAGE_SIZE = 100;
const MAX_PAGES = 100;

const headers = (token) => ({
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AlianHub',
});

const defaultGet = async (url, { token, companyId }) => {
    const { safeFetch } = require('../../../Agents/engine/safeFetch');
    return safeFetch(url, { headers: headers(token), companyId, timeoutMs: 15000, maxBytes: 4 * 1024 * 1024 });
};

const header = (res, name) => (res.headers || {})[name];

const rateLimited = (res) => res.status === 429
    || (res.status === 403 && (String(header(res, 'x-ratelimit-remaining')) === '0' || header(res, 'retry-after') !== undefined));

const refusal = (res) => {
    if (res.status === 401) return new Error('GitHub refused the token (401). Connect GitHub again with a new token.');
    if (res.status === 404) return new Error('GitHub cannot find the repository, or the token cannot read it (404).');
    if (rateLimited(res)) return Object.assign(new Error('GitHub rate limit reached; trying again later.'), { retry: { after: header(res, 'retry-after'), reset: header(res, 'x-ratelimit-reset') } });
    if (res.status === 403) return new Error('GitHub refused access to the repository (403).');
    return new Error(`GitHub answered ${res.status}.`);
};

/* Pull requests updated at or after `since`, read newest first until the list reaches `since`, returned oldest first.
 * Only a list longer than MAX_PAGES is cut, and then `truncated` tells the caller to keep its cursor where it was. */
async function listPulls({ repo, token, companyId, since, get = defaultGet }) {
    const floor = since ? new Date(since).getTime() : 0;
    const pulls = [];
    let truncated = false;
    for (let page = 1; ; page += 1) {
        if (page > MAX_PAGES) { truncated = true; break; }
        const url = `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${page}`;
        const res = await get(url, { token, companyId });
        if (res.status !== 200) throw refusal(res);
        let rows;
        try { rows = JSON.parse(res.body); } catch (e) { throw new Error('GitHub sent a reply that is not JSON.'); }
        if (!Array.isArray(rows)) throw new Error('GitHub sent an unexpected reply.');
        const fresh = rows.filter((row) => new Date(row.updated_at).getTime() >= floor);
        pulls.push(...fresh);
        if (fresh.length < rows.length || rows.length < PAGE_SIZE) break;
    }
    return { pulls: pulls.reverse(), truncated };
}

const REPO_PAGES = 10;

const parsed = (res) => {
    if (res.status !== 200) throw refusal(res);
    try { return JSON.parse(res.body); } catch (e) { throw new Error('GitHub sent a reply that is not JSON.'); }
};

async function listRepos({ token, companyId, page = 1, get = defaultGet }) {
    const at = Math.min(Math.max(1, Math.floor(Number(page)) || 1), REPO_PAGES);
    const url = `https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=${PAGE_SIZE}&page=${at}`;
    const rows = parsed(await get(url, { token, companyId }));
    if (!Array.isArray(rows)) throw new Error('GitHub sent an unexpected reply.');
    const repos = rows.filter((r) => r && typeof r.full_name === 'string').map((r) => ({ fullName: r.full_name, private: !!r.private }));
    return { repos, page: at, hasMore: rows.length === PAGE_SIZE && at < REPO_PAGES };
}

async function canReadRepo({ repo, token, companyId, get = defaultGet }) {
    const res = await get(`https://api.github.com/repos/${repo}`, { token, companyId });
    if ([401, 403, 404].includes(res.status) && !rateLimited(res)) return false;
    parsed(res);
    return true;
}

async function accountOf({ token, companyId, get = defaultGet }) {
    const body = parsed(await get('https://api.github.com/user', { token, companyId }));
    return { id: String((body && body.id) || ''), login: String((body && body.login) || '') };
}

module.exports = { listPulls, listRepos, canReadRepo, accountOf, defaultGet, PAGE_SIZE, MAX_PAGES, REPO_PAGES };
