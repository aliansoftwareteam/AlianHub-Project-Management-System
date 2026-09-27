import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const read = (file) => readFileSync(path.resolve(__dirname, '../../src/components/molecules/BulkActionBar', file), 'utf8');

/* The bulk bar's menus are white in both themes, so a status chip inside one must keep the
 * light-theme text colour; the dark-theme ink from `ah-status-ink` read 1.85:1 there. */
describe('the bulk bar status menu', () => {
    it('opens on a white surface in both themes', () => {
        expect(read('BulkMenu.vue')).toMatch(/background:\s*#fff;/);
    });

    it('keeps the light-theme status ink on its options', () => {
        const option = read('BulkActionBar.vue').match(/<span class="bulk-status-option[^"]*" :style="statusChipStyle\(status\)"/);
        expect(option).not.toBeNull();
        expect(option[0]).not.toContain('ah-status-ink');
    });
});
