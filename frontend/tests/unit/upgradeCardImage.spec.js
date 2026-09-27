import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const source = readFileSync(path.resolve(__dirname, '../../src/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue'), 'utf8');
const styles = source.slice(source.indexOf('<style'));

/* The upgrade card's 451px illustration pushed a 390px page sideways on every plan-locked screen. */
describe('the upgrade card illustration', () => {
    it('shrinks to the card instead of widening the page', () => {
        expect(styles).toMatch(/\.upw__image\s*\{[^}]*max-width:\s*100%[^}]*height:\s*auto/);
        expect(source).toMatch(/<img class="upw__image"/);
    });

    it('is marked decorative', () => {
        expect(source).toMatch(/<img class="upw__image"[^>]*alt=""/);
    });
});
