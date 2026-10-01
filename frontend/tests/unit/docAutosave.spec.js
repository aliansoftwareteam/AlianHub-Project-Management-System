import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocAutosave, readUnsaved, unsavedKeyOf, SAVE_DELAY_MS, RETRY_DELAY_MS } from '@/components/molecules/Pages/docAutosave';

const ok = (data = {}) => ({ data: { status: true, data } });
const refused = (statusText) => ({ data: { status: false, statusText } });
const behind = () => ({ data: { status: false, statusCode: 409, conflict: true } });
const offline = () => Promise.reject(new Error('Network Error'));
const serverDown = () => Promise.reject(Object.assign(new Error('Bad gateway'), { response: { status: 502 } }));

function editor(over = {}) {
    const state = { pageId: 'p1', title: 'Plan', html: '<p>One</p>', blocks: { blocks: [] }, saved: { title: 'Plan', html: '<p>One</p>' }, ...over };
    const send = vi.fn(() => Promise.resolve(ok({ editedAt: 't1' })));
    const onSaved = vi.fn((sent) => { if (sent.pageId === state.pageId) state.saved = { title: sent.title, html: sent.html }; });
    const autosave = createDocAutosave({
        draft: () => (state.pageId ? { pageId: state.pageId, title: state.title, html: state.html, blocks: state.blocks } : null),
        isDirty: () => state.title !== state.saved.title || state.html !== state.saved.html,
        send,
        onSaved,
    });
    autosave.opened({ _id: 'p1', title: 'Plan', content: { html: '<p>One</p>' }, editedAt: 't0' });
    const type = (html) => { state.html = html; autosave.changed(); };
    return { state, send, onSaved, autosave, type };
}

const tick = async (ms) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('saving a doc while it is written', () => {
    it('saves once, two seconds after the last change, as an autosave against the doc it opened', async () => {
        const { send, autosave, type } = editor();
        expect(SAVE_DELAY_MS).toBe(2000);
        expect(autosave.saveState.value).toBe('saved');

        type('<p>One, t</p>');
        expect(autosave.saveState.value).toBe('saving');
        await tick(1500);
        type('<p>One, two</p>');
        await tick(1900);
        expect(send).not.toHaveBeenCalled();

        await tick(200);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith('p1', { title: 'Plan', contentHtml: '<p>One, two</p>', contentBlocks: { blocks: [] }, baseEditedAt: 't0', autosave: true });
        expect(autosave.saveState.value).toBe('saved');
        expect(readUnsaved('p1')).toBe(null);
    });

    it('never runs two saves at once, and sends what was typed meanwhile against the new base', async () => {
        const { send, autosave, type } = editor();
        let land;
        send.mockImplementationOnce(() => new Promise((resolve) => { land = () => resolve(ok({ editedAt: 't1' })); }));

        type('<p>One, two</p>');
        await tick(SAVE_DELAY_MS);
        type('<p>One, two, three</p>');
        await tick(SAVE_DELAY_MS);
        expect(send).toHaveBeenCalledTimes(1);
        expect(autosave.saveState.value).toBe('saving');

        land();
        await tick(SAVE_DELAY_MS);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1][1]).toMatchObject({ contentHtml: '<p>One, two, three</p>', baseEditedAt: 't1' });
        expect(autosave.saveState.value).toBe('saved');
    });

    it('saves at once when the person leaves the doc, and that save is not an autosave', async () => {
        const { send, autosave, type } = editor();
        type('<p>One, two</p>');

        expect(await autosave.flush({ settled: true })).toBe(true);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][1]).not.toHaveProperty('autosave');

        await tick(10 * SAVE_DELAY_MS);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('says the person stopped editing when the last save was an autosave and nothing is left to save', async () => {
        const { send, autosave, type } = editor();
        type('<p>One, two</p>');
        await tick(SAVE_DELAY_MS);

        await autosave.flush({ settled: true });
        expect(send).toHaveBeenLastCalledWith('p1', { settle: true });

        await autosave.flush({ settled: true });
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('sends nothing for a doc that was not changed', async () => {
        const { send, autosave } = editor();
        expect(await autosave.flush({ settled: true })).toBe(true);
        await tick(10 * SAVE_DELAY_MS);
        expect(send).not.toHaveBeenCalled();
    });
});

describe('a save that fails', () => {
    it('keeps the text on this device, says so, and tries again until it lands', async () => {
        const { send, autosave, type } = editor();
        send.mockImplementationOnce(offline).mockImplementationOnce(serverDown);

        type('<p>One, two</p>');
        await tick(SAVE_DELAY_MS);
        expect(autosave.saveState.value).toBe('offline');
        expect(readUnsaved('p1')).toMatchObject({ title: 'Plan', html: '<p>One, two</p>', base: 't0' });

        await tick(RETRY_DELAY_MS);
        expect(send).toHaveBeenCalledTimes(2);
        expect(autosave.saveState.value).toBe('failed');
        expect(readUnsaved('p1')).toMatchObject({ html: '<p>One, two</p>' });

        await tick(RETRY_DELAY_MS);
        expect(send).toHaveBeenCalledTimes(3);
        expect(autosave.saveState.value).toBe('saved');
        expect(readUnsaved('p1')).toBe(null);
    });

    it('tries again as soon as the connection is back', async () => {
        const { send, autosave, type } = editor();
        send.mockImplementationOnce(offline);
        type('<p>One, two</p>');
        await tick(SAVE_DELAY_MS);

        autosave.online();
        await tick(0);
        expect(send).toHaveBeenCalledTimes(2);
        expect(autosave.saveState.value).toBe('saved');
    });

    it('keeps the text and the reason when the server refuses it, without asking again on its own', async () => {
        const { send, autosave, type } = editor();
        send.mockImplementation(() => Promise.resolve(refused('Page content is too large.')));

        type('<p>One, two</p>');
        await tick(SAVE_DELAY_MS);
        expect(autosave.saveState.value).toBe('failed');
        expect(autosave.lastError.value).toBe('Page content is too large.');
        expect(readUnsaved('p1')).toMatchObject({ html: '<p>One, two</p>' });

        await tick(5 * RETRY_DELAY_MS);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('gives the kept text back when the doc is opened again, and saves it', async () => {
        const first = editor();
        first.send.mockImplementation(offline);
        first.type('<p>One, two</p>');
        await tick(SAVE_DELAY_MS);
        first.autosave.dispose();

        const again = editor();
        localStorage.setItem(unsavedKeyOf('p1'), JSON.stringify({ title: 'Plan', html: '<p>One, two</p>', blocks: { blocks: [] }, base: 't0' }));
        const kept = again.autosave.opened({ _id: 'p1', title: 'Plan', content: { html: '<p>One</p>' }, editedAt: 't0' });

        expect(kept).toMatchObject({ title: 'Plan', html: '<p>One, two</p>' });
        expect(again.autosave.saveState.value).toBe('saved');
    });

    it('forgets the kept text when the doc on the server already holds it', () => {
        const { autosave } = editor();
        localStorage.setItem(unsavedKeyOf('p1'), JSON.stringify({ title: 'Plan', html: '<p>One, two</p>', blocks: { blocks: [] }, base: 't0' }));

        expect(autosave.opened({ _id: 'p1', title: 'Plan', content: { html: '<p>One, two</p>' }, editedAt: 't1' })).toBe(null);
        expect(readUnsaved('p1')).toBe(null);
    });

    it('writes the text to this device at once when the tab is closing', () => {
        const { state, autosave } = editor();
        state.html = '<p>One, two</p>';
        autosave.keepNow();
        expect(readUnsaved('p1')).toMatchObject({ html: '<p>One, two</p>', base: 't0' });
    });
});

describe('a doc someone else saved meanwhile', () => {
    it('is not overwritten: the save stops, the text stays on this device, and nothing is sent until the person chooses', async () => {
        const { send, autosave, type } = editor();
        send.mockImplementation(() => Promise.resolve(behind()));

        type('<p>One, mine</p>');
        await tick(SAVE_DELAY_MS);
        expect(autosave.saveState.value).toBe('conflict');
        expect(readUnsaved('p1')).toMatchObject({ html: '<p>One, mine</p>' });

        type('<p>One, mine, and more</p>');
        await tick(5 * RETRY_DELAY_MS);
        expect(send).toHaveBeenCalledTimes(1);
        expect(readUnsaved('p1')).toMatchObject({ html: '<p>One, mine, and more</p>' });
        expect(await autosave.flush({ settled: true })).toBe(false);
    });

    it('reads a real 409 the same way', async () => {
        const { send, autosave, type } = editor();
        send.mockImplementation(() => Promise.reject(Object.assign(new Error('Conflict'), { response: { status: 409 } })));
        type('<p>One, mine</p>');
        await tick(SAVE_DELAY_MS);
        expect(autosave.saveState.value).toBe('conflict');
    });

    it('is found on opening, when the kept text was written against an older doc', () => {
        const { autosave } = editor();
        localStorage.setItem(unsavedKeyOf('p1'), JSON.stringify({ title: 'Plan', html: '<p>One, mine</p>', blocks: { blocks: [] }, base: 't0' }));

        const kept = autosave.opened({ _id: 'p1', title: 'Plan', content: { html: '<p>One, theirs</p>' }, editedAt: 't5' });
        expect(kept).toMatchObject({ html: '<p>One, mine</p>' });
        expect(autosave.saveState.value).toBe('conflict');

        autosave.discardUnsaved('p1');
        expect(readUnsaved('p1')).toBe(null);
    });
});

describe('leaving for another doc', () => {
    it('saves the doc that was left, with its own text, and leaves the new doc alone', async () => {
        const { state, send, onSaved, autosave, type } = editor();
        type('<p>One, two</p>');

        const left = autosave.flush({ settled: true });
        Object.assign(state, { pageId: 'p2', title: 'Other', html: '<p>Other</p>', saved: { title: 'Other', html: '<p>Other</p>' } });
        autosave.opened({ _id: 'p2', title: 'Other', content: { html: '<p>Other</p>' }, editedAt: 'o0' });
        await left;

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith('p1', expect.objectContaining({ contentHtml: '<p>One, two</p>', baseEditedAt: 't0' }));
        expect(onSaved.mock.calls[0][0]).toMatchObject({ pageId: 'p1' });
        expect(autosave.saveState.value).toBe('saved');
        expect(readUnsaved('p1')).toBe(null);
    });

    it('keeps the left doc’s text on this device when that save does not land', async () => {
        const { state, send, autosave, type } = editor();
        send.mockImplementation(offline);
        type('<p>One, two</p>');

        const left = autosave.flush({ settled: true });
        Object.assign(state, { pageId: 'p2', title: 'Other', html: '<p>Other</p>', saved: { title: 'Other', html: '<p>Other</p>' } });
        autosave.opened({ _id: 'p2', title: 'Other', content: { html: '<p>Other</p>' }, editedAt: 'o0' });
        await left;

        expect(readUnsaved('p1')).toMatchObject({ html: '<p>One, two</p>', base: 't0' });
        expect(autosave.saveState.value).toBe('saved');
    });
});
