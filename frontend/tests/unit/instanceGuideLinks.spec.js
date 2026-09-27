import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const shell = readFileSync(path.resolve(__dirname, '../../src/views/Settings/Instance/InstanceShell.vue'), 'utf8');
const styles = shell.slice(shell.indexOf('<style'));

const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(styles);
    return match ? match[2] : '';
};

describe('instance settings pages', () => {
    it('colour inline guide links with the brand token, not the browser default blue', () => {
        expect(rule('.in__body a:not(.ah-btn)')).toMatch(/color:\s*var\(--brand\)/);
    });

    it('let a link inside a banner take the banner ink, so it keeps the banner contrast', () => {
        expect(rule('.in__body .in-banner a')).toMatch(/color:\s*inherit/);
    });

    it('keep each settings group tab on one line and scroll the strip on a phone', () => {
        expect(rule('.in-actions .ah-tabs')).toMatch(/overflow-x:\s*auto/);
        expect(rule('.in-actions .ah-tab')).toMatch(/white-space:\s*nowrap/);
    });
});
