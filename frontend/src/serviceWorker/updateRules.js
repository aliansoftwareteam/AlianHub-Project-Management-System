export const STEP = Object.freeze({ NONE: 'none', ACTIVATE: 'activate', PROMPT: 'prompt', RELOAD: 'reload' });

export const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000;

const urlOf = (value) => {
    try {
        return new URL(value);
    } catch {
        return null;
    }
};

const BUILD_SCRIPT = /^\/js\//;

/* Only the build's own chunks count: a script the server renders, or one from another origin, is in
 * no build's list and would make every tab look out of date. */
export const pageScriptPaths = (scripts, origin) => scripts
    .map((script) => urlOf(script.src))
    .filter((url) => url && url.origin === origin && BUILD_SCRIPT.test(url.pathname))
    .map((url) => url.pathname);

/* true or false, or null when it cannot be told. A tab runs a worker's build when every script it
 * loaded is one of that build's files: the entry script's name changes with any change to the code. */
export const isPageCurrent = (scriptPaths, workerAssets) => {
    if (!Array.isArray(workerAssets) || !scriptPaths.length) return null;
    return scriptPaths.every((path) => workerAssets.includes(path));
};

/* Page loads are answered by the network, so a tab opened after a release already runs the new build
 * and has nothing to reload; only a tab left open across the release is asked. */
export const updateStep = ({ waiting, pageCurrent }) => {
    if (!waiting) return STEP.NONE;
    return pageCurrent === true ? STEP.ACTIVATE : STEP.PROMPT;
};

export const controllerChangeStep = ({ accepted, pageCurrent }) => {
    if (accepted) return STEP.RELOAD;
    return pageCurrent === false ? STEP.PROMPT : STEP.NONE;
};

export const shouldCheckForUpdate = ({ now, lastCheckedAt, visible, online }) => Boolean(visible && online && now - lastCheckedAt >= UPDATE_CHECK_EVERY_MS);
