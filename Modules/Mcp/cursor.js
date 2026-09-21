const crypto = require('crypto');

const PAGE_DEFAULT = 25;
const PAGE_MAX = 100;
const TTL_MS = 60 * 60 * 1000;
const INVALID = 'Invalid cursor.';

// Without a configured key, cursors fall back to one derived from JWT_SECRET, and
// failing that to a per-process key, so a restart only ends the cursors in flight.
const PROCESS_KEY = crypto.randomBytes(32);

const key = () => {
    if (process.env.MCP_CURSOR_SECRET) return process.env.MCP_CURSOR_SECRET;
    if (process.env.JWT_SECRET) return crypto.createHmac('sha256', process.env.JWT_SECRET).update('mcp-cursor').digest();
    return PROCESS_KEY;
};

const sign = (body) => crypto.createHmac('sha256', key()).update(body).digest('base64url');

const invalid = () => Object.assign(new Error(INVALID), { code: -32602 });

const pageSize = (limit) => Math.min(Math.max(parseInt(limit, 10) || PAGE_DEFAULT, 1), PAGE_MAX);

const stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
};

/* The page size may change between pages; anything else in the arguments is the query. */
const queryHash = (tool, args = {}) => {
    const query = Object.fromEntries(Object.entries(args || {}).filter(([k]) => k !== 'cursor' && k !== 'limit'));
    return crypto.createHash('sha256').update(`${tool}\n${stable(query)}`).digest('base64url');
};

const binding = (ctx, tool, args) => ({
    c: String(ctx.companyId),
    u: String(ctx.userId),
    k: String((ctx.token && ctx.token._id) || ''),
    q: queryHash(tool, args),
});

const issue = (ctx, tool, args, offset) => {
    const body = Buffer.from(JSON.stringify({ ...binding(ctx, tool, args), o: offset, x: Date.now() + TTL_MS })).toString('base64url');
    return `${body}.${sign(body)}`;
};

/* The offset a cursor carries, once it proves it was issued here for this company, caller, token and query. */
const open = (ctx, tool, args, cursor) => {
    const [body, mac, extra] = String(cursor || '').split('.');
    if (!body || !mac || extra !== undefined) throw invalid();
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw invalid();
    let claims;
    try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { throw invalid(); }
    const want = binding(ctx, tool, args);
    if (Object.keys(want).some((k) => claims[k] !== want[k])) throw invalid();
    if (!Number.isInteger(claims.o) || claims.o < 0 || !(Number(claims.x) > Date.now())) throw invalid();
    return claims.o;
};

/* One page of a find: asks for one row more than it returns, so it knows whether another page exists. */
const page = async (ctx, tool, args, readRows) => {
    const size = pageSize(args.limit);
    const offset = args.cursor === undefined || args.cursor === null || args.cursor === '' ? 0 : open(ctx, tool, args, args.cursor);
    const rows = (await readRows({ skip: offset, limit: size + 1 })) || [];
    const more = rows.length > size;
    return { rows: rows.slice(0, size), nextCursor: more ? issue(ctx, tool, args, offset + size) : undefined };
};

module.exports = { PAGE_DEFAULT, PAGE_MAX, TTL_MS, pageSize, issue, open, page };
