import { ref } from 'vue';

export const SAVE_DELAY_MS = 2000;
export const RETRY_DELAY_MS = 8000;

export const unsavedKeyOf = (pageId) => `doc-unsaved:${pageId}`;

export const readUnsaved = (pageId) => {
    try {
        const kept = JSON.parse(localStorage.getItem(unsavedKeyOf(pageId)) || 'null');
        return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : null;
    } catch (error) {
        return null;
    }
};

const writeUnsaved = (pageId, value) => {
    try {
        if (value) localStorage.setItem(unsavedKeyOf(pageId), JSON.stringify(value));
        else localStorage.removeItem(unsavedKeyOf(pageId));
    } catch (error) {
        console.error('ERROR in keeping the doc on this device: ', error);
    }
};

const isBehind = (body, error) => Boolean(body && (body.statusCode === 409 || body.conflict)) || error?.response?.status === 409;

/* Saves the open doc by itself. `draft()` is the doc as it is in the editor ({ pageId, title, html, blocks }) or
   null, `isDirty()` whether it differs from what was last saved, `send(pageId, body)` the request and
   `onSaved(sent, data)` what moves the editor's saved state on. Before every request the text is written to this
   device, and it stays there until a save holding it has landed, so a save that fails, a closed tab and a doc
   someone else saved meanwhile all leave it where the next opening of the doc finds it. Saves run one at a time.
   A doc that is behind the server (409) is never overwritten and never retried: the person chooses. */
export function createDocAutosave({ draft, isDirty, send, onSaved }) {
    const saveState = ref('saved');
    const lastError = ref('');
    const bases = new Map();
    const unsettled = new Set();
    let saveTimer = null;
    let retryTimer = null;
    let queue = Promise.resolve(true);
    let alive = true;

    const isHere = (pageId) => draft()?.pageId === pageId;
    const show = (pageId, state) => { if (isHere(pageId)) saveState.value = state; };
    const keep = (doc) => writeUnsaved(doc.pageId, { title: doc.title, html: doc.html, blocks: doc.blocks, base: bases.get(doc.pageId) || '' });

    const forget = (sent) => {
        const kept = readUnsaved(sent.pageId);
        if (kept && kept.title === sent.title && kept.html === sent.html) writeUnsaved(sent.pageId, null);
    };

    function schedule() {
        clearTimeout(saveTimer);
        if (alive) saveTimer = setTimeout(() => flush(), SAVE_DELAY_MS);
    }

    function retryLater() {
        clearTimeout(retryTimer);
        if (alive) retryTimer = setTimeout(() => flush(), RETRY_DELAY_MS);
    }

    async function settle(pageId) {
        if (!unsettled.delete(pageId)) return;
        try {
            await send(pageId, { settle: true });
        } catch (error) {
            unsettled.add(pageId);
        }
    }

    async function save(captured, settled) {
        const now = draft();
        const here = Boolean(now) && now.pageId === captured.pageId;
        const doc = here ? now : captured;
        if (here && saveState.value === 'conflict') {
            if (isDirty()) keep(doc);
            return false;
        }
        if (here ? !isDirty() : !captured.dirty) {
            if (settled) await settle(doc.pageId);
            show(doc.pageId, 'saved');
            return true;
        }
        const sent = { pageId: doc.pageId, title: doc.title, html: doc.html, blocks: doc.blocks };
        keep(sent);
        show(sent.pageId, 'saving');
        let body = null;
        let failure = null;
        try {
            const response = await send(sent.pageId, {
                title: sent.title,
                contentHtml: sent.html,
                contentBlocks: sent.blocks,
                baseEditedAt: bases.get(sent.pageId) || '',
                ...(settled ? {} : { autosave: true }),
            });
            body = response?.data || {};
        } catch (error) {
            failure = error;
        }
        if (body && body.status) {
            const data = body.data || {};
            if (data.editedAt) bases.set(sent.pageId, data.editedAt);
            if (settled) unsettled.delete(sent.pageId); else unsettled.add(sent.pageId);
            forget(sent);
            lastError.value = '';
            onSaved(sent, data, { settled });
            if (isHere(sent.pageId) && isDirty()) {
                saveState.value = 'saving';
                schedule();
            } else {
                show(sent.pageId, 'saved');
            }
            return true;
        }
        if (isBehind(body, failure)) {
            show(sent.pageId, 'conflict');
            return false;
        }
        const reached = Boolean(body) || Boolean(failure?.response?.status);
        if (isHere(sent.pageId)) {
            saveState.value = reached ? 'failed' : 'offline';
            lastError.value = (body && body.statusText) || '';
            if (!body) retryLater();
        }
        return false;
    }

    /* The doc is read when this is called, so a save asked for while leaving sends the doc that was left. */
    function flush({ settled = false } = {}) {
        clearTimeout(saveTimer);
        clearTimeout(retryTimer);
        const doc = draft();
        if (!doc) return Promise.resolve(true);
        const captured = { ...doc, dirty: isDirty() };
        if (captured.dirty) keep(captured);
        const run = () => save(captured, settled);
        queue = queue.then(run, run);
        return queue;
    }

    function changed() {
        if (saveState.value !== 'conflict') saveState.value = 'saving';
        schedule();
    }

    function keepNow() {
        const doc = draft();
        if (doc && isDirty()) keep(doc);
    }

    /* Called with the doc as the server holds it. Returns the text kept on this device for it, if the server does
       not hold that text already; it is in conflict when it was written against an older state of the doc. */
    function opened(page) {
        const pageId = String(page._id);
        const base = page.editedAt || '';
        bases.set(pageId, base);
        saveState.value = 'saved';
        lastError.value = '';
        const kept = readUnsaved(pageId);
        if (!kept) return null;
        if (kept.title === page.title && kept.html === ((page.content && page.content.html) || '')) {
            writeUnsaved(pageId, null);
            return null;
        }
        if (String(kept.base || '') !== String(base)) saveState.value = 'conflict';
        return kept;
    }

    const discardUnsaved = (pageId) => writeUnsaved(pageId, null);

    const online = () => {
        if (saveState.value === 'offline' || saveState.value === 'failed') flush();
    };

    function dispose() {
        alive = false;
        clearTimeout(saveTimer);
        clearTimeout(retryTimer);
    }

    return { saveState, lastError, changed, flush, keepNow, opened, discardUnsaved, online, dispose };
}
