const { MIN_PASSWORD_LENGTH, PASSWORD_PATTERN, PASSWORD_RULE_MESSAGE, meetsPasswordRule } = require('../Modules/Auth/helpers/passwordRule');
const passwords = require('./fixtures/passwordSamples.json');

describe('the rule for a password a person chooses', () => {
    it.each(passwords.weak)('refuses %j', (password) => {
        expect(meetsPasswordRule(password)).toBe(false);
    });

    it.each(passwords.strong)('accepts %j', (password) => {
        expect(meetsPasswordRule(password)).toBe(true);
    });

    it.each([undefined, null, 123456789, { $ne: null }, ['Abcdefg1!']])('refuses a value that is not a string: %j', (value) => {
        expect(meetsPasswordRule(value)).toBe(false);
    });

    it('counts any character other than a letter, a digit or a space as the symbol', () => {
        ['.', '_', '~', '"', '/', '€'].forEach((symbol) => expect(meetsPasswordRule(`Abcdefg1${symbol}`)).toBe(true));
    });

    it('gives the change-password form a pattern it can carry in its rule string', () => {
        expect(PASSWORD_PATTERN.source).not.toMatch(/[|:]/);
        [...passwords.weak, ...passwords.strong].forEach((password) => {
            expect(new RegExp(PASSWORD_PATTERN.source).test(password)).toBe(meetsPasswordRule(password));
        });
    });

    it('names the length and all four requirements in the message the server answers with', () => {
        expect(MIN_PASSWORD_LENGTH).toBe(8);
        expect(PASSWORD_RULE_MESSAGE).toMatch(/8 characters.*uppercase letter.*lowercase letter.*number.*symbol/);
    });
});
