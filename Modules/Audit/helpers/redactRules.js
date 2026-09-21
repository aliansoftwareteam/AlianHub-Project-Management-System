const crypto = require('crypto');
const { PERSONAL_FIELDS } = require('./chainRules');

const PSEUDONYM_PREFIX = 'erased-user-';
const PSEUDONYM_HEX = 16;
const PERSON_ENTITY_TYPES = Object.freeze(['user', 'member']);
/* An object in meta that carries a userId names whose personal values it holds; the recorder sets it. */
const OWNER_KEY = 'userId';

const pseudonymFor = (key, userId) => {
    const digest = key
        ? crypto.createHmac('sha256', key).update(`audit-erasure:${userId}`).digest('hex')
        : crypto.createHash('sha256').update(`audit-erasure:${userId}`).digest('hex');
    return `${PSEUDONYM_PREFIX}${digest.slice(0, PSEUDONYM_HEX)}`;
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const text = (v) => (v === undefined || v === null ? '' : String(v));

/*
 * Whose a personal field is, by its name: the actor's name, address and browser are the actor's (and an
 * address or browser is also the person an agent acted for); an entity name is the entity's when the entity
 * is a person; an email is the entity's when there is one, otherwise the actor's.
 */
const ownersOf = (field, ctx) => {
    if (field === 'actorName') return [ctx.actor];
    if (field === 'ip' || field === 'userAgent') return [ctx.actor, ctx.via];
    if (field === 'entityName') return [ctx.entity];
    return [ctx.entity || ctx.actor];
};

const within = (ctx, obj) => (typeof obj[OWNER_KEY] === 'string' && obj[OWNER_KEY]
    ? { actor: obj[OWNER_KEY], entity: obj[OWNER_KEY], via: '' }
    : ctx);

/*
 * The paths of every personal field (PERSONAL_FIELDS, the ones outside the hash) in a row that belong to the
 * person, by the ownership rules above or because the value is one of the person's email addresses.
 * Values already pseudonymised are left out, so a second run finds nothing.
 */
const personalPaths = (row, userId, { emails = [] } = {}) => {
    const person = String(userId);
    const known = new Set(emails.map((e) => text(e).trim().toLowerCase()).filter(Boolean));
    const found = [];
    const consider = (path, field, value, ctx) => {
        if (typeof value !== 'string' || !value || value.startsWith(PSEUDONYM_PREFIX)) return;
        const owned = ownersOf(field, ctx).some((owner) => text(owner) === person);
        if (owned || known.has(value.trim().toLowerCase())) found.push({ path, value });
    };
    const walk = (value, path, ctx) => {
        if (Array.isArray(value)) {
            value.forEach((item, i) => walk(item, `${path}.${i}`, ctx));
            return;
        }
        if (!isObject(value)) return;
        const here = within(ctx, value);
        Object.entries(value).forEach(([k, v]) => {
            if (PERSONAL_FIELDS.includes(k)) consider(`${path}.${k}`, k, v, here);
            else walk(v, `${path}.${k}`, here);
        });
    };

    const meta = isObject(row.meta) ? row.meta : {};
    const top = {
        actor: text(row.actorId),
        entity: PERSON_ENTITY_TYPES.includes(row.entityType) ? text(row.entityId) : '',
        via: text(meta.onBehalfOf),
    };
    PERSONAL_FIELDS.forEach((field) => consider(field, field, row[field], top));
    walk(meta, 'meta', top);
    return found;
};

const copyOf = (v) => (Array.isArray(v) ? [...v] : { ...v });

/* The row as it reads once each path holds the value, copying only the objects along each path. */
const withValues = (row, paths, value) => {
    const out = { ...row };
    paths.forEach(({ path }) => {
        const keys = path.split('.');
        const last = keys.pop();
        let target = out;
        for (const k of keys) {
            if (target[k] === null || typeof target[k] !== 'object') return;
            target[k] = copyOf(target[k]);
            target = target[k];
        }
        target[last] = value;
    });
    return out;
};

module.exports = { PSEUDONYM_PREFIX, PERSON_ENTITY_TYPES, OWNER_KEY, pseudonymFor, personalPaths, withValues };
