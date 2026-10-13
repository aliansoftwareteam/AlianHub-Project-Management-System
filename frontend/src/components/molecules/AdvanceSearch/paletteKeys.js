import { isMacPlatform, shortcutKey } from '@/composable/shortcuts';

export { isMacPlatform };

export const PALETTE_OPEN_EVENT = 'ah:palette-open';

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'password', 'number']);

function editableKind(target) {
    if (!target || typeof target.closest !== 'function') return null;
    if (target.isContentEditable || target.closest('[contenteditable=""], [contenteditable="true"]')) return 'rich';
    const tag = String(target.tagName || '').toLowerCase();
    if (tag === 'textarea') return 'text';
    if (tag === 'input' && TEXT_INPUT_TYPES.has(String(target.getAttribute('type') || '').toLowerCase())) return 'text';
    return null;
}

/* Cmd+K on macOS and Ctrl+K elsewhere. The other modifier is taken only outside text
 * fields: in a macOS field Ctrl+K deletes to the end of the line. Rich-text editors
 * keep both, since there the combination inserts a link. */
export function isPaletteShortcut(event, { mac = isMacPlatform() } = {}) {
    if (!event || event.defaultPrevented || event.isComposing) return false;
    if (String(event.key || '').toLowerCase() !== shortcutKey('palette') || event.shiftKey || event.altKey) return false;
    if (event.metaKey === event.ctrlKey) return false;
    const primary = mac ? event.metaKey : event.ctrlKey;
    const kind = editableKind(event.target);
    if (kind === 'rich') return false;
    if (kind === 'text') return primary;
    return true;
}

export function openPalette() {
    window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
}
