// The floor is bounded both ways: at 0 it would stop filtering, at 1 it would
// file nothing, and either would read as the verifier working.

const DEFAULT_FLOOR = 0.6;
const MIN_FLOOR = 0.3;
const MAX_FLOOR = 0.9;
const FLOOR_REASON = `confidenceFloor must be a number between ${MIN_FLOOR} and ${MAX_FLOOR}`;

const numberOf = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') { const n = Number(value); return Number.isFinite(n) ? n : null; }
    return null;
};

const between = (n, low, high) => Math.min(high, Math.max(low, n));

/* The agent's floor, then the skill's, then the default. */
const floorFor = (skill, agent) => {
    const set = numberOf(agent && agent.confidenceFloor);
    const declared = set === null ? numberOf(skill && skill.confidenceFloor) : set;
    return declared === null ? DEFAULT_FLOOR : between(declared, MIN_FLOOR, MAX_FLOOR);
};

/* Null when the model did not report one: such a finding is kept, so answers from before the field existed still verify. */
const confidenceOf = (value) => {
    const n = numberOf(value);
    return n === null ? null : between(n, 0, 1);
};

/* The API refuses a floor outside the bounds rather than clamping it; null clears it. */
const floorToStore = (value) => {
    if (value === null) return null;
    const n = numberOf(value);
    if (n === null || n < MIN_FLOOR || n > MAX_FLOOR) throw Object.assign(new Error(FLOOR_REASON), { status: 400 });
    return n;
};

module.exports = { DEFAULT_FLOOR, MIN_FLOOR, MAX_FLOOR, FLOOR_REASON, floorFor, confidenceOf, floorToStore };
