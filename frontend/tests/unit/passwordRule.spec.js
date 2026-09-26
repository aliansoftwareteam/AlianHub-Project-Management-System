import { describe, expect, it } from 'vitest';
import passwords from '../../../tests/fixtures/passwordSamples.json';
import { MIN_PASSWORD_LENGTH, meetsPasswordRule } from '@passwordRule';

describe('the password rule the forms share with the server', () => {
    it.each(passwords.weak)('refuses %j', (password) => {
        expect(meetsPasswordRule(password)).toBe(false);
    });

    it.each(passwords.strong)('accepts %j', (password) => {
        expect(meetsPasswordRule(password)).toBe(true);
    });

    it('asks for the same length the hint names', () => {
        expect(MIN_PASSWORD_LENGTH).toBe(8);
    });
});
