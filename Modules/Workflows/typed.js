const stepTypes = require('./stepTypes');

// The typed result, checked at both ends of every edge.
//
// A step's contract in `stepTypes/index.js` says what that step produces, field
// by field. This is what makes the declaration mean something at run time:
//
//   Outbound — what an executor returned is checked against its own contract
//     before it is written to the step row, so a malformed result never becomes
//     anybody's input.
//   Inbound — what a step reads, as `$<stepId>.field`, is checked against the
//     contract of the step it reads from and against the value that step
//     actually produced, before this step is claimed.
//
// Both refusals are deterministic and both name the field. That is the whole
// reason for doing it here rather than letting the consumer discover it: a
// condition reading a field that does not exist is not an error anywhere, it is
// silently false, and a run that quietly took the wrong branch is worse than one
// that stopped and said which field was missing.

const TYPE_OF = (value) => {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'list';
    return typeof value;
};

const CHECKS = {
    string: (value) => typeof value === 'string',
    number: (value) => typeof value === 'number' && Number.isFinite(value),
    boolean: (value) => typeof value === 'boolean',
    list: (value) => Array.isArray(value),
    object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
    date: (value) => value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value))),
    any: () => true,
};

const deterministic = (message) => Object.assign(new Error(message), { name: 'DeterministicError', deterministic: true, code: 'contract_mismatch' });

const specsOf = (type) => {
    const contract = stepTypes.get(type);
    return contract && contract.output ? contract.output : null;
};

const fieldsOf = (type) => Object.keys(specsOf(type) || {});

/* Does this output honour the contract its step declared? Field-level, because
 * "the result was wrong" is not something anybody can act on and "costUsd is a
 * string" is. */
const checkOutput = (type, output) => {
    const specs = specsOf(type);
    if (!specs) return { valid: true, errors: [] };
    if (output !== null && output !== undefined && !CHECKS.object(output)) {
        return { valid: false, errors: [`a ${type} step must produce an object, not a ${TYPE_OF(output)}`] };
    }
    const value = output || {};
    const errors = [];
    for (const [field, spec] of Object.entries(specs)) {
        const present = value[field] !== undefined && value[field] !== null;
        if (!present) {
            if (spec.required) errors.push(`"${field}" is required by the ${type} contract and the step produced none`);
            continue;
        }
        const check = CHECKS[spec.type] || CHECKS.any;
        if (!check(value[field])) errors.push(`"${field}" must be a ${spec.type} in the ${type} contract, and the step produced a ${TYPE_OF(value[field])}`);
    }
    return { valid: errors.length === 0, errors };
};

const assertOutput = (step, output) => {
    const { valid, errors } = checkOutput(step.type, output);
    if (!valid) throw deterministic(`step ${step.stepId} (${step.type}) broke its own contract: ${errors.join('; ')}`);
    return output;
};

/* Every `$<stepId>.<field>` a step's configuration reads, wherever it sits in
 * the nested condition trees a `when` or a `while` can be. */
const REF = /^\$([0-9a-zA-Z_-]+)(?:\.([0-9a-zA-Z_.-]+))?$/;

const refsIn = (node, found = [], depth = 0) => {
    if (depth > 12 || node === null || node === undefined) return found;
    if (typeof node === 'string') {
        const [, stepId, field] = node.match(REF) || [];
        if (stepId) found.push({ stepId, field: field ? String(field).split('.')[0] : null, raw: node });
        return found;
    }
    if (Array.isArray(node)) { node.forEach((child) => refsIn(child, found, depth + 1)); return found; }
    if (typeof node === 'object') { Object.values(node).forEach((child) => refsIn(child, found, depth + 1)); return found; }
    return found;
};

/* What this step is about to read, checked against what its producers declared
 * and against what they in fact produced.
 *
 * A reference to a step that has not finished is not an error: the scheduler is
 * what decides when a step may run, and a loop body reads across iterations. Only
 * a field the producer's contract does not have, or a finished producer that did
 * not produce it, is refused. */
const checkInputs = (step, steps) => {
    const byId = new Map(steps.map((row) => [String(row.stepId), row]));
    const errors = [];
    for (const ref of refsIn((step && step.config) || {})) {
        if (!ref.field) continue;
        const producer = byId.get(ref.stepId);
        if (!producer) continue;
        const specs = specsOf(producer.type);
        if (specs && !Object.prototype.hasOwnProperty.call(specs, ref.field)) {
            errors.push(`reads "${ref.raw}" but a ${producer.type} step produces no "${ref.field}" — it produces ${fieldsOf(producer.type).join(', ') || 'nothing'}`);
            continue;
        }
        if (producer.status === 'success' && (producer.output || {})[ref.field] === undefined) {
            errors.push(`reads "${ref.raw}" and step ${ref.stepId} finished without a "${ref.field}"`);
        }
    }
    return { valid: errors.length === 0, errors };
};

const assertInputs = (step, steps) => {
    const { valid, errors } = checkInputs(step, steps);
    if (!valid) throw deterministic(`step ${step.stepId} (${step.type}) cannot be given its input: ${errors.join('; ')}`);
    return true;
};

module.exports = { CHECKS, deterministic, specsOf, fieldsOf, refsIn, checkOutput, assertOutput, checkInputs, assertInputs };
