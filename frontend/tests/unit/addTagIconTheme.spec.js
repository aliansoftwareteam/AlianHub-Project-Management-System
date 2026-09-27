import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const popup = readFileSync(path.resolve(__dirname, '../../src/components/molecules/TagList/CreateTagPopup.vue'), 'utf8');
const trigger = popup.slice(popup.indexOf('taglist__add-btn'), popup.indexOf('</button>', popup.indexOf('taglist__add-btn')));
const styles = popup.slice(popup.indexOf('<style'));
const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(styles);
    return match ? match[2] : '';
};

/* The add-tag icon was a static SVG with a white fill, a bright disc on dark cards. */
describe('the add-tag button icon', () => {
    it('is drawn inline, not from a fixed-colour image', () => {
        expect(trigger).not.toMatch(/<img/);
        expect(trigger).toMatch(/<svg[^>]*aria-hidden="true"/);
    });

    it('takes its colours from theme tokens', () => {
        expect(rule('.taglist__add-glyph')).toMatch(/fill:\s*var\(--ink-2\)/);
        expect(rule('.taglist__add-ring')).toMatch(/stroke:\s*var\(--ink-3\)/);
        expect(rule('.taglist__add-disc')).toMatch(/fill:\s*var\(--surface\)/);
    });
});
