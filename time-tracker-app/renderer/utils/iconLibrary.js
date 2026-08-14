// Task-type icon library (Iconify, mdi-only, offline) for the time tracker.
// Mirrors the web app: lazy-load the mdi collection JSON and register it with
// @iconify/react via addCollection, so <Icon> resolves fully offline. Only mdi is
// bundled (per decision) — a non-mdi/unknown name renders DEFAULT_ICON, and we never
// pass an unloaded name to <Icon>, so it never reaches the Iconify CDN.
import { addCollection, iconLoaded } from '@iconify/react';

export const DEFAULT_ICON = 'mdi:checkbox-marked-circle';
export const DEFAULT_ICON_COLOR = '#2F3990';

let loaded = false;
let loadPromise = null;

export function isLoaded() {
    return loaded;
}

export function loadIconSet() {
    if (loaded) return Promise.resolve();
    if (!loadPromise) {
        loadPromise = import('@iconify-json/mdi/icons.json')
            .then((mod) => { addCollection(mod.default || mod); loaded = true; })
            .catch(() => { /* offline-safe: leave unloaded → DEFAULT_ICON fallback */ });
    }
    return loadPromise;
}

export { iconLoaded };
