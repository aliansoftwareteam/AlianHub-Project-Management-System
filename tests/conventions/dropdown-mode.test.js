const path = require('path');
const { findDropDownUses, countUsesWithoutMode, findNestedTriggerButtons } = require('./dropdown-uses');
const baseline = require('./dropdown-mode.baseline.json');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');
const total = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

describe('every <DropDown> declares mode="menu", "listbox" or "dialog" (task 039)', () => {
    const current = countUsesWithoutMode(SRC);

    it('never appears without a mode in a file that had none', () => {
        expect(Object.keys(current).filter((file) => !(file in baseline))).toEqual([]);
    });

    it('never grows in a file that still has some', () => {
        const grown = Object.entries(current).filter(([file, n]) => n > (baseline[file] || 0)).map(([file, n]) => `${file}: ${baseline[file]} -> ${n}`);
        expect(grown).toEqual([]);
    });

    it('keeps the baseline honest: lower it when a file is migrated', () => {
        const stale = Object.entries(baseline).filter(([file, n]) => (current[file] || 0) < n).map(([file, n]) => `${file}: ${n} -> ${current[file] || 0}`);
        expect(stale).toEqual([]);
        expect(total(current)).toBeLessThanOrEqual(total(baseline));
    });
});

describe('a <DropDown> with a mode renders its own trigger button', () => {
    it('so no call site puts a <button> in its #button slot unless it binds triggerAttrs', () => {
        expect(findNestedTriggerButtons(SRC)).toEqual([]);
    });
});

describe('the scanner', () => {
    it('reads the mode from a static or bound attribute', () => {
        const uses = findDropDownUses([
            '<DropDown mode="menu"></DropDown>',
            '<DropDown mode="dialog"></DropDown>',
            '<DropDown :mode="kind" :z-index="a > b ? 1 : 2"></DropDown>',
            '<DropDown v-bind:mode="kind"></DropDown>',
            '<DropDown :hover="true"\n    title="x"></DropDown>',
            '<DropDownOption mode="menu"></DropDownOption>',
        ].join('\n'));
        expect(uses.map((use) => [use.line, use.hasMode])).toEqual([[1, true], [2, true], [3, true], [4, true], [5, false]]);
    });

    it('does not mistake a longer attribute name for mode', () => {
        expect(findDropDownUses('<DropDown displayMode="x" data-mode="y"></DropDown>')[0].hasMode).toBe(false);
    });

    it('flags a button in the trigger slot of a moded dropdown', () => {
        const [use] = findDropDownUses('<DropDown mode="menu"><template #button><button type="button">More</button></template></DropDown>');
        expect(use.nestsButton).toBe(true);
    });

    it('accepts a button that takes over the trigger through triggerAttrs', () => {
        const [use] = findDropDownUses('<DropDown mode="listbox"><template #button="{ triggerAttrs }"><button v-bind="triggerAttrs">Status</button></template></DropDown>');
        expect(use.nestsButton).toBe(false);
    });

    it('also reads the v-slot:button spelling', () => {
        const [use] = findDropDownUses('<DropDown mode="menu"><template v-slot:button><button>More</button></template></DropDown>');
        expect(use.nestsButton).toBe(true);
    });

    it('looks only at its own trigger slot, not at a nested dropdown\'s', () => {
        const uses = findDropDownUses([
            '<DropDown mode="menu">',
            '  <template #button>More</template>',
            '  <template #options>',
            '    <DropDown><template #button><button>Sub</button></template></DropDown>',
            '  </template>',
            '</DropDown>',
        ].join('\n'));
        expect(uses.map((use) => [use.line, use.hasMode, use.nestsButton])).toEqual([[1, true, false], [4, false, true]]);
    });

    it('does not flag a button in a dropdown without a mode, which is counted by the baseline instead', () => {
        expect(findDropDownUses('<DropDown><template #button><button>Old</button></template></DropDown>')[0].hasMode).toBe(false);
    });
});
