import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const DIR = path.resolve(__dirname, '../../src/components/atom/Description');
const css = readFileSync(path.join(DIR, 'style.css'), 'utf8');
const vue = readFileSync(path.join(DIR, 'Description.vue'), 'utf8');

/* A one-line description sat above ~190px of blank editor, pushing subtasks and linked docs off screen. */
describe('the task description editor', () => {
    it('does not reserve a tall blank area in its stylesheet', () => {
        const rule = css.slice(css.indexOf('#editorjs .codex-editor__redactor {'));
        const minHeight = Number((rule.slice(0, rule.indexOf('}')).match(/min-height:\s*(\d+)px/) || [])[1] || 0);
        expect(minHeight).toBeLessThanOrEqual(80);
    });

    it('does not force a tall blank area from script after it loads', () => {
        expect(vue).not.toMatch(/style\.minHeight\s*=/);
    });
});
