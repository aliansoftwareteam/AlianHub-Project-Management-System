/**
 * BUG-043 regression — clickable <span>/<img> instead of <button>.
 *
 * Pre-fix: two affordances dispatched click handlers on non-semantic
 * elements that have no role, no aria-label, and don't receive
 * keyboard focus:
 *   * Modal.vue's close icon (<img @click=...>)
 *   * Attachments.vue's "Download All" (<span @click=...>)
 *
 * Post-fix: both are wrapped in / replaced with a real
 * <button type="button"> so keyboard users can Tab + Enter and screen
 * readers announce them.
 *
 * Since we can't easily mount the Vue components in a Node test, we
 * source-grep for the new pattern.
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

// --- Modal.vue ---
const modalSrc = fs.readFileSync(path.resolve(ROOT, 'frontend/src/components/atom/Modal/Modal.vue'), 'utf8');
const modalTemplate = modalSrc.split('</template>')[0];

assert(
    /<button[^>]*type=["']button["'][^>]*@click[^>]*closeModal/.test(modalTemplate),
    'Modal close affordance is a <button type="button"> with @click=closeModal'
);
assert(
    /aria-label/.test(modalTemplate),
    'Modal close button carries an aria-label'
);
// The <img> still exists inside the button but should NOT have its own
// @click handler attached.
assert(
    !/<img[^>]*@click[^>]*closeModal/.test(modalTemplate),
    'Modal no longer has a bare <img @click="closeModal"> (handler now on the button)'
);

// --- Modal style: button stripped of native chrome, focus-visible preserved ---
const modalCss = fs.readFileSync(path.resolve(ROOT, 'frontend/src/components/atom/Modal/style.css'), 'utf8');
assert(/cancel__icon-btn/.test(modalCss), 'modal style.css defines .cancel__icon-btn');
assert(/focus-visible/.test(modalCss), 'modal style.css preserves :focus-visible for the close button');

// --- Attachments.vue ---
const attachSrc = fs.readFileSync(path.resolve(ROOT, 'frontend/src/components/atom/Attachments/Attachments.vue'), 'utf8');
const attachTemplate = attachSrc.split('</template>')[0];

// Look for the download-all-btn class near a button declaration and the
// downloadAllImages click handler. The button's v-if includes a literal
// `>` (`length > 0`) so a strict `[^>]*` regex truncates early; we
// proximity-search the normalized string instead.
const m = attachTemplate.replace(/\s+/g, ' ');
const btnIdx = m.indexOf('download-all-btn');
const slice = btnIdx >= 0 ? m.substring(Math.max(0, btnIdx - 200), btnIdx + 400) : '';
assert(/<button\b/.test(slice), 'download-all-btn appears inside a <button> tag');
assert(/@click=["']downloadAllImages\(\)["']/.test(slice), 'download-all-btn carries @click=downloadAllImages()');
assert(/type=["']button["']/.test(slice), 'download-all-btn declares type="button"');
assert(
    !/<span[^>]*@click=["']downloadAllImages\(\)["']/.test(attachTemplate),
    'Attachments no longer has <span @click=downloadAllImages>'
);

// Attachments style: button stripped of native chrome, focus-visible preserved.
assert(/\.download-all-btn/.test(attachSrc), 'Attachments style defines .download-all-btn');
assert(/download-all-btn:focus-visible/.test(attachSrc), 'Attachments style preserves :focus-visible on Download All');

console.log('\nAll BUG-043 assertions passed.');
