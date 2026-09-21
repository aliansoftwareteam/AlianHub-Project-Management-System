import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import path from 'path';

const require = createRequire(import.meta.url);
const FRONTEND = path.resolve(__dirname, '../..');

/* The production build compiles messages without eval, because vue.config.js sets __INTLIFY_JIT_COMPILATION__,
 * and that build setting applies whatever CSP_MODE is. The bundle takes vue-i18n.mjs; each case below loads that
 * same file in a fresh production process with the flag as the build sets it, then refuses eval before rendering. */
const SCENARIO = `
const [jit] = process.argv.slice(-1);
globalThis.__INTLIFY_JIT_COMPILATION__ = jit === 'true';
const { createI18n } = await import(${JSON.stringify(require.resolve('vue-i18n/dist/vue-i18n.mjs', { paths: [FRONTEND] }))});
const i18n = createI18n({
    legacy: false, locale: 'en', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false,
    messages: { en: {
        Common: { app: 'AlianHub' },
        Greet: { hello: 'Hello {name}, you have {count} tasks', list: '{0} and {1}' },
        Tasks: { count: 'no tasks | one task | {n} tasks' },
        Home: { title: 'Welcome to @:Common.app', lower: '@.lower:Common.app' },
    } },
});
const Real = globalThis.Function;
globalThis.Function = new Proxy(Real, { construct() { throw new EvalError('eval refused'); }, apply() { throw new EvalError('eval refused'); } });
const out = {};
const run = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = 'ERROR ' + e.message; } };
const t = i18n.global.t;
run('named', () => t('Greet.hello', { name: 'Olivia', count: 3 }));
run('list', () => t('Greet.list', ['one', 'two']));
run('plural0', () => t('Tasks.count', 0));
run('plural1', () => t('Tasks.count', 1));
run('plural7', () => t('Tasks.count', 7));
run('linked', () => t('Home.title'));
run('linkedModifier', () => t('Home.lower'));
run('runtime', () => {
    i18n.global.mergeLocaleMessage('en', { Late: { note: 'Loaded {when}' } });
    i18n.global.setLocaleMessage('fr', { Late: { note: 'Chargé {when}' } });
    const en = t('Late.note', { when: 'now' });
    i18n.global.locale.value = 'fr';
    return en + ' / ' + t('Late.note', { when: 'maintenant' });
});
globalThis.Function = Real;
console.log(JSON.stringify(out));
`;

const render = (jit) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', SCENARIO, '--', String(jit)], {
    cwd: FRONTEND,
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
}).trim().split('\n').pop());

describe('the frontend build', () => {
    it('turns on vue-i18n message interpretation in vue.config.js', () => {
        const config = require('../../vue.config.js');
        let defines = {};
        const chain = {
            plugins: { delete: () => {} },
            plugin: (name) => ({ tap: (fn) => { if (name === 'define') defines = fn([{}])[0]; } }),
        };
        config.chainWebpack(chain);
        expect(defines.__INTLIFY_JIT_COMPILATION__).toBe('true');
    });
});

describe('vue-i18n in production with eval refused', () => {
    it('renders placeholders, plurals, linked messages and a message loaded at runtime when messages are interpreted', () => {
        expect(render(true)).toEqual({
            named: 'Hello Olivia, you have 3 tasks',
            list: 'one and two',
            plural0: 'no tasks',
            plural1: 'one task',
            plural7: '7 tasks',
            linked: 'Welcome to AlianHub',
            linkedModifier: 'alianhub',
            runtime: 'Loaded now / Chargé maintenant',
        });
    });

    it('fails without the build setting, which is what the case above guards', () => {
        expect(render(false).named).toBe('ERROR eval refused');
    });
});
