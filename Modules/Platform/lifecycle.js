const { STATE_IDS, readState, writeState } = require('./platformState');

const LIFECYCLE_STATES = Object.freeze(['active', 'past_due', 'read_only', 'suspended']);
const TEXT_MAX = 500;

const ACTIVE = Object.freeze({ state: 'active', reason: '', message: '', graceUntil: null, changedAt: null });

let current = { ...ACTIVE };

const shapeOf = (doc) => (doc && LIFECYCLE_STATES.includes(doc.state)
    ? { state: doc.state, reason: doc.reason || '', message: doc.message || '', graceUntil: doc.graceUntil ? new Date(doc.graceUntil) : null, changedAt: doc.changedAt || doc.updatedAt || null }
    : { ...ACTIVE });

/* Read by 064's request guards on every call, so it lives in memory. */
const lifecycle = () => current.state;
const lifecycleState = () => ({ ...current });

async function loadLifecycle() {
    current = shapeOf(await readState(STATE_IDS.LIFECYCLE));
    return lifecycleState();
}

function validateLifecycle(body = {}) {
    const errors = {};
    const state = String(body.state || '');
    if (!LIFECYCLE_STATES.includes(state)) errors.state = 'invalid';
    let graceUntil = null;
    if (body.graceUntil !== undefined && body.graceUntil !== null && body.graceUntil !== '') {
        graceUntil = new Date(body.graceUntil);
        if (!Number.isFinite(graceUntil.getTime())) errors.graceUntil = 'invalid';
    }
    const text = (value) => String(value ?? '').trim().slice(0, TEXT_MAX);
    return { valid: !Object.keys(errors).length, errors, data: { state, reason: text(body.reason), message: text(body.message), graceUntil } };
}

/* Setting the state it already has is a retry: stored and broadcast again, reported unchanged. */
async function setLifecycle(data, { broadcast = require('../../socket/controller/instanceSocket').broadcast, now = new Date() } = {}) {
    const previous = current.state;
    await writeState(STATE_IDS.LIFECYCLE, { ...data, previous, changedAt: now });
    current = { ...data, changedAt: now };
    const { LIFECYCLE_EVENT } = require('../../socket/controller/instanceSocket');
    broadcast(LIFECYCLE_EVENT, { state: data.state, message: data.message, graceUntil: data.graceUntil, changedAt: now });
    return { state: data.state, previous, changed: previous !== data.state };
}

module.exports = {
    LIFECYCLE_STATES, lifecycle, lifecycleState, loadLifecycle, validateLifecycle, setLifecycle,
    _resetForTests: () => { current = { ...ACTIVE }; },
};
