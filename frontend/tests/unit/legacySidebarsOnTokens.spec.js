import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/&#\d+;/g, '');
const templateOf = (vue) => vue.slice(vue.indexOf('<template>'), vue.lastIndexOf('</template>'));
const stylesOf = (rel) => {
    const text = read(rel);
    if (rel.endsWith('.css')) return withoutComments(text);
    return withoutComments([...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'));
};
const declarations = (css) => [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).join('\n');
const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.vue') ? [path.join(dir, d.name)] : []));
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i;

/* Hosts whose contents still paint fixed colours on a white panel; each is listed in the PR. */
const SIDEBAR_OPT_OUTS = [];

describe('the sidebar panel', () => {
    const vue = read('components/molecules/Sidebar/Sidebar.vue');
    const css = stylesOf('components/molecules/Sidebar/style.css');

    test('is themed unless the host opts out', () => {
        expect(vue).toMatch(/themed:\s*\{\s*type:\s*Boolean,\s*default:\s*true\s*\}/);
        expect(read('components/molecules/SidebarItems/SidebarItems.vue')).toMatch(/themed:\s*\{\s*type:\s*Boolean,\s*default:\s*true\s*\}/);
    });

    test('a host left white keeps light native controls, and the backdrop is the scrim', () => {
        expect(css).toMatch(/:root\[data-theme="dark"\] \.sidebar-content:not\(\.sb-tokens\) \{ color-scheme: light; \}/);
        expect(ruleBody(css, '.back-drop')).toMatch(/background-color:\s*var\(--scrim\)/);
    });

    test('the hosts left white are exactly the listed ones', () => {
        const optOuts = [];
        for (const file of walk(SRC)) {
            const text = fs.readFileSync(file, 'utf8');
            if (!/Sidebar\/Sidebar(\.vue)?['"]/.test(text)) continue;
            if (/<Sidebar\b[^>]*:themed="false"/.test(text)) optOuts.push(path.relative(SRC, file));
        }
        expect(optOuts.sort()).toEqual(SIDEBAR_OPT_OUTS);
    });
});

describe('the dark-mode opt-out list after the sidebar moved onto tokens', () => {
    const tokens = withoutComments(read('assets/css/tokens.css'));
    const optOut = /:root\[data-theme="dark"\] \.ah-app__view,[^{]*\{[^}]*color-scheme:\s*light/.exec(tokens);

    test('no longer names the sidebar', () => {
        expect(optOut).not.toBeNull();
        expect(optOut[0]).not.toContain('#my-sidebar');
    });
});

describe('the shared layer covers the sidebar', () => {
    const layer = withoutComments(read('assets/css/legacy-on-tokens.css'));

    test('menus, dialogs and sidebars restate the legacy colour utilities their hosts still carry', () => {
        expect(layer).toContain(':is(.dd-tokens, .modal, .sb-tokens) :is(.black, .dark-gray, .dark-gray2, .gray4b, .color52, .color63, .darkblue) { color: var(--ink); }');
        expect(layer).toContain(':is(.dd-tokens, .modal, .sb-tokens) .bg-white { background-color: var(--surface); }');
        expect(layer).not.toMatch(/:is\(\.dd-tokens, \.modal\) /);
        expect(declarations(layer)).not.toMatch(COLOUR_LITERAL);
    });
});

describe('sidebar hosts that carried their own colours', () => {
    test.each([
        'components/molecules/AISidebar/AISidebar.vue',
        'components/molecules/HubAiSidebar/HubAiSidebar.vue',
        'components/molecules/PromptSidebar/PromptSidebar.vue',
        'components/molecules/TaskStatusSidebar/TaskStatusSidebar.vue',
        'views/Settings/Template/CreateTemplateWithAI.vue',
        'components/organisms/CreateChannelSidebar/CreateChannelSidebar.vue',
    ])('%s paints no colour that is not a token', (rel) => {
        expect(declarations(stylesOf(rel))).not.toMatch(COLOUR_LITERAL);
        expect(withoutComments(templateOf(read(rel)))).not.toMatch(COLOUR_LITERAL);
    });
});

describe('weak spots of the themed menu', () => {
    test('the lock of a private project is a mask, not a grey image', () => {
        const template = templateOf(read('views/Projects/components/ProjectActionsBar.vue'));
        expect(template).not.toMatch(/<img :src="lockIcon"/);
        expect(template).toMatch(/class="ah-mask-icon [^"]*" :style="maskOf\(lockIcon\)"/);
    });

    test('count chips and checkbox marks inside a menu take tokens', () => {
        const css = withoutComments(read('components/molecules/DropDown/style.css'));
        expect(css).toContain('.dd-tokens :is(.sprint-watcher-count, .additional-users-count) { background: var(--fill); color: var(--ink-2); }');
        expect(css).toContain('.dd-tokens .project-checkbox-mark { background-color: var(--surface); border-color: var(--border); }');
        expect(css).toContain('.dd-tokens .project-custom-checkbox input:checked ~ .project-checkbox-mark { background-color: var(--brand); border-color: var(--brand); }');
    });
});
