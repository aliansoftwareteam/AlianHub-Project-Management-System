import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useValidation } from '@/composable/Validation';
import { ValidationFunction as V } from '@/composable/DefaultValidationFunction';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k }) }));

const { checkErrors, checkAllFields } = useValidation();
const input = (value) => ({ target: { value } });
const check = (opts) => checkErrors({ checkLanguage: false, ...opts });

describe('checkErrors', () => {
    let field;
    beforeEach(() => { field = { value: '', error: '' }; });

    it('is valid and leaves the field alone when there are no rules', async () => {
        field.error = 'old';
        await expect(check({ field, name: 'Title', validations: '' })).resolves.toBe(true);
        expect(field.error).toBe('old');
    });

    describe('required', () => {
        it.each(['', null, false])('refuses %j', async (value) => {
            field.value = value;
            await expect(check({ field, name: 'Title', validations: 'required' })).resolves.toBe(false);
            expect(field.error).toBe('The title field is required');
        });
        it('accepts a value and clears an earlier error', async () => {
            field.value = 'x';
            field.error = 'old';
            await expect(check({ field, name: 'Title', validations: 'required' })).resolves.toBe(true);
            expect(field.error).toBe('');
        });
        it('accepts 0', async () => {
            field.value = 0;
            await expect(check({ field, name: 'Qty', validations: 'required' })).resolves.toBe(true);
        });
        it('refuses a blank typed value from an input event', async () => {
            await expect(check({ field, name: 'Title', validations: 'required', event: input('   ') })).resolves.toBe(false);
            expect(field.error).toBe('The title field is required');
        });
        it('accepts a typed value from an input event', async () => {
            await expect(check({ field, name: 'Title', validations: 'required', event: input(' a ') })).resolves.toBe(true);
        });
        it('ignores whitespace around rules', async () => {
            field.value = '';
            await expect(check({ field, name: 'Title', validations: ' required | min:2 ' })).resolves.toBe(false);
        });
        it('uses the translated wording by default', async () => {
            await checkErrors({ field, name: "Task's Name", validations: 'required' });
            expect(field.error).toBe('errorPage.The errorpage.tasks_name generalErrorMessage.fieldIsRequired');
        });
    });

    describe('min / max', () => {
        it('refuses text that is too short', async () => {
            field.value = 'ab';
            await expect(check({ field, name: 'Title', validations: 'min:3' })).resolves.toBe(false);
            expect(field.error).toBe('The title field must be at least 3 characters');
        });
        it('says "digits" for numeric fields', async () => {
            field.value = 12;
            await check({ field, name: 'Pin', validations: 'min:4', type: 'number' });
            expect(field.error).toBe('The pin field must be at least 4 digits');
        });
        it('accepts exactly the minimum', async () => {
            field.value = 'abc';
            await expect(check({ field, name: 'Title', validations: 'min:3' })).resolves.toBe(true);
        });
        it('refuses text that is too long', async () => {
            field.value = 'abcd';
            await expect(check({ field, name: 'Title', validations: 'max:3' })).resolves.toBe(false);
            expect(field.error).toBe('Title must be less than 3 characters');
        });
        it('accepts exactly the maximum', async () => {
            field.value = 'abc';
            await expect(check({ field, name: 'Title', validations: 'max:3' })).resolves.toBe(true);
        });
        it('measures the trimmed text of an input event', async () => {
            await expect(check({ field, name: 'Title', validations: 'min:3', event: input('  ab  ') })).resolves.toBe(false);
            await expect(check({ field, name: 'Title', validations: 'max:3', event: input('  abc  ') })).resolves.toBe(true);
        });
        it('uses the phone message for a short phone number', async () => {
            field.value = '123';
            await checkErrors({ field, name: 'Phone Number', validations: 'min:10' });
            expect(field.error).toBe('companyErrorMessage.phoneNumberValid');
        });
        it('reports required before min', async () => {
            await check({ field, name: 'Title', validations: 'min:3|required' });
            expect(field.error).toBe('The title field is required');
        });
        it('treats an empty optional field as too short', async () => {
            await expect(check({ field, name: 'Title', validations: 'min:3' })).resolves.toBe(false);
        });
    });

    describe('regex', () => {
        it('refuses a value that does not match', async () => {
            field.value = 'abc';
            await expect(check({ field, name: 'Code', validations: 'regex:^[0-9]+$' })).resolves.toBe(false);
            expect(field.error).toBe('The code field must be a valid code');
        });
        it('accepts a matching value', async () => {
            field.value = '123';
            await expect(check({ field, name: 'Code', validations: 'regex:^[0-9]+$' })).resolves.toBe(true);
        });
        it('tests the trimmed input event value', async () => {
            await expect(check({ field, name: 'Code', validations: 'regex:^[0-9]+$', event: input(' 12 ') })).resolves.toBe(true);
            await expect(check({ field, name: 'Code', validations: 'regex:^[0-9]+$', event: input('1a') })).resolves.toBe(false);
        });
        it('skips an empty regex with a warning', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            field.value = 'anything';
            await expect(check({ field, name: 'Code', validations: 'regex:' })).resolves.toBe(true);
            expect(warn).toHaveBeenCalledWith('No regex found!');
            warn.mockRestore();
        });
        it('skips the regex when a required check already failed', async () => {
            await check({ field, name: 'Code', validations: 'required|regex:^[0-9]+$' });
            expect(field.error).toBe('The code field is required');
        });

        describe('translated messages', () => {
            const run = async (name, value, opts = {}) => {
                field.value = value;
                await checkErrors({ field, name, validations: 'regex:^zzz$', ...opts });
                return field.error;
            };
            it('short password', async () => {
                expect(await run('Password', 'abc')).toBe('authErrorMessage.passwordValid');
                expect(await run('New Password', 'abc')).toBe('authErrorMessage.newPasswordValid');
                expect(await run('Current Password', 'abc')).toBe('authErrorMessage.currentPasswordValid');
            });
            it('long password that misses the pattern', async () => {
                expect(await run('Password', 'abcdefghi')).toBe('errorPage.The authErrorMessage.validPassRegex');
                expect(await run('New Password', 'abcdefghi')).toBe('errorPage.The authErrorMessage.newPassword');
                expect(await run('Current Password', 'abcdefghi')).toBe('errorPage.The authErrorMessage.currentPassword');
            });
            it('email, first and last name', async () => {
                expect(await run('email', 'x')).toBe('authErrorMessage.emailError');
                expect(await run('first name', 'x')).toBe('authErrorMessage.validCharactersfirst');
                expect(await run('last name', 'x')).toBe('authErrorMessage.validCharacterslast');
            });
            it('any other field', async () => {
                expect(await run('Zip Code', 'x')).toBe('errorPage.The errorPage.zip_code errorPage.field_must_be_a_valid errorPage.zip_code');
            });
            it('same wording when the value comes from an input event', async () => {
                field.value = 'abc';
                await checkErrors({ field, name: 'Password', validations: 'regex:^zzz$', event: input('abc') });
                expect(field.error).toBe('authErrorMessage.passwordValid');
            });
        });
    });

    describe('confirmation', () => {
        it('refuses a different value', async () => {
            field.value = 'abc';
            await expect(checkErrors({ field, name: 'Confirm', validations: 'confirmation:secret' })).resolves.toBe(false);
            expect(field.error).toBe('authErrorMessage.confirmPasswordValid');
        });
        it('accepts the same value', async () => {
            field.value = 'secret';
            await expect(checkErrors({ field, name: 'Confirm', validations: 'confirmation:secret' })).resolves.toBe(true);
        });
        it('compares the trimmed input event value', async () => {
            await expect(checkErrors({ field, name: 'Confirm', validations: 'confirmation:secret', event: input(' secret ') })).resolves.toBe(true);
            await expect(checkErrors({ field, name: 'Confirm', validations: 'confirmation:secret', event: input('nope') })).resolves.toBe(false);
        });
        it('skips an empty confirmation target with a warning', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await expect(checkErrors({ field, name: 'Confirm', validations: 'confirmation:' })).resolves.toBe(true);
            expect(warn).toHaveBeenCalledWith('No confirmation field found!');
            warn.mockRestore();
        });
    });

    describe('bad input', () => {
        it('rejects when the field is missing its value for a length rule', async () => {
            await expect(check({ field: { value: null }, name: 'Title', validations: 'min:2' })).rejects.toBeInstanceOf(TypeError);
        });
        it('rejects when the validations are not a string', async () => {
            await expect(check({ field, name: 'Title', validations: 5 })).rejects.toBeInstanceOf(TypeError);
        });
        it('rejects an input event without a target', async () => {
            await expect(check({ field, name: 'Title', validations: 'required', event: {} })).rejects.toBeInstanceOf(TypeError);
        });
    });

    describe('rule parsing', () => {
        it('still applies a min rule written after a regex containing "min"', async () => {
            field.value = 'admin';
            await expect(check({ field, name: 'Role', validations: 'regex:^admin$|min:10' })).resolves.toBe(false);
        });
        it('keeps colons inside a regex', async () => {
            field.value = '1:30';
            await expect(check({ field, name: 'Time', validations: 'regex:^[0-9]{2}:[0-9]{2}$' })).resolves.toBe(false);
        });
        it('keeps "|" alternation inside a regex', async () => {
            field.value = 'cat';
            await expect(check({ field, name: 'Pet', validations: 'regex:^(cat|dog)$' })).resolves.toBe(true);
        });
    });
});

describe('checkAllFields', () => {
    it('is valid when every field in an object passes', async () => {
        const form = {
            title: { name: 'Title', value: 'x', rules: 'required', error: '' },
            note: { name: 'Note', value: '', rules: '', error: '' }
        };
        await expect(checkAllFields(form, false)).resolves.toBe(true);
    });

    it('fails and marks every invalid field of an object form', async () => {
        const form = {
            title: { name: 'Title', value: '', rules: 'required', error: '' },
            code: { name: 'Code', value: 'x', rules: 'min:3', error: '' },
            ok: { name: 'Ok', value: 'fine', rules: 'required', error: '' }
        };
        await expect(checkAllFields(form, false)).resolves.toBe(false);
        expect(form.title.error).toBe('The title field is required');
        expect(form.code.error).toBe('The code field must be at least 3 characters');
        expect(form.ok.error).toBe('');
    });

    it('checks array forms using the title, falling back to the label', async () => {
        const form = [
            { title: 'Heading', value: '', rules: 'required' },
            { label: 'Body', value: '', rules: 'required' }
        ];
        await expect(checkAllFields(form, false)).resolves.toBe(false);
        expect(form[0].error).toBe('The heading field is required');
        expect(form[1].error).toBe('The body field is required');
    });

    it('is valid for an empty form', async () => {
        await expect(checkAllFields({}, false)).resolves.toBe(true);
        await expect(checkAllFields([], false)).resolves.toBe(true);
    });

    it('uses translated messages unless told otherwise', async () => {
        const form = { title: { name: 'Title', value: '', rules: 'required', error: '' } };
        await checkAllFields(form);
        expect(form.title.error).toContain('generalErrorMessage.fieldIsRequired');
    });

    it('logs and carries on when one field cannot be checked', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const form = {
            broken: { name: 'Broken', value: null, rules: 'min:2', error: '' },
            title: { name: 'Title', value: '', rules: 'required', error: '' }
        };
        await expect(checkAllFields(form, false)).resolves.toBe(false);
        expect(form.title.error).toBe('The title field is required');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('rejects when the form is missing', async () => {
        await expect(checkAllFields(undefined)).rejects.toBeInstanceOf(TypeError);
    });
});

describe('ValidationFunction key filters', () => {
    const key = (keyCode, extra = {}) => ({ keyCode, which: keyCode, preventDefault: vi.fn(), ...extra });
    const blocked = (fn, ev) => { fn(ev); return ev.preventDefault.mock.calls.length > 0; };
    const code = (ch) => ch.charCodeAt(0);

    it.each([
        ['OnlyNumber', '5', true], ['OnlyNumber', 'a', false], ['OnlyNumber', '.', false],
        ['OnlyPhoneNumber', '7', true], ['OnlyPhoneNumber', '+', false],
        ['OnlyGSTNumber', 'a', true], ['OnlyGSTNumber', '9', true], ['OnlyGSTNumber', '-', false],
        ['OnlyCharacter', 'a', true], ['OnlyCharacter', ' ', true], ['OnlyCharacter', '3', false],
        ['onlyAlphaNumericAllowed', 'Z', true], ['onlyAlphaNumericAllowed', '5', true], ['onlyAlphaNumericAllowed', ' ', false],
        ['onlyFloatWithSpecialChar', '+', true], ['onlyFloatWithSpecialChar', '.', true], ['onlyFloatWithSpecialChar', 'x', false]
    ])('%s with %j lets it through: %s', (fn, ch, allowed) => {
        expect(blocked(V[fn], key(code(ch)))).toBe(!allowed);
    });

    it('milestone number field allows digits and the decimal point only', () => {
        expect(blocked(V.onlyNumberMilestone, key(50))).toBe(false);
        expect(blocked(V.onlyNumberMilestone, key(46))).toBe(false);
        expect(blocked(V.onlyNumberMilestone, key(65))).toBe(true);
        expect(blocked(V.onlyNumberMilestone, { which: 52, preventDefault: vi.fn() })).toBe(false);
    });

    it('whole-number field blocks the decimal point', () => {
        expect(blocked(V.onlyNumberWithoutDecimal, key(50))).toBe(false);
        expect(blocked(V.onlyNumberWithoutDecimal, key(46))).toBe(true);
        expect(blocked(V.onlyNumberWithoutDecimal, key(65))).toBe(true);
        expect(blocked(V.onlyNumberWithoutDecimal, { which: 48, preventDefault: vi.fn() })).toBe(false);
    });

    describe('OnlyFloatNumber', () => {
        const ev = (value, which) => ({ target: { value }, which, preventDefault: vi.fn() });
        it('allows digits', () => {
            expect(blocked(V.OnlyFloatNumber, ev('12', 53))).toBe(false);
        });
        it('allows the first decimal point', () => {
            expect(blocked(V.OnlyFloatNumber, ev('12', 46))).toBe(false);
        });
        it('blocks a second decimal point', () => {
            expect(blocked(V.OnlyFloatNumber, ev('1.2', 46))).toBe(true);
        });
        it('blocks letters', () => {
            expect(blocked(V.OnlyFloatNumber, ev('1', 65))).toBe(true);
        });
        it('clears the box and blocks when it would start with a point', () => {
            const e = ev('.5', 53);
            expect(blocked(V.OnlyFloatNumber, e)).toBe(true);
            expect(e.target.value).toBe('');
        });
    });
});

describe('ValidationFunction format rules', () => {
    const rule = (fn) => { const cb = vi.fn(); fn('x', cb); return cb.mock.calls[0][0]; };

    it('PAN: five letters, four digits, one letter', () => {
        const { rgx, minLength } = rule(V.OnlyPANnumber);
        expect(minLength).toBe(10);
        expect(rgx.test('ABCDE1234F')).toBe(true);
        expect(rgx.test('ABCD12345F')).toBe(false);
        expect(rgx.test('abcde1234f')).toBe(true);
    });
    it('TAN: four letters, five digits, one letter', () => {
        const { rgx, minLength } = rule(V.isValidTANNumber);
        expect(minLength).toBe(10);
        expect(rgx.test('ABCD12345E')).toBe(true);
        expect(rgx.test('ABCDE1234F')).toBe(false);
    });
    it('GST: 15 characters ending in Z and a check character', () => {
        const { rgx, minLength } = rule(V.isValidGSTNumber);
        expect(minLength).toBe(15);
        expect(rgx.test('22ABCDE1234F1Z5')).toBe(true);
        expect(rgx.test('22ABCDE1234F1X5')).toBe(false);
    });
    it('CIN: 21 characters in the registered layout', () => {
        const { rgx, minLength } = rule(V.isValidCINNumber);
        expect(minLength).toBe(21);
        expect(rgx.test('L12345MH2000PLC123456')).toBe(true);
        expect(rgx.test('12345MH2000PLC123456')).toBe(false);
    });

    describe('isValueExistInArray', () => {
        const ask = (arr, value) => { const cb = vi.fn(); V.isValueExistInArray(arr, value, cb); return cb.mock.calls[0][0]; };
        it('ignores case', () => {
            expect(ask(['Alpha'], 'ALPHA')).toBe(true);
        });
        it('treats a space and an underscore as the same', () => {
            expect(ask(['to do'], 'To_Do')).toBe(true);
            expect(ask(['to_do'], 'To Do')).toBe(true);
        });
        it('reports a value that is not in the list', () => {
            expect(ask(['a', 'b'], 'c')).toBe(false);
            expect(ask([], 'c')).toBe(false);
        });
        it('treats every space like an underscore', () => {
            expect(ask(['in the works'], 'in_the_works')).toBe(true);
        });
    });

    describe('getCommaSeperatedNumber', () => {
        it.each([
            [1234567.891, '1,234,567.89'],
            [5, '5.00'],
            ['2500', '2,500.00'],
            [0, '0.00'],
            [-1500.5, '-1,500.50']
        ])('formats %j as %s', (n, out) => {
            expect(V.getCommaSeperatedNumber(n)).toBe(out);
        });
        it('shows NaN for non-numbers', () => {
            expect(V.getCommaSeperatedNumber('abc')).toBe('NaN');
        });
        it('treats empty and null as zero', () => {
            expect(V.getCommaSeperatedNumber('')).toBe('0.00');
            expect(V.getCommaSeperatedNumber(null)).toBe('0.00');
        });
    });
});
