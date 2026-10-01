import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
const templateOf = (vue) => vue.slice(vue.indexOf('<template>'), vue.lastIndexOf('</template>'));
const declarations = (css) => [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).join('\n');
const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i;

const tokens = withoutComments(read('assets/css/tokens.css'));
const optOut = /:root\[data-theme="dark"\] \.ah-app__view,[^{]*\{[^}]*color-scheme:\s*light/.exec(tokens);

describe('the dark-mode opt-out list after the shared containers moved onto tokens', () => {
    test('no longer names the menu, the modal, the image slider or the alert', () => {
        expect(optOut).not.toBeNull();
        for (const name of ['#my-dropdown', '#my-modal', '#my-image-slider', '.swal2-container']) expect(optOut[0]).not.toContain(name);
    });

    test('still names what is converted last: the legacy view and white cards', () => {
        for (const name of ['.ah-app__view', '.bg-white', 'iframe']) expect(optOut[0]).toContain(name);
    });
});

describe('the image slider', () => {
    const css = withoutComments(read('components/organisms/ImagePreviewer/style.css'));

    test('is a dark surface in both themes, drawn from the rail tokens', () => {
        expect(declarations(css)).not.toMatch(COLOUR_LITERAL);
        expect(declarations(css)).not.toMatch(/:\s*red\b/);
        expect(ruleBody(css, '.slider_controller')).toMatch(/background-color:\s*var\(--rail\)/);
        expect(ruleBody(css, '.slider_controller')).toMatch(/color-scheme:\s*dark/);
    });
});

describe('alerts', () => {
    const css = withoutComments(read('assets/css/alerts.css'));

    test('the alert stylesheet is loaded with the app styles', () => {
        expect(read('main.js')).toMatch(/import "@\/assets\/css\/alerts\.css";/);
    });

    test('every rule is scoped to the alert container, so it wins over the library whatever the load order', () => {
        const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].flatMap((m) => m[2].split(',')).map((s) => s.trim()).filter(Boolean);
        expect(selectors.length).toBeGreaterThan(10);
        for (const selector of selectors) expect(selector).toMatch(/^(body\.swal2-no-backdrop )?\.swal2-container\b/);
        expect(declarations(css)).not.toMatch(COLOUR_LITERAL);
    });

    test('popup, title, text, input, buttons and backdrop take tokens', () => {
        expect(ruleBody(css, '.swal2-container')).toMatch(/color-scheme:\s*var\(--scheme\)/);
        expect(ruleBody(css, '.swal2-container.swal2-backdrop-show, .swal2-container.swal2-noanimation')).toMatch(/background:\s*var\(--scrim\)/);
        expect(ruleBody(css, '.swal2-container .swal2-popup')).toMatch(/background:\s*var\(--surface\);\s*color:\s*var\(--ink-2\)/);
        expect(ruleBody(css, '.swal2-container .swal2-title')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.swal2-container .swal2-input, .swal2-container .swal2-textarea, .swal2-container .swal2-select')).toMatch(/background:\s*var\(--surface\);\s*color:\s*var\(--ink\);\s*border:\s*1px solid var\(--border\)/);
        expect(ruleBody(css, '.swal2-container .swal2-styled.swal2-confirm')).toMatch(/background-color:\s*var\(--brand\);\s*color:\s*var\(--on-brand\)/);
        expect(ruleBody(css, '.swal2-container .swal2-styled.swal2-cancel')).toMatch(/background-color:\s*var\(--surface\);\s*color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.swal2-container .swal2-styled.swal2-deny')).toMatch(/background-color:\s*var\(--danger\);\s*color:\s*var\(--on-danger\)/);
    });
});

describe('the modal', () => {
    const css = withoutComments(read('components/atom/Modal/style.css'));
    const template = templateOf(read('components/atom/Modal/Modal.vue'));

    test('surface, head, footer, backdrop and close button take tokens', () => {
        expect(declarations(css)).not.toMatch(COLOUR_LITERAL);
        expect(declarations(css)).not.toMatch(/:\s*white\b/);
        expect(ruleBody(css, '.modal-overlay')).toMatch(/background-color:\s*var\(--scrim\)/);
        expect(ruleBody(css, '.modal')).toMatch(/background-color:\s*var\(--surface\)\s*!important/);
        expect(ruleBody(css, '.modal')).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.modal')).toMatch(/color-scheme:\s*var\(--scheme\)/);
        expect(ruleBody(css, '.modal-header')).toMatch(/border-bottom:\s*1px solid var\(--hairline\)/);
        expect(ruleBody(css, '.modal-footer')).toMatch(/border-top:\s*1px solid var\(--hairline\)/);
    });

    test('its own buttons are the shared buttons and the close icon is a mask', () => {
        expect(template).toMatch(/class="ah-btn ah-btn--secondary ah-btn--sm"/);
        expect(template).toMatch(/class="ah-btn ah-btn--primary ah-btn--sm ml-10px"/);
        expect(template).toMatch(/class="ah-mask-icon cancel__icon-img"/);
        expect(template).not.toMatch(/outline-secondary|btn-primary/);
    });
});

describe('the dropdown panel', () => {
    const vue = read('components/molecules/DropDown/DropDown.vue');
    const css = withoutComments(read('components/molecules/DropDown/style.css'));

    test('is themed unless the host opts out', () => {
        expect(vue).toMatch(/themed:\s*\{\s*type:\s*Boolean,\s*default:\s*true\s*\}/);
        expect(read('components/molecules/DropDown/CustomDropDown.vue')).toMatch(/themed:\s*\{\s*type:\s*Boolean,\s*default:\s*true\s*\}/);
    });

    test('a host left white keeps light native controls', () => {
        expect(css).toMatch(/:root\[data-theme="dark"\] \.drop-down-menu:not\(\.dd-tokens\) \{ color-scheme: light; \}/);
    });

    test('menus and dialogs restate the legacy colour utilities their hosts still carry', () => {
        const layer = withoutComments(read('assets/css/legacy-on-tokens.css'));
        expect(read('assets/css/index.css')).toMatch(/@import 'legacy-on-tokens\.css';/);
        expect(layer).toContain(':is(.dd-tokens, .modal, .sb-tokens) :is(.black, .dark-gray, .dark-gray2, .gray4b, .color52, .color63, .darkblue) { color: var(--ink); }');
        expect(layer).toContain(':is(.dd-tokens, .modal, .sb-tokens) :is(.gray81, .gray, .gray63, .GunPowder, .color94, .colorlightgray) { color: var(--ink-2); }');
        expect(layer).toContain(':is(.dd-tokens, .modal, .sb-tokens) :is(.blue, .purple) { color: var(--brand) !important; }');
        expect(layer).toContain(':is(.dd-tokens, .modal, .sb-tokens) .red { color: var(--danger-ink); }');
        expect(layer).toContain(':is(.dd-tokens, .modal, .sb-tokens) .bg-white { background-color: var(--surface); }');
        expect(declarations(layer)).not.toMatch(COLOUR_LITERAL);
    });

    test('colours the option component and known hosts set inside the panel are restated on tokens', () => {
        expect(css).toContain('.dd-tokens :is(.dropDelete, .mobile-deleteIcon, .mobile-delete-status) { color: var(--danger-ink) !important; }');
        expect(css).toContain('.dd-tokens :is(.mainDiv, .option):hover { background: var(--surface-hover); }');
        expect(css).toContain('.dropdown-back-drop { background-color: var(--scrim);}');
        expect(css).toContain('.dd-tokens .drop-down-item { background: var(--fill) !important; color: var(--ink) !important; }');
    });

    test('the hosts left white are exactly the listed ones', () => {
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.vue') ? [path.join(dir, d.name)] : []));
        const optOuts = [];
        for (const file of walk(SRC)) {
            const text = fs.readFileSync(file, 'utf8');
            for (const tag of text.match(/<(?:Custom)?DropDown\b[^>]*>/g) || []) {
                if (/:themed="false"/.test(tag)) optOuts.push(path.relative(SRC, file));
            }
        }
        expect([...new Set(optOuts)].sort()).toEqual(DROPDOWN_OPT_OUTS);
    });
});

/* Hosts whose menu still draws fixed colours or dark icon files; each is listed in the PR. */
const DROPDOWN_OPT_OUTS = [];
