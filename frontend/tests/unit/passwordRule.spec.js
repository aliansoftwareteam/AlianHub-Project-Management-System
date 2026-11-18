import { describe, expect, it } from 'vitest';
import passwords from '../../../tests/fixtures/passwordSamples.json';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, meetsPasswordRule } from '@passwordRule';

describe('the password rule the forms share with the server', () => {
    it.each(passwords.weak)('refuses %j', (password) => {
        expect(meetsPasswordRule(password)).toBe(false);
    });

    it.each(passwords.strong)('accepts %j', (password) => {
        expect(meetsPasswordRule(password)).toBe(true);
    });

    it('asks for the same lengths the hint names', () => {
        expect(MIN_PASSWORD_LENGTH).toBe(8);
        expect(MAX_PASSWORD_LENGTH).toBe(256);
    });

    it('takes up to 256 characters and refuses a 257th, as the server does', () => {
        const longest = `Aa1!${'x'.repeat(252)}`;
        expect(meetsPasswordRule(longest)).toBe(true);
        expect(meetsPasswordRule(`${longest}x`)).toBe(false);
    });
});
