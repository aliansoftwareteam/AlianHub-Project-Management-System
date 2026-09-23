/* A tab opened before a deploy still holds the previous content-hashed chunk names, and
 * those files are gone from the server, so the first lazy view it opens 404s and the
 * screen dead-ends. Reloading picks up the current index.html and chunk names. Only
 * chunk failures reload, and at most once per RELOAD_GUARD_MS: a chunk that is truly
 * missing from the build would otherwise put the tab in a refresh loop. */

const CHUNK_ERROR_PATTERN = /ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

const RELOAD_FLAG = 'ah:chunk-reloaded-at';
const RELOAD_GUARD_MS = 30 * 1000;

// Bundlers disagree on whether the detail sits in the name or the message.
export const isChunkLoadError = (error) => {
    if (!error) return false;
    const name = String(error.name || '');
    const message = String(error.message || error || '');
    return CHUNK_ERROR_PATTERN.test(name) || CHUNK_ERROR_PATTERN.test(message);
};

const reloadOnce = (source) => {
    let last = 0;
    try {
        last = Number(window.sessionStorage.getItem(RELOAD_FLAG)) || 0;
    } catch (e) {
        last = 0;
    }
    if (last && (Date.now() - last) < RELOAD_GUARD_MS) {
        console.error(`[chunk] still failing after a reload (${source}); the build may be incomplete.`);
        return false;
    }
    try {
        window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    } catch (e) { /* storage unavailable: one reload still beats a dead screen */ }
    console.warn(`[chunk] a lazily loaded file was missing (${source}); reloading to pick up the current build.`);
    window.location.reload();
    return true;
};

// Call before app.mount() so the first navigation is covered.
export const installChunkRecovery = (app, router) => {
    if (router && typeof router.onError === 'function') {
        router.onError((error) => {
            if (isChunkLoadError(error)) {
                reloadOnce('route');
                return;
            }
            console.error(error);
        });
    }

    // defineAsyncComponent failures reach Vue's error handler, not the router.
    const previousHandler = app.config.errorHandler;
    app.config.errorHandler = (error, instance, info) => {
        if (isChunkLoadError(error) && reloadOnce(`component: ${info}`)) return;
        if (typeof previousHandler === 'function') {
            previousHandler(error, instance, info);
            return;
        }
        // Setting a handler replaces Vue's default logging; without this every runtime error goes silent.
        console.error(error);
    };

    // An import() awaited outside a render or navigation reaches neither handler above.
    window.addEventListener('unhandledrejection', (event) => {
        if (isChunkLoadError(event && event.reason)) reloadOnce('unhandled rejection');
    });
};

export default installChunkRecovery;
