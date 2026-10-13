import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const overlay = readFileSync(path.resolve(__dirname, '../../src/components/organisms/TaskDetailOverlay/style.css'), 'utf8');

const rule = (selector) => {
    const at = overlay.indexOf(selector);
    if (at === -1) return '';
    const open = overlay.indexOf('{', at);
    return overlay.slice(open, overlay.indexOf('}', open));
};

/* The description stylesheet gives Editor.js blocks a 60px left gutter for its toolbar above 651px.
 * In the narrow task panel that pushed a one-line description toward the middle; Editor.js already
 * reserves room on the right for its toolbar there. */
describe('the description editor inside the task panel', () => {
    it('drops the left gutter so text starts at the box padding', () => {
        const blocks = rule('.ah-detail__pane #editorjs .ce-block__content');
        expect(blocks).toMatch(/margin-left:\s*0/);
        expect(blocks).toMatch(/max-width:\s*100%/);
    });

    it('keeps the toolbar inside the space Editor.js reserves on the right', () => {
        expect(rule('.ah-detail__pane #editorjs .ce-toolbar__actions')).toMatch(/right:\s*0/);
    });
});
