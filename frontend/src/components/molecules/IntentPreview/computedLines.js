// The line of a rollup or a formula field an agent asks for (Modules/Agents/computedFields.js): what it works out,
// in words, after the field's name. A function with no words here leaves the name alone.

const FUNCTIONS = Object.freeze(['sum', 'avg', 'min', 'max']);
const COUNT = 'count';

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

const rollupText = (t, line) => {
    const source = textOf(line.source);
    if (line.function === COUNT) return source ? t('IntentPreview.rollup_count_filled', { source }) : t('IntentPreview.rollup_count');
    return source && FUNCTIONS.includes(line.function) ? t(`IntentPreview.rollup_${line.function}`, { source }) : '';
};

const formulaText = (t, line) => (textOf(line.expression) ? t('IntentPreview.formula_worked_out', { expression: textOf(line.expression) }) : '');

export const COMPUTED_LINE_KINDS = {
    computedField: (t, line) => {
        const name = textOf(line.name);
        if (!name) return null;
        const works = line.type === 'formula' ? formulaText(t, line) : rollupText(t, line);
        return { label: t('IntentPreview.line_field'), text: works ? t('IntentPreview.field_named', { name, type: works }) : name };
    },
};
