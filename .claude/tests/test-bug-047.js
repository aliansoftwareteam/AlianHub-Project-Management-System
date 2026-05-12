/**
 * BUG-047 regression — custom dropdown missing ARIA listbox/menu
 * semantics and keyboard navigation.
 *
 * Pre-fix:
 *   * The trigger `<div @click=buttonClick>` had no role/aria-haspopup/
 *     aria-expanded and didn't accept keyboard input.
 *   * The floating panel had no role="listbox".
 *   * The mobile close affordance was a bare clickable `<img>`.
 *
 * Post-fix (in `CustomDropDown.vue`):
 *   * Trigger carries role="button" + tabindex="0" + aria-haspopup="listbox"
 *     + aria-expanded + aria-controls.
 *   * Trigger handles Enter / Space (open), Escape (close), ArrowDown
 *     (open + focus first option).
 *   * Floating panel carries role="listbox" and handles Escape.
 *   * Mobile close affordance is a real <button> with aria-label.
 */

const fs = require('fs');
const path = require('path');

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        process.exit(1);
    }
    console.log('PASS:', label);
}

const ROOT = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.resolve(ROOT, 'frontend/src/components/molecules/DropDown/CustomDropDown.vue'), 'utf8');
const tNorm = src.split('</template>')[0].replace(/\s+/g, ' ');
const script = src.split('<script setup>')[1].split('</script>')[0];
const styleSrc = fs.readFileSync(path.resolve(ROOT, 'frontend/src/components/molecules/DropDown/style.css'), 'utf8');

// --- Trigger: ARIA + keyboard ---
const triggerSlice = tNorm.substring(0, tNorm.indexOf('<teleport'));
assert(/role=["']button["']/.test(triggerSlice), 'trigger has role="button"');
assert(/tabindex=["']0["']/.test(triggerSlice), 'trigger has tabindex="0"');
assert(/aria-haspopup=["']?listbox/.test(triggerSlice) || /:aria-haspopup=["']'listbox'["']/.test(triggerSlice), 'trigger has aria-haspopup="listbox"');
assert(/:aria-expanded=["']dropdownVisible/.test(triggerSlice), 'trigger has aria-expanded bound to dropdownVisible');
assert(/:aria-controls=/.test(triggerSlice), 'trigger has aria-controls bound to the panel id');
assert(/@keydown\.enter\.prevent=["']buttonClick\(\)["']/.test(triggerSlice), 'trigger handles Enter');
assert(/@keydown\.space\.prevent=["']buttonClick\(\)["']/.test(triggerSlice), 'trigger handles Space');
assert(/@keydown\.esc\.prevent=["']closeDropdown\(\)["']/.test(triggerSlice), 'trigger handles Escape');
assert(/@keydown\.down\.prevent=["']openAndFocusFirstOption\(\)["']/.test(triggerSlice), 'trigger handles ArrowDown');

// --- Panel: role=listbox + Esc ---
const panelSlice = tNorm.substring(tNorm.indexOf('<teleport'));
assert(/role=["']listbox["']/.test(panelSlice), 'floating panel has role="listbox"');
assert(/@keydown\.esc\.prevent=["']closeDropdown["']/.test(panelSlice), 'panel handles Escape');

// --- Close button (mobile head) ---
// The button declaration spans the `v-if="clientWidth > 767"` directive
// which contains a literal `>`; use a proximity search rather than the
// strict `[^>]*` regex.
const closeIdx = panelSlice.indexOf('dropdown-close-btn');
const closeSlice = closeIdx >= 0 ? panelSlice.substring(Math.max(0, closeIdx - 300), closeIdx + 200) : '';
assert(/<button\b/.test(closeSlice), 'close affordance is a <button> tag');
assert(/dropdown-close-btn/.test(closeSlice), 'close button carries the dropdown-close-btn class');
assert(/aria-label=["']Close["']/.test(closeSlice), 'close button has aria-label="Close"');
assert(/type=["']button["']/.test(closeSlice), 'close button declares type="button"');

// --- Script: helpers defined ---
assert(/function closeDropdown\s*\(/.test(script), 'closeDropdown function defined');
assert(/function openAndFocusFirstOption\s*\(/.test(script), 'openAndFocusFirstOption function defined');

// --- Style: button stripped + focus-visible preserved ---
assert(/\.dropdown-close-btn[\s\S]*background:\s*none/.test(styleSrc), 'style strips native button chrome');
assert(/\.dropdown-close-btn:focus-visible/.test(styleSrc), 'style preserves :focus-visible on close button');

console.log('\nAll BUG-047 assertions passed.');
