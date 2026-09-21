const crypto = require('crypto');
const { PERSONAL_FIELDS, AMENDED_ACTION } = require('./chainRules');

const PSEUDONYM_PREFIX = 'erased-user-';
const PSEUDONYM_HEX = 16;
const PERSON_ENTITY_TYPES = Object.freeze(['user', 'member']);
/* A nested meta object that carries a userId names whose personal values it holds; the recorder sets it. */
const OWNER_KEY = 'userId';

const pseudonymFor = (key, userId) => {
    const digest = key
        ? crypto.createHmac('sha256', key).update(`audit-erasure:${userId}`).digest('hex')
        : crypto.createHash('sha256').update(`audit-erasure:${userId}`).digest('hex');
    return `${PSEUDONYM_PREFIX}${digest.slice(0, PSEUDONYM_HEX)}`;
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const text = (v) => (v === undefined || v === null ? '' : String(v));

/* An address or browser on an agent's row was the person it acted for; an email names the entity before the actor. */
const ownersOf = (field, ctx) => {
    if (field === 'actorName') return [ctx.actor];
    if (field === 'ip' || field === 'userAgent') return [ctx.actor, ctx.via];
    if (field === 'entityName') return [ctx.entity];
    return [ctx.entity || ctx.actor];
};

const entityOf = (entityType, entityId) => (PERSON_ENTITY_TYPES.includes(entityType) ? text(entityId) : '');

/*
 * `ids` are the person's other identities in this company (their member documents), since member rows may
 * name those instead of the user. Values already pseudonymised are left out, so a second run finds nothing.
 */
const personalPaths = (row, userId, { emails = [], ids = [] } = {}) => {
    const identities = new Set([String(userId), ...ids.map(String)]);
    const known = new Set(emails.map((e) => text(e).trim().toLowerCase()).filter(Boolean));
    const found = [];
    const consider = (path, field, value, ctx) => {
        if (typeof value !== 'string' || !value || value.startsWith(PSEUDONYM_PREFIX)) return;
        const owned = ownersOf(field, ctx).some((owner) => owner && identities.has(text(owner)));
        if (owned || known.has(value.trim().toLowerCase())) found.push({ path, value });
    };
    const fieldsOf = (obj, path, ctx, walkChild) => {
        Object.entries(obj).forEach(([k, v]) => {
            if (PERSONAL_FIELDS.includes(k)) consider(`${path}.${k}`, k, v, ctx);
            else walkChild(v, `${path}.${k}`, k);
        });
    };

    const meta = isObject(row.meta) ? row.meta : {};
    const top = { actor: text(row.actorId), entity: entityOf(row.entityType, row.entityId), via: text(meta.onBehalfOf) };

    const walk = (value, path) => {
        if (Array.isArray(value)) {
            value.forEach((item, i) => walk(item, `${path}.${i}`));
            return;
        }
        if (!isObject(value)) return;
        const marker = typeof value[OWNER_KEY] === 'string' && value[OWNER_KEY] ? value[OWNER_KEY] : '';
        fieldsOf(value, path, marker ? { actor: marker, entity: marker, via: '' } : top, walk);
    };

    PERSONAL_FIELDS.forEach((field) => consider(field, field, row[field], top));
    fieldsOf(meta, 'meta', top, (v, path, key) => {
        if (key === 'setRow' && row.action === AMENDED_ACTION && isObject(v)) {
            const moved = { ...top, entity: entityOf(v.entityType !== undefined ? v.entityType : row.entityType, v.entityId !== undefined ? v.entityId : row.entityId) };
            fieldsOf(v, path, moved, walk);
            return;
        }
        walk(v, path);
    });
    return found;
};

const copyOf = (v) => (Array.isArray(v) ? [...v] : { ...v });

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
