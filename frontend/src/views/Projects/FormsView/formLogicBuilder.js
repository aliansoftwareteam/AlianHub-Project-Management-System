import { checkRule, kindOf, VALUELESS } from '@formLogic';

const STALE_CODES = ['question_missing', 'question_later', 'option_missing'];

export const isGroup = (item) => Boolean(item) && (Array.isArray(item.all) || Array.isArray(item.any));
export const modeOf = (rule) => (rule && Array.isArray(rule.any) ? 'any' : 'all');
export const rowsOf = (rule) => (rule && rule[modeOf(rule)]) || [];
export const conditionCount = (rule) => rowsOf(rule).reduce((count, row) => count + (isGroup(row) ? conditionCount(row) : 1), 0);

/* A task field question takes its type and choices from the field it fills, and
 * the server only writes them onto the question when the form is saved. */
export const withSources = (questions, taskFields = []) => questions.map((q) => {
    const field = q.mapTo ? taskFields.find((entry) => entry.key === q.mapTo) : null;
    if (!field) return q;
    const options = Array.isArray(field.values) ? field.values.map((value) => ({ id: value, label: value })) : (q.options || []);
    return { ...q, type: field.type, options };
});

export const isUnfinished = (row) => {
    if (isGroup(row)) return false;
    if (!row.question || !row.op) return true;
    if (VALUELESS.includes(row.op)) return false;
    const { value } = row;
    if (Array.isArray(value)) return !value.length;
    return value === undefined || value === null || String(value).trim() === '';
};

const finished = (rule) => {
    const rows = rowsOf(rule)
        .filter((row) => !isUnfinished(row))
        .map((row) => {
            if (isGroup(row)) return row;
            return VALUELESS.includes(row.op) ? { question: row.question, op: row.op } : { question: row.question, op: row.op, value: row.value };
        });
    return rows.length ? { [modeOf(rule)]: rows } : undefined;
};

/* What Save does with the rule on the question at `index`: `rule` is what is
 * sent, `stale` says it is being dropped because what it names is gone. */
export const ruleState = (question, index, sources) => {
    const draft = question.showWhen;
    const rule = finished(draft);
    const unfinished = rowsOf(draft).some(isUnfinished);
    if (!rule) return { rule: undefined, stale: false, unfinished };
    const checked = checkRule(rule, sources, index);
    if (checked.ok) return { rule: checked.rule || undefined, stale: false, unfinished };
    const stale = STALE_CODES.includes(checked.code);
    return { rule: undefined, stale, unfinished: unfinished || !stale };
};

const WORDING = {
    date: { greater_than: 'after', less_than: 'before' },
    multi: { contains: 'includes', one_of: 'any_of' },
};
export const wordingOf = (type, op) => (WORDING[kindOf(type)] || {})[op] || op;

const optionLabel = (source, id, t) => {
    const option = ((source && source.options) || []).find((entry) => String(entry.id) === String(id));
    return option ? option.label : t('Projects.form_logic_missing_option');
};

const valueText = (source, value, t) => {
    if (Array.isArray(value)) return value.map((id) => optionLabel(source, id, t)).join(t('Projects.form_logic_list_join'));
    return ['choice', 'multi'].includes(kindOf(source && source.type)) ? optionLabel(source, value, t) : String(value);
};

export const describeGroup = (group, sources, t) => rowsOf(group).map((row) => {
    if (isGroup(row)) return t('Projects.form_logic_group', { conditions: describeGroup(row, sources, t) });
    const source = sources.find((q) => q.id === row.question);
    return t(`Projects.form_logic_says_${wordingOf(source && source.type, row.op)}`, {
        question: source ? source.label : t('Projects.form_logic_missing_question'),
        value: VALUELESS.includes(row.op) ? '' : valueText(source, row.value, t),
    });
}).join(` ${t(`Projects.form_logic_${modeOf(group) === 'any' ? 'or' : 'and'}`)} `);

export const summarize = (rule, sources, t) => t('Projects.form_logic_summary', { conditions: describeGroup(rule, sources, t) });
