// Task-type icon library (Iconify) — offline registration + search.
//
// Curated to 3 sets (mdi / lucide / tabler). The collection JSON is lazy-loaded
// on first use (dynamic import → separate webpack chunk) and registered with
// @iconify/vue via addCollection, so <Icon> resolves fully offline — no CDN, no
// backend icon endpoints. See .claude/PRD-task-type-icon-library.md §5.5.

import { addCollection } from '@iconify/vue';

// The sets we ship, in picker display order.
export const CURATED_SETS = ['mdi', 'lucide', 'tabler'];

// Default color for monochrome library icons (theme primary).
export const DEFAULT_ICON_COLOR = '#2F3990';

// Fallback when no icon is chosen / a name can't be resolved.
export const DEFAULT_ICON = 'mdi:checkbox-marked-circle-outline';

// Keyword → icon, used to auto-assign icons to task-type names (AI templates,
// migration fallback). First matching keyword wins; else DEFAULT_ICON.
export const KEYWORD_ICON_MAP = {
    bug: 'mdi:bug',
    subtask: 'mdi:subdirectory-arrow-right',
    'sub task': 'mdi:subdirectory-arrow-right',
    design: 'mdi:palette',
    task: 'mdi:checkbox-marked-circle-outline',
    story: 'mdi:bookmark-outline',
    epic: 'mdi:flag-outline',
    feature: 'mdi:star-outline',
    research: 'mdi:magnify',
    test: 'mdi:test-tube',
    review: 'mdi:eye-check-outline',
    doc: 'mdi:file-document-outline',
    meeting: 'mdi:account-group-outline',
};

let loadPromise = null;
// Flat search index: [{ name: 'mdi:home', set: 'mdi', search: 'home' }]
const iconIndex = [];

function indexCollection(collection) {
    const prefix = collection && collection.prefix;
    if (!prefix) return;
    const names = [
        ...Object.keys(collection.icons || {}),
        ...Object.keys(collection.aliases || {}),
    ];
    for (const n of names) {
        iconIndex.push({ name: `${prefix}:${n}`, set: prefix, search: n.replace(/-/g, ' ') });
    }
}

/**
 * Lazy-load + register the curated icon sets. Idempotent — returns the same
 * promise on repeat calls. Await before rendering library icons or searching.
 */
export function loadIconSets() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
        import(/* webpackChunkName: "iconify-mdi" */ '@iconify-json/mdi/icons.json'),
        import(/* webpackChunkName: "iconify-lucide" */ '@iconify-json/lucide/icons.json'),
        import(/* webpackChunkName: "iconify-tabler" */ '@iconify-json/tabler/icons.json'),
    ]).then((mods) => {
        for (const mod of mods) {
            const collection = mod.default || mod;
            addCollection(collection);
            indexCollection(collection);
        }
    }).catch((err) => {
        // Reset so a later call can retry after a transient load failure.
        loadPromise = null;
        throw err;
    });
    return loadPromise;
}

export function isLoaded() {
    return iconIndex.length > 0;
}

/**
 * Search loaded icons by substring (name or set:name). Call after loadIconSets().
 * @returns {string[]} icon references like 'mdi:home', capped at `limit`.
 */
export function searchIcons(query, { limit = 100, set = null } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const results = [];
    for (const entry of iconIndex) {
        if (set && entry.set !== set) continue;
        if (q && !entry.search.includes(q) && !entry.name.includes(q)) continue;
        results.push(entry.name);
        if (results.length >= limit) break;
    }
    return results;
}

/**
 * Map an arbitrary task-type name to a curated icon via KEYWORD_ICON_MAP.
 * Used for AI-generated templates and migration fallbacks.
 */
export function iconForName(name) {
    const n = String(name || '').toLowerCase();
    for (const kw of Object.keys(KEYWORD_ICON_MAP)) {
        if (n.includes(kw)) return KEYWORD_ICON_MAP[kw];
    }
    return DEFAULT_ICON;
}
