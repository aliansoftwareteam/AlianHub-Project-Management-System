import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

describe('auth card on a phone', () => {
    const css = read('components/templates/AuthShell/style.css');

    test('the single card counts its padding in its width and keeps a gutter', () => {
        const rule = ruleBody(css, '.auth--single .auth__form');
        expect(rule).toMatch(/box-sizing:\s*border-box/);
        expect(rule).toMatch(/width:\s*calc\(100% - 32px\)/);
    });

    test('full-width link buttons fit inside the card', () => {
        expect(ruleBody(css, '.auth .ah-btn--block')).toMatch(/box-sizing:\s*border-box/);
    });
});

describe('provider buttons', () => {
    const vueFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return vueFiles(full);
        return entry.name.endsWith('.vue') ? [full] : [];
    });

    test('every component that draws a ShellIcon imports it, so no icon renders as an unknown tag', () => {
        const missing = vueFiles(SRC)
            .filter((file) => {
                const source = fs.readFileSync(file, 'utf8');
                return /<ShellIcon\b/.test(source) && !/import ShellIcon\b/.test(source);
            })
            .map((file) => path.relative(SRC, file));
        expect(missing).toEqual([]);
    });
});

describe('signed-out screens', () => {
    const screens = [
        'views/Authentication/Login/Login.vue',
        'views/Authentication/Invitation/Invitation.vue',
        'views/Authentication/ResetPassword/NewPasswordCard.vue',
        'views/Setup/SetupWizard.vue',
    ];

    test.each(screens)('%s has no English literal in a bound aria-label', (rel) => {
        expect(read(rel)).not.toMatch(/:aria-label="[^"]*'[A-Z][a-z]+ [a-z]/);
    });
});

describe('login proof panel', () => {
    test('the product shot takes the theme surface, so its dark-mode text stays readable', () => {
        const rule = ruleBody(read('components/templates/AuthShell/style.css'), '.auth__shot');
        expect(rule).toMatch(/background:\s*var\(--surface\)/);
        expect(rule).not.toMatch(/#fff\b/);
    });
});
