import { describe, expect, it } from 'vitest';
import { COMPUTED_LINE_KINDS } from '@/components/molecules/IntentPreview/computedLines';

const t = (key, params) => `${key}${params ? `(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : ''}`;
const line = (fields) => COMPUTED_LINE_KINDS.computedField(t, fields);

describe('computed field preview line', () => {
    it('a rollup says which function it works out and from what', () => {
        ['sum', 'avg', 'min', 'max'].forEach((fn) => {
            expect(line({ name: 'Total', type: 'rollup', function: fn, source: 'Hours' })).toEqual({
                label: 'IntentPreview.line_field',
                text: `IntentPreview.field_named(name=Total,type=IntentPreview.rollup_${fn}(source=Hours))`,
            });
        });
    });

    it('a count rollup says what it counts, or just that it counts', () => {
        expect(line({ name: 'N', type: 'rollup', function: 'count', source: 'Subtasks' }).text).toContain('rollup_count_filled(source=Subtasks)');
        expect(line({ name: 'N', type: 'rollup', function: 'count' }).text).toContain('IntentPreview.rollup_count)');
    });

    it('a formula shows its expression, trimmed', () => {
        expect(line({ name: 'Margin', type: 'formula', expression: '  {Price} - {Cost}  ' }).text).toBe('IntentPreview.field_named(name=Margin,type=IntentPreview.formula_worked_out(expression={Price} - {Cost}))');
    });

    it('a function with no words leaves just the name of the field', () => {
        expect(line({ name: 'Odd', type: 'rollup', function: 'median', source: 'Hours' }).text).toBe('Odd');
        expect(line({ name: 'Odd', type: 'rollup', function: 'sum' }).text).toBe('Odd');
        expect(line({ name: 'Odd', type: 'formula', expression: '   ' }).text).toBe('Odd');
    });

    it('a field with no name has no line, whatever else it holds', () => {
        expect(line({ type: 'formula', expression: '1+1' })).toBeNull();
        expect(line({ name: '   ', type: 'rollup', function: 'sum', source: 'x' })).toBeNull();
        expect(line({ name: 7 })).toBeNull();
    });
});
