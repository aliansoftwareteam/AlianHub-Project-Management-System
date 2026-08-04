// Custom agents — pure rules. No DB, no network, no env reads, so this is
// unit-testable and safe to require from anywhere.
//
// Build step 01 (foundation): validation, the skill catalogue and the trigger
// shapes. The runner that consumes them lands in step 02.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const MAX_NAME = 60;
const MAX_DESCRIPTION = 280;
const MAX_INSTRUCTIONS = 8000;
const MAX_TRIGGERS = 6;
const MAX_CONTEXT_REFS = 25;

// Scope levels, ordered narrowest → widest. The order is meaningful: scope.js
// walks it, and the UI lists it.
const SCOPE_LEVELS = Object.freeze(['task', 'sprint', 'folder', 'project', 'company']);

// Only 'company' may omit refId — every other level is anchored to something.
const SCOPE_NEEDS_REF = Object.freeze(['task', 'sprint', 'folder', 'project']);

const TRIGGER_TYPES = Object.freeze(['mention', 'assigned', 'schedule', 'event']);

// Events an agent may be attached to. Kept deliberately short: each one has to
// have a real emit point wired to it, and an event with no emit point is a
// promise the UI can't keep.
const TRIGGER_EVENTS = Object.freeze(['task.created', 'task.status_changed']);

/**
 * The skill catalogue — the tools an agent can be granted.
 *
 * `write: true` means the skill changes data. Those are separated in the UI and,
 * per the plan, default to requiring approval. An agent holding only read/comment
 * skills cannot damage anything, which is what makes prompt injection in a task
 * description survivable rather than dangerous.
 *
 * Ten well-gated tools beat a long list nobody can audit, so this list grows
 * only when a skill has a real, permission-checked implementation behind it.
 */
// `available` is whether the runner can actually PERFORM the skill today. The
// unavailable ones are listed so the settings page can show what is coming, but
// they cannot be granted: a permission that silently does nothing is worse than
// an absent one, because the agent's badge then promises a capability it does not
// have. Flip a flag to true in the same commit that implements its tool in
// runner/tools.js — the two must never disagree.
const SKILLS = Object.freeze([
    { key: 'context.read',    name: 'Read its scope',        write: false, available: true,  desc: 'Read tasks, comments and details inside its own scope.' },
    { key: 'comment.write',   name: 'Post a comment',        write: false, available: true,  desc: 'Reply on a task. Adds nothing and changes nothing else.' },
    { key: 'task.update',     name: 'Update a task',         write: true,  available: false, desc: 'Change status, priority, due date or description.' },
    { key: 'task.create',     name: 'Create a task',         write: true,  available: false, desc: 'Add a new task inside its scope.' },
    { key: 'subtask.create',  name: 'Create a subtask',      write: true,  available: false, desc: 'Break a task down.' },
    { key: 'task.assign',     name: 'Assign a task',         write: true,  available: false, desc: 'Set or change assignees.' },
    { key: 'checklist.write', name: 'Write a checklist',     write: true,  available: false, desc: 'Add checklist items to a task.' },
    { key: 'tag.write',       name: 'Apply tags',            write: true,  available: false, desc: 'Add or remove tags.' },
]);

const SKILL_KEYS = Object.freeze(SKILLS.map((s) => s.key));
const WRITE_SKILL_KEYS = Object.freeze(SKILLS.filter((s) => s.write).map((s) => s.key));
// The only keys that may be persisted on an agent.
const GRANTABLE_SKILL_KEYS = Object.freeze(SKILLS.filter((s) => s.available).map((s) => s.key));

const DEFAULT_LIMITS = Object.freeze({ runsPerDay: 50, tokensPerRun: 8000, requireApproval: true });
const MAX_RUNS_PER_DAY = 500;
const MAX_TOKENS_PER_RUN = 32000;

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

/**
 * Can this agent actually change data?
 *
 * Only counts write skills the runner can perform. Anything else would put a
 * "Can change data" badge on an agent that provably cannot, which is the kind of
 * detail people calibrate their trust on.
 */
const hasWriteSkill = (skills = []) => (skills || [])
    .some((s) => WRITE_SKILL_KEYS.includes(s) && GRANTABLE_SKILL_KEYS.includes(s));

const clip = (value, max) => String(value === null || value === undefined ? '' : value).trim().slice(0, max);

/**
 * Basic cron sanity: five space-separated fields of permitted characters.
 *
 * Deliberately NOT a full cron parser — this only rejects obvious rubbish before
 * it reaches the scheduler. The scheduler validates properly when step 05 lands;
 * accepting a plausible-looking string here and failing later is better than
 * shipping a half-parser that disagrees with the real one.
 */
const isCronish = (value) => {
    const parts = String(value || '').trim().split(/\s+/);
    if (parts.length !== 5) return false;
    return parts.every((p) => /^[0-9*,/\-]+$/.test(p));
};

/** Validate one trigger. Returns the cleaned trigger, or null to drop it. */
const sanitizeTrigger = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const type = String(raw.type || '');
    if (!TRIGGER_TYPES.includes(type)) return null;

    if (type === 'mention' || type === 'assigned') return { type };

    if (type === 'schedule') {
        const cron = clip(raw.cron, 120);
        if (!isCronish(cron)) return null;
        return { type, cron };
    }

    // event
    const event = String(raw.event || '');
    if (!TRIGGER_EVENTS.includes(event)) return null;
    const rawConditions = (raw.conditions && typeof raw.conditions === 'object' && !Array.isArray(raw.conditions))
        ? raw.conditions : {};
    const conditions = {};
    // Structured only — see the plan. A prompt-evaluated condition costs an LLM
    // call on every matching event just to decide whether to act, which is how a
    // quiet feature becomes an unbounded bill.
    if (rawConditions.priority) conditions.priority = clip(rawConditions.priority, 20);
    if (rawConditions.statusType) conditions.statusType = clip(rawConditions.statusType, 40);
    if (rawConditions.taskTypeKey) conditions.taskTypeKey = clip(rawConditions.taskTypeKey, 40);
    return { type, event, conditions };
};

/** Validate and normalise a scope. Returns { valid, reason, value }. */
const validateScope = (raw) => {
    const s = (raw && typeof raw === 'object') ? raw : {};
    const level = String(s.level || 'company');
    if (!SCOPE_LEVELS.includes(level)) {
        return { valid: false, reason: `scope.level must be one of: ${SCOPE_LEVELS.join(', ')}.`, value: null };
    }
    if (level === 'company') return { valid: true, reason: '', value: { level, refId: null } };
    const refId = String(s.refId || '');
    if (!isObjectIdString(refId)) {
        return { valid: false, reason: `A ${level} scope needs a valid refId.`, value: null };
    }
    return { valid: true, reason: '', value: { level, refId } };
};

/**
 * Validate an agent create/update payload.
 *
 * `partial` is true for updates, where an absent field means "leave it alone"
 * rather than "clear it" — so a rename must not silently wipe the instructions.
 */
const validateAgent = (raw = {}, { partial = false } = {}) => {
    const errors = [];
    const out = {};

    const nameGiven = raw.name !== undefined;
    if (nameGiven || !partial) {
        const name = clip(raw.name, MAX_NAME);
        if (!name) errors.push('A name is required.');
        else out.name = name;
    }

    const instructionsGiven = raw.instructions !== undefined;
    if (instructionsGiven || !partial) {
        const instructions = clip(raw.instructions, MAX_INSTRUCTIONS);
        if (!instructions) errors.push('Instructions are required — they are what the agent does.');
        else out.instructions = instructions;
    }

    if (raw.description !== undefined) out.description = clip(raw.description, MAX_DESCRIPTION);
    if (raw.emoji !== undefined) out.emoji = clip(raw.emoji, 8);
    if (raw.colour !== undefined) {
        const colour = clip(raw.colour, 7);
        if (colour && !HEX_COLOUR_PATTERN.test(colour)) errors.push('colour must be a #rrggbb hex value.');
        else out.colour = colour || '#2F3990';
    }

    if (raw.scope !== undefined || !partial) {
        const scopeCheck = validateScope(raw.scope);
        if (!scopeCheck.valid) errors.push(scopeCheck.reason);
        else out.scope = scopeCheck.value;
    }

    if (raw.triggers !== undefined) {
        const list = Array.isArray(raw.triggers) ? raw.triggers.slice(0, MAX_TRIGGERS) : [];
        const seen = new Set();
        out.triggers = list.map(sanitizeTrigger).filter((t) => {
            if (!t) return false;
            // One of each kind is enough; two 'mention' triggers would just double-run.
            const key = t.type === 'event' ? `event:${t.event}` : t.type;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    if (raw.skills !== undefined) {
        const list = Array.isArray(raw.skills) ? raw.skills : [];
        // Unknown skills are dropped rather than rejected: the allow-list is the
        // security boundary, so anything unrecognised simply isn't granted.
        //
        // Not-yet-implemented skills are dropped for the same reason. Storing one
        // would show a "Can change data" badge on an agent whose every write
        // attempt the runner refuses — so the config would claim something the
        // behaviour contradicts.
        out.skills = [...new Set(list.map((s) => String(s)).filter((s) => GRANTABLE_SKILL_KEYS.includes(s)))];
    }

    if (raw.context !== undefined) {
        const c = (raw.context && typeof raw.context === 'object') ? raw.context : {};
        const ids = (arr) => [...new Set((Array.isArray(arr) ? arr : [])
            .map((x) => String(x)).filter(isObjectIdString))].slice(0, MAX_CONTEXT_REFS);
        out.context = { docIds: ids(c.docIds), taskIds: ids(c.taskIds) };
    }

    if (raw.limits !== undefined) {
        const l = (raw.limits && typeof raw.limits === 'object') ? raw.limits : {};
        const bounded = (v, fallback, max) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n <= 0) return fallback;
            return Math.min(Math.floor(n), max);
        };
        out.limits = {
            runsPerDay: bounded(l.runsPerDay, DEFAULT_LIMITS.runsPerDay, MAX_RUNS_PER_DAY),
            tokensPerRun: bounded(l.tokensPerRun, DEFAULT_LIMITS.tokensPerRun, MAX_TOKENS_PER_RUN),
            requireApproval: l.requireApproval === undefined ? DEFAULT_LIMITS.requireApproval : !!l.requireApproval,
        };
    }

    if (raw.enabled !== undefined) out.enabled = !!raw.enabled;

    // A write-capable agent may not silently opt out of approval on creation.
    // Turning it off is a deliberate later edit, not the default someone inherits.
    const effectiveSkills = out.skills !== undefined ? out.skills : (raw.skills || []);
    if (!partial && hasWriteSkill(effectiveSkills)) {
        out.limits = { ...(out.limits || DEFAULT_LIMITS), requireApproval: true };
    }

    if (partial && !Object.keys(out).length) errors.push('Nothing to update.');

    return { valid: errors.length === 0, errors, value: errors.length ? null : out };
};

/** One-line human summary of when an agent runs — used in the list view. */
const describeTriggers = (triggers = []) => {
    if (!triggers.length) return 'Never runs — no triggers set';
    return triggers.map((t) => {
        if (t.type === 'mention') return 'When mentioned';
        if (t.type === 'assigned') return 'When assigned a task';
        if (t.type === 'schedule') return `On schedule (${t.cron})`;
        if (t.type === 'event') return `On ${String(t.event || '').replace(/[._]/g, ' ')}`;
        return t.type;
    }).join(' · ');
};

module.exports = {
    SCOPE_LEVELS,
    SCOPE_NEEDS_REF,
    TRIGGER_TYPES,
    TRIGGER_EVENTS,
    SKILLS,
    SKILL_KEYS,
    WRITE_SKILL_KEYS,
    GRANTABLE_SKILL_KEYS,
    DEFAULT_LIMITS,
    MAX_NAME,
    MAX_INSTRUCTIONS,
    isObjectIdString,
    isCronish,
    hasWriteSkill,
    sanitizeTrigger,
    validateScope,
    validateAgent,
    describeTriggers,
};
