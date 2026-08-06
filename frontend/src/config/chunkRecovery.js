/**
 * Recovery from stale lazy-loaded chunks.
 *
 * The app code-splits heavily: routes and heavy views (ListView, Gantt, the
 * dashboard) are `import()`ed on demand, and the built filenames carry a content
 * hash — `project-list-view.cb6da0d3.js`. The name of a chunk is therefore baked
 * into whichever bundle the browser loaded at page open.
 *
 * That creates one unavoidable failure: a tab that was opened BEFORE a deploy is
 * still holding the old hashes, and the old files are gone from the server. The
 * first time that tab navigates to a view it has not loaded yet, the request
 * 404s and the user gets a dead screen with nothing but "ChunkLoadError: Loading
 * chunk project-list-view failed" in the console. Nothing they can do in the UI
 * recovers it — only a reload, which they have no way of knowing.
 *
 * The same thing happens in development every time the dev server recompiles
 * while a tab is open, which is how this was found.
 *
 * The fix is to notice the specific error and reload once, which fetches the
 * current index.html and with it the current chunk names.
 *
 * Deliberately narrow:
 *   - only chunk/dynamic-import load failures reload; every other error is
 *     re-logged exactly as Vue would have, so real bugs stay visible;
 *   - at most one reload per tab per RELOAD_GUARD_MS. If the chunk is genuinely
 *     missing (a broken build, not a stale tab), reloading cannot fix it, and a
 *     handler that kept trying would put the tab in a refresh loop.
 */

// Webpack, Safari and the standard dynamic-import wording. Matched against both
// the error name and its message because bundlers are inconsistent about which
// one carries the detail.
const CHUNK_ERROR_PATTERN = /ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

const RELOAD_FLAG = 'ah:chunk-reloaded-at';
const RELOAD_GUARD_MS = 30 * 1000;

/** Is this the stale-chunk error, rather than an application bug? */
export const isChunkLoadError = (error) => {
    if (!error) return false;
    const name = String(error.name || '');
    const message = String(error.message || error || '');
    return CHUNK_ERROR_PATTERN.test(name) || CHUNK_ERROR_PATTERN.test(message);
};

/**
 * Reload, unless this tab already tried recently.
 *
 * Returns true if a reload was started — callers use that to decide whether the
 * error still needs reporting.
 */
const reloadOnce = (source) => {
    let last = 0;
    try {
        last = Number(window.sessionStorage.getItem(RELOAD_FLAG)) || 0;
    } catch (e) {
        // Private mode / storage disabled. Without a way to remember that we
        // already tried, one reload is still much better than a dead screen —
        // but never a second, so treat it as "already reloaded" afterwards.
        last = 0;
    }

    if (last && (Date.now() - last) < RELOAD_GUARD_MS) {
        // Already reloaded and it did not help: the file really is missing.
        // Leave the error visible instead of looping.
        console.error(`[chunk] still failing after a reload (${source}) — the build may be incomplete.`);
        return false;
    }

    try {
        window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    } catch (e) { /* storage unavailable — proceed anyway */ }

    console.warn(`[chunk] a lazily loaded file was missing (${source}); reloading to pick up the current build.`);
    window.location.reload();
    return true;
};

/**
 * Wire recovery into the two places a chunk failure actually surfaces.
 *
 * Must be called BEFORE app.mount(), so the handler is in place for the first
 * navigation.
 */
export const installChunkRecovery = (app, router) => {
    // 1. Lazy ROUTE components — router.onError fires and the navigation aborts,
    //    leaving the user on the old page with nothing happening.
    if (router && typeof router.onError === 'function') {
        router.onError((error) => {
            if (isChunkLoadError(error)) {
                reloadOnce('route');
                return;
            }
            // Preserve the previous behaviour for everything else: with no
            // onError handler registered, vue-router logs the failure.
            console.error(error);
        });
    }

    // 2. Lazy COMPONENTS inside a page — defineAsyncComponent() failures come
    //    through Vue's error handler, not the router. This is the ListView case.
    const previousHandler = app.config.errorHandler;
    app.config.errorHandler = (error, instance, info) => {
        if (isChunkLoadError(error) && reloadOnce(`component: ${info}`)) return;
        if (typeof previousHandler === 'function') {
            previousHandler(error, instance, info);
            return;
        }
        // Installing a handler replaces Vue's default console logging, so do it
        // here — otherwise this file would silence every runtime error in the app.
        console.error(error);
    };

    // 3. Backstop: an import() that rejects outside a render — a prefetch, or a
    //    dynamic import awaited in a plain function — reaches neither of the
    //    above. Not preventDefault()ed, so the error still reaches the console.
    window.addEventListener('unhandledrejection', (event) => {
        if (isChunkLoadError(event && event.reason)) reloadOnce('unhandled rejection');
    });
};

export default installChunkRecovery;
