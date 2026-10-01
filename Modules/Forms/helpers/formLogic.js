/* Which questions a form shows for a set of answers. Nothing required, so the builder shares it.
 *
 * A rule is data: { all | any: [condition | group] }, a condition being
 * { question, op, value }. It names only questions above its own, so there is
 * nothing to cycle through and one pass down the form decides everything. */

const OPERATORS = Object.freeze(['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty', 'greater_than', 'less_than', 'one_of']);
const VALUELESS = Object.freeze(['is_empty', 'is_not_empty']);
const GROUP_KEYS = Object.freeze(['all', 'any']);
const CONDITION_KEYS = Object.freeze(['question', 'op', 'value']);

const MAX_CONDITIONS = 10;
const MAX_DEPTH = 2;
const MAX_TEXT_VALUE = 200;

/* A type left out has no answer a rule could read: a file is not in the posted
 * answers, and an information block asks nothing. */
const KIND_BY_TYPE = Object.freeze({
    short_text: 'text',
    long_text: 'text',
    email: 'text',
    website: 'text',
    phone: 'text',
    location: 'text',
    number: 'number',
    money: 'number',
    progress: 'number',
    rating: 'number',
    date: 'date',
    dropdown: 'choice',
    checkbox: 'choice',
    voting: 'choice',
    labels: 'multi',
});

const ORDERED = Object.freeze(['equals', 'not_equals', 'greater_than', 'less_than', 'is_empty', 'is_not_empty']);
const OPERATORS_BY_KIND = Object.freeze({
    text: Object.freeze(['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty']),
    number: ORDERED,
    date: ORDERED,
    choice: Object.freeze(['equals', 'not_equals', 'one_of', 'is_empty', 'is_not_empty']),
    multi: Object.freeze(['contains', 'one_of', 'is_empty', 'is_not_empty']),
});

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isQuestion = (q) => isPlainObject(q) && typeof q.id === 'string' && q.id !== '';

const kindOf = (type) => (has(KIND_BY_TYPE, String(type)) ? KIND_BY_TYPE[String(type)] : '');
const operatorsFor = (type) => OPERATORS_BY_KIND[kindOf(type)] || [];

const optionsOf = (question) => (Array.isArray(question.options) ? question.options.filter(isPlainObject) : []);
const hasOption = (question, id) => optionsOf(question).some((o) => String(o.id) === id);

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const dayOf = (text) => {
    const parts = DAY.exec(text);
    if (!parts) return '';
    const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? parts[0] : '';
};

const refuse = (code) => ({ ok: false, code });

const checkValue = (source, op, value) => {
    const kind = kindOf(source.type);
    if (op === 'one_of') {
        if (!Array.isArray(value) || !value.length || value.some((id) => typeof id !== 'string')) return refuse('value');
        if (value.some((id) => !hasOption(source, id))) return refuse('option_missing');
        return { ok: true, value: [...new Set(value)] };
    }
    if (kind === 'choice' || kind === 'multi') {
        if (typeof value !== 'string' || !value) return refuse('value');
        return hasOption(source, value) ? { ok: true, value } : refuse('option_missing');
    }
    if (kind === 'number') {
        return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : refuse('value');
    }
    if (typeof value !== 'string') return refuse('value');
    if (kind === 'date') {
        return value.length === 10 && dayOf(value) === value ? { ok: true, value } : refuse('value');
    }
    const text = value.trim();
    return text && text.length <= MAX_TEXT_VALUE ? { ok: true, value: text } : refuse('value');
};

const checkCondition = (condition, questions, index) => {
    if (Object.keys(condition).some((key) => !CONDITION_KEYS.includes(key))) return refuse('shape');
    if (typeof condition.question !== 'string' || typeof condition.op !== 'string') return refuse('shape');

    const at = questions.findIndex((q) => isQuestion(q) && q.id === condition.question);
    if (at === -1) return refuse('question_missing');
    if (at >= index) return refuse('question_later');
    const source = questions[at];
    if (source.hidden === true || !kindOf(source.type)) return refuse('question_missing');

    if (!OPERATORS.includes(condition.op) || !operatorsFor(source.type).includes(condition.op)) return refuse('operator');
    if (VALUELESS.includes(condition.op)) {
        return has(condition, 'value') ? refuse('value') : { ok: true, condition: { question: source.id, op: condition.op } };
    }
    const checked = checkValue(source, condition.op, condition.value);
    return checked.ok ? { ok: true, condition: { question: source.id, op: condition.op, value: checked.value } } : checked;
};

const checkGroup = (group, questions, index, depth, tally) => {
    const keys = isPlainObject(group) ? Object.keys(group) : [];
    if (keys.length !== 1 || !GROUP_KEYS.includes(keys[0]) || !Array.isArray(group[keys[0]])) return refuse('shape');
    if (depth > MAX_DEPTH) return refuse('too_deep');

    const items = [];
    for (const item of group[keys[0]]) {
        if (!isPlainObject(item)) return refuse('shape');
        const nested = GROUP_KEYS.some((key) => has(item, key));
        if (!nested) {
            tally.conditions += 1;
            if (tally.conditions > MAX_CONDITIONS) return refuse('too_many');
        }
        const checked = nested
            ? checkGroup(item, questions, index, depth + 1, tally)
            : checkCondition(item, questions, index);
        if (!checked.ok) return checked;
        items.push(nested ? checked.rule : checked.condition);
    }
    if (!items.length && depth > 1) return refuse('shape');
    return { ok: true, rule: { [keys[0]]: items } };
};

/**
 * Whether `rule` may sit on the question at `index` of `questions`.
 *
 * Answers { ok: true, rule } with the rule rebuilt from the keys this file reads
 * (null when there is nothing to check), or { ok: false, code } where code is one
 * of shape, too_deep, too_many, question_missing, question_later, operator,
 * value, option_missing.
 */
const checkRule = (rule, questions, index) => {
    if (rule === undefined || rule === null) return { ok: true, rule: null };
    const checked = checkGroup(rule, Array.isArray(questions) ? questions : [], index, 1, { conditions: 0 });
    if (!checked.ok) return checked;
    return { ok: true, rule: Object.values(checked.rule)[0].length ? checked.rule : null };
};

const firstText = (raw) => {
    const one = Array.isArray(raw) ? raw[0] : raw;
    return one === undefined || one === null ? '' : String(one).trim();
};

const optionIdFor = (question, label) => {
    const hit = label ? optionsOf(question).find((o) => String(o.label) === label) : null;
    return hit ? String(hit.id) : '';
};

/* An answer as its rule compares it. One the question could not have produced
 * (text in a number box, a choice it does not offer) reads as no answer. */
const answerOf = (question, raw) => {
    switch (kindOf(question.type)) {
        case 'number': {
            const text = firstText(raw).replace(/,/g, '');
            const number = text ? Number(text) : NaN;
            return Number.isFinite(number) ? number : null;
        }
        case 'date':
            return dayOf(firstText(raw));
        case 'choice':
            return optionIdFor(question, firstText(raw));
        case 'multi':
            return (Array.isArray(raw) ? raw : [raw]).map((one) => optionIdFor(question, firstText(one))).filter(Boolean);
        default:
            return firstText(raw).toLowerCase();
    }
};

const NO_ANSWER = Object.freeze({ number: null, multi: Object.freeze([]) });
const isEmpty = (answer) => answer === null || answer === '' || (Array.isArray(answer) && !answer.length);

const conditionHolds = ({ op, value }, kind, answer) => {
    const empty = isEmpty(answer);
    switch (op) {
        case 'is_empty': return empty;
        case 'is_not_empty': return !empty;
        case 'equals': return answer === (kind === 'text' ? value.toLowerCase() : value);
        case 'not_equals': return answer !== (kind === 'text' ? value.toLowerCase() : value);
        case 'greater_than': return !empty && answer > value;
        case 'less_than': return !empty && answer < value;
        case 'contains': return kind === 'multi' ? answer.includes(value) : answer.includes(value.toLowerCase());
        default: return kind === 'multi' ? value.some((id) => answer.includes(id)) : value.includes(answer);
    }
};

const groupHolds = (group, kinds, given) => {
    const [mode] = Object.keys(group);
    const test = (item) => {
        if (!has(item, 'question')) return groupHolds(item, kinds, given);
        const kind = kinds.get(item.question);
        const answer = given.has(item.question) ? given.get(item.question) : (has(NO_ANSWER, kind) ? NO_ANSWER[kind] : '');
        return conditionHolds(item, kind, answer);
    };
    return mode === 'all' ? group[mode].every(test) : group[mode].some(test);
};

/**
 * The questions shown for `answers`, in form order.
 *
 * `answers` is keyed by question id and holds what a browser posts: text, or a
 * list of texts, with a choice given by its label. A question the form hides is
 * never shown, and a question that is not shown counts as unanswered for the
 * rules below it. A stored rule that checkRule refuses shows its question:
 * asking one question too many loses nothing, and hiding one could lose an answer.
 */
const shownQuestions = (questions, answers) => {
    const list = Array.isArray(questions) ? questions : [];
    const posted = isPlainObject(answers) ? answers : {};
    const kinds = new Map();
    const given = new Map();

    return list.filter((question, index) => {
        if (!isPlainObject(question)) return false;
        const named = isQuestion(question);
        if (named && !kinds.has(question.id)) kinds.set(question.id, kindOf(question.type));
        if (question.hidden === true) return false;

        let visible = true;
        try {
            const checked = checkRule(question.showWhen, list, index);
            visible = !checked.ok || !checked.rule || groupHolds(checked.rule, kinds, given);
        } catch (error) {
            visible = true;
        }
        if (visible && named && !given.has(question.id)) {
            given.set(question.id, answerOf(question, has(posted, question.id) ? posted[question.id] : undefined));
        }
        return visible;
    });
};

const visibleIds = (questions, answers) => shownQuestions(questions, answers).filter(isQuestion).map((q) => q.id);

const pruneAnswers = (questions, answers) => {
    const posted = isPlainObject(answers) ? answers : {};
    const kept = {};
    for (const id of visibleIds(questions, posted)) {
        // Not an assignment: a question may be called __proto__.
        if (has(posted, id)) Object.defineProperty(kept, id, { value: posted[id], enumerable: true, writable: true, configurable: true });
    }
    return kept;
};

const hasRules = (questions) => (Array.isArray(questions) ? questions : [])
    .some((q) => isQuestion(q) && q.showWhen !== undefined && q.showWhen !== null);

module.exports = {
    OPERATORS,
    VALUELESS,
    MAX_CONDITIONS,
    MAX_DEPTH,
    MAX_TEXT_VALUE,
    kindOf,
    operatorsFor,
    checkRule,
    shownQuestions,
    visibleIds,
    pruneAnswers,
    hasRules,
};
