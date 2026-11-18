import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it } from 'vitest';
import { readRememberedEmail } from '@/utils/rememberedLogin';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('remembered login', () => {
    beforeEach(() => localStorage.clear());

    it('keeps only the email from an entry that also held a password', () => {
        localStorage.setItem('remember', JSON.stringify({ email: 'guest@example.com', password: '80, 97' }));
        expect(readRememberedEmail()).toBe('guest@example.com');
        expect(JSON.parse(localStorage.getItem('remember'))).toEqual({ email: 'guest@example.com' });
    });

    it('removes an entry with no usable email', () => {
        localStorage.setItem('remember', JSON.stringify({ password: '80, 97' }));
        expect(readRememberedEmail()).toBe('');
        expect(localStorage.getItem('remember')).toBeNull();
    });

    it('is cleaned up when the app starts, so signed-in people are covered without visiting the login page', () => {
        const main = fs.readFileSync(path.resolve(here, '../../src/main.js'), 'utf8');
        expect(main).toMatch(/import\s*\{[^}]*readRememberedEmail[^}]*\}\s*from\s*['"]@\/utils\/rememberedLogin['"]/);
        expect(main).toMatch(/^readRememberedEmail\(\)/m);
    });
});
