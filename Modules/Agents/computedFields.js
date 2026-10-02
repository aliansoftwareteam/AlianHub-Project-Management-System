const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { ROLLUP_FUNCTIONS, MAX_EXPRESSION_LENGTH } = require('../CustomField/helpers/formula');
const { COMPUTED_TYPES, validateFormulaDefinition } = require('../CustomField/helpers/computeFields');

// A rollup and a formula as the field form saves them. A rollup is one function over one number field of the subtasks
// under a task, on every level; a formula is an expression over the task's own number fields. Nobody types a value
// into either: the field routes work the number out and store it on the task, and here they are asked to.

const FORMULA = 'formula';
const ROLLUP = 'rollup';
const COUNT = 'count';
/* The fields the field form offers a rollup to read (FieldBuilder.vue). */
const SOURCE_TYPES = Object.freeze(['number', 'money', 'rating', 'progress', ...COMPUTED_TYPES]);

const isComputed = (type) => COMPUTED_TYPES.includes(type);
const textOf = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/* What a caller names for a rollup or a formula, beside its name and type; `nameOf` cleans a field name. */
const partOf = (field, type, nameOf) => {
    if (type === FORMULA) return { expression: textOf(field.expression, MAX_EXPRESSION_LENGTH + 1) };
    if (type !== ROLLUP) return {};
    const source = nameOf(field.source);
    return { function: ROLLUP_FUNCTIONS.includes(field.function) ? field.function : '', ...(source ? { source } : {}) };
};

const problemOf = (draft) => {
    if (draft.type === FORMULA) {
        if (!draft.expression) return 'is a formula, which needs an expression';
        const check = validateFormulaDefinition({ definitions: [], fieldTitle: draft.name, expression: draft.expression });
        return check.valid ? '' : `has a formula that cannot be read: ${check.reason}`;
    }
    if (draft.type !== ROLLUP) return '';
    if (!draft.function) return `is a rollup, which needs a function: one of ${ROLLUP_FUNCTIONS.join(', ')}`;
    return draft.source || draft.function === COUNT ? '' : `needs source: the name of the number field its ${draft.function} is taken of`;
};

/* '' where a rollup can read `found`, the field its source names among the project's fields and the call's own. */
const sourceProblem = (draft, found) => {
    if (draft.type !== ROLLUP || !draft.source) return '';
    if (!found) return `rolls up "${draft.source}", which is not a field of this call or of the project`;
    return SOURCE_TYPES.includes(found.type) ? '' : `rolls up "${found.name}", which is not a number field`;
};

/* What the field form refuses a formula for once the company's other formulas are counted: one that closes a circle. */
const formulaMisfit = async (companyId, draft) => {
    if (draft.type !== FORMULA) return '';
    const guard = await require('../CustomField/controller').guardFormulaDefinition(companyId, { fieldType: FORMULA, fieldTitle: draft.name, formulaExpression: draft.expression });
    return guard.valid ? '' : `has a formula that cannot be saved: ${guard.reason}`;
};

const settingsOf = (draft, sourceId = '') => {
    if (draft.type === FORMULA) return { formulaExpression: draft.expression };
    return draft.type === ROLLUP ? { rollupFunction: draft.function, rollupSourceFieldId: sourceId } : {};
};

/* The order to save a call's fields in: a rollup after the field it reads, where that is a field of the same call. */
const saveOrder = (drafts, sameName) => {
    const order = [];
    const visit = (at, trail) => {
        if (order.includes(at) || trail.includes(at)) return;
        const source = drafts[at].source ? drafts.findIndex((other) => sameName(other.name, drafts[at].source)) : -1;
        if (source >= 0) visit(source, [...trail, at]);
        order.push(at);
    };
    drafts.forEach((draft, at) => visit(at, []));
    return order;
};

/* The line the preview card shows for one, all of it the proposal's own text. */
const lineOf = (name, field) => (field.type === FORMULA
    ? { kind: 'computedField', name, type: FORMULA, expression: textOf(field.expression, MAX_EXPRESSION_LENGTH) }
    : { kind: 'computedField', name, type: ROLLUP, function: ROLLUP_FUNCTIONS.includes(field.function) ? field.function : '', source: textOf(field.source, 80) });

const hasComputedField = async (companyId) => Boolean(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.CUSTOM_FIELDS, data: [{ fieldType: { $in: [...COMPUTED_TYPES] }, isDelete: { $ne: false } }, { _id: 1 }],
}, 'findOne'));

/* The web app asks for this after it saves a field value (formulaEngine.js): every formula and rollup of the tasks,
 * and of the tasks above them that `who` can open, is worked out again and stored. The value is already saved by
 * then, so a failure here leaves the last stored number and is logged. */
const recompute = async ({ companyId, who, taskIds }) => {
    try {
        if (!(await hasComputedField(companyId))) return;
        const answer = await require('./setupRequests').answerOf('fieldCompute', { companyId, who, body: { taskIds } });
        if (!answer.body || answer.body.status !== true) logger.error(`computed fields not worked out again: ${(answer.body && answer.body.message) || answer.code}`);
    } catch (error) {
        logger.error(`computed fields not worked out again: ${error.message}`);
    }
};

module.exports = {
    TYPES: COMPUTED_TYPES, FUNCTIONS: ROLLUP_FUNCTIONS, EXPRESSION_MAX: MAX_EXPRESSION_LENGTH, SOURCE_TYPES,
    isComputed, partOf, problemOf, sourceProblem, formulaMisfit, settingsOf, saveOrder, lineOf, recompute,
};
