import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const styles = (rel) => { const vue = read(rel); return vue.slice(vue.indexOf('<style')); };

const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};

const LIGHT_LITERAL = /(?:background|background-color|color|border(?:-[a-z]+)?)\s*:[^;]*(#fff\b|#ffffff\b|\bwhite\b|#000\b|#000000\b|\bblack\b|#f5f1f1\b|#dfe1e6\b|#d4d6d7\b|#959595\b|#f5f5f5\b)/i;
const lightLiterals = (css) => css.split('\n').filter((line) => LIGHT_LITERAL.test(line)).map((line) => line.trim());

describe('the task description (Editor.js) follows the theme', () => {
    const css = read('components/atom/Description/style.css');

    test('the editor box paints its surface, ink and border from tokens', () => {
        const box = ruleBody(css, '#editorjs');
        expect(box).toMatch(/background-color:\s*var\(--surface\)/);
        expect(box).toMatch(/color:\s*var\(--ink\)/);
        expect(box).toMatch(/border:\s*1px solid var\(--hairline\)/);
    });

    test('Show more and its wrapper use tokens', () => {
        const wrapper = ruleBody(css, '.editor-container .hide_show_wrapper');
        expect(wrapper).toMatch(/background:\s*var\(--surface\)/);
        expect(wrapper).toMatch(/border:\s*1px solid var\(--hairline\)/);
        const button = ruleBody(css, '.editor-container .hide_show');
        expect(button).toMatch(/background-color:\s*var\(--surface\)/);
        expect(button).toMatch(/color:\s*var\(--ink\)/);
        expect(ruleBody(css, '.editor-container .hide_show:hover')).toMatch(/background-color:\s*var\(--surface-hover\)/);
    });

    test('no hard-coded light colour is left in the stylesheet', () => {
        expect(lightLiterals(css)).toEqual([]);
    });

    test('Editor.js toolbar buttons, popovers and blocks are repainted from tokens', () => {
        expect(ruleBody(css, '#editorjs .ce-toolbar__settings-btn')).toMatch(/color:\s*var\(--ink-2\)/);
        const popover = ruleBody(css, '#editorjs .ce-inline-toolbar');
        expect(popover).toMatch(/--color-background:\s*var\(--surface\)/);
        expect(popover).toMatch(/--color-text-primary:\s*var\(--ink\)/);
        expect(css).toMatch(/#editorjs \.ce-block--selected \.ce-block__content\s*\{[^}]*var\(--brand-tint\)/);
        expect(ruleBody(css, '#editorjs .ce-code__textarea')).toMatch(/background:\s*var\(--surface-2\)/);
        expect(ruleBody(css, '#editorjs .cdx-checklist__item-checkbox-check')).toMatch(/background:\s*var\(--surface\)/);
        expect(ruleBody(css, '#editorjs .tc-popover')).toMatch(/--color-background:\s*var\(--surface\)/);
    });

    test('the empty "Add description" box is not a white utility block', () => {
        expect(read('components/atom/Description/Description.vue')).not.toMatch(/class="bg-white[^"]*"[^>]*>\s*<button[^>]*add_description_button/);
    });
});

describe('the comment list follows the theme', () => {
    test('the loading skeleton shimmers between theme fills, not light greys on black', () => {
        const css = styles('components/atom/Skelaton/Skelaton.vue');
        const rule = ruleBody(css, '.skelaton-loader');
        expect(rule).toMatch(/var\(--fill\)/);
        expect(rule).not.toMatch(/#f0f0f0|#e0e0e0|#d0d0d0|#000000/i);
    });

    test('the day separator pill sits on the surface with secondary ink', () => {
        expect(read('components/organisms/Comment/Comment.vue')).not.toMatch(/class="bg-light-gray[^"]*show__day-format/);
        const pill = ruleBody(read('components/organisms/Comment/style.css'), '.show__day .show__day-format');
        expect(pill).toMatch(/background(-color)?:\s*var\(--surface-2\)/);
        expect(pill).toMatch(/color:\s*var\(--ink-2\)/);
    });
});

describe('Ask answers keep list items compact', () => {
    test('rendered Markdown does not preserve the newlines between list items', () => {
        expect(ruleBody(read('views/Ai/parity.css'), '.ask__answer')).not.toMatch(/white-space:\s*pre-wrap/);
    });

    test('a loose list item drops its paragraph margins', () => {
        const css = styles('views/Ai/AskAnswer.vue');
        expect(ruleBody(css, '.ask__answer li > p')).toMatch(/margin:\s*0/);
    });
});
