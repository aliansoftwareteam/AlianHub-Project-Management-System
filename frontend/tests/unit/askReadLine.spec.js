import { describe, expect, test } from 'vitest';
import { readLineKey } from '@/views/Ai/backlogRead';
import en from '@/locales/en.js';

describe('Ask landing read line', () => {
    test('lists the kinds of work after the count when there are any', () => {
        expect(readLineKey({ capped: false, hasParts: true })).toBe('AiLanding.read_line');
        expect(readLineKey({ capped: true, hasParts: true })).toBe('AiLanding.read_line_capped');
    });

    test('stops at the count when every task is unshaped, instead of a dash and a lone full stop', () => {
        expect(readLineKey({ capped: false, hasParts: false })).toBe('AiLanding.read_line_plain');
        expect(readLineKey({ capped: true, hasParts: false })).toBe('AiLanding.read_line_capped_plain');
        expect(en.AiLanding.read_line_plain).not.toMatch(/\{parts\}|—/);
        expect(en.AiLanding.read_line_capped_plain).not.toMatch(/\{parts\}|—/);
    });
});
