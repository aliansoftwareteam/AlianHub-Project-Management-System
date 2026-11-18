const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { isPerson } = require('../../Users/helpers/reportingLine');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const MARKUP = /\[[^\]]*\]\([^)]*\)/g;
const NAME_ONLY = /@\[([^\]\n]{1,120})\]/g;
const BARE_ID = /(^|[^\w])@([0-9a-fA-F]{24})(?![\w])/g;
const LEFTOVER = /(^|[^\w])@([A-Za-z][\w.-]*)/g;
const EVERYONE_WORDS = new Set(['all', 'everyone']);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const personName = (u) => String(u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ') || '').trim();
const keyOf = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

const companyPeople = async (companyId) => {
    const seats = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ ...ACTIVE_SEAT }, { userId: 1, ghostUser: 1, isAgent: 1, isBot: 1, kind: 1, agentId: 1, apiTokenId: 1 }],
    }, 'find');
    const ids = [...new Set((seats || []).filter(isPerson).map((seat) => String(seat.userId || '')).filter((id) => OBJECT_ID.test(id)))];
    if (!ids.length) return [];
    const users = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 }],
    }, 'find');
    return (users || []).map((u) => ({ userId: String(u._id), name: personName(u) })).filter((p) => p.name);
};

/* An agent writes a mention as the editor does, "@[Name](id)", or by name alone: "@[Name]", "@Name" or "@<id>". The
 * named forms are matched against the company's people and rewritten into the editor's markup, so the thread shows
 * them and the web comment's own notice path reads them. A name two people share is left as written. */
const markMentions = async (companyId, message) => {
    const text = String(message || '');
    if (!text.includes('@')) return { message: text, named: [], notFound: [], people: [] };
    const people = await companyPeople(companyId);
    const byId = new Map(people.map((p) => [p.userId.toLowerCase(), p]));
    const byName = new Map();
    people.forEach((p) => byName.set(keyOf(p.name), [...(byName.get(keyOf(p.name)) || []), p]));
    const named = new Map();
    const notFound = new Set();
    const markup = (p) => { named.set(p.userId, p); return `@[${p.name}](${p.userId})`; };
    const single = (name) => { const found = byName.get(keyOf(name)) || []; return found.length === 1 ? found[0] : null; };
    const names = [...byName.keys()].filter((key) => byName.get(key).length === 1).sort((a, b) => b.length - a.length);

    const rewrite = (gap) => {
        let out = gap.replace(NAME_ONLY, (whole, name) => {
            const p = single(name);
            if (p) return markup(p);
            if (!EVERYONE_WORDS.has(keyOf(name))) notFound.add(name.trim());
            return whole;
        });
        out = out.replace(BARE_ID, (whole, lead, id) => {
            const p = byId.get(id.toLowerCase());
            if (p) return `${lead}${markup(p)}`;
            notFound.add(id);
            return whole;
        });
        names.forEach((key) => {
            const p = byName.get(key)[0];
            const pattern = new RegExp(`(^|[^\\w])@(${key.split(' ').map(escapeRegex).join('\\s+')})(?![\\w])`, 'gi');
            out = out.replace(pattern, (whole, lead) => `${lead}${markup(p)}`);
        });
        return out;
    };

    const parts = [];
    let last = 0;
    for (const match of text.matchAll(MARKUP)) {
        parts.push(rewrite(text.slice(last, match.index)));
        const id = (/\(\s*([^)]*?)\s*\)$/.exec(match[0]) || [])[1] || '';
        if (OBJECT_ID.test(id)) {
            const p = byId.get(id.toLowerCase());
            if (p) named.set(p.userId, p);
            else if (text[match.index - 1] === '@') notFound.add(id);
        }
        parts.push(match[0]);
        last = match.index + match[0].length;
    }
    parts.push(rewrite(text.slice(last)));
    const out = parts.join('');

    out.replace(MARKUP, ' ').replace(LEFTOVER, (whole, lead, word) => {
        if (!EVERYONE_WORDS.has(word.toLowerCase())) notFound.add(word);
        return whole;
    });
    return { message: out, named: [...named.values()], notFound: [...notFound], people };
};

module.exports = { markMentions };
