import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));

import { pickCloudFiles } from '@/composable/cloudPicker';

const TOKEN_ROUTE = '/api/v1/cloud-storage/google_drive/token';
const POPUP_PATH = '/pickers/google-drive';
const TOKEN = 'ya29.s8-drive-token';
const ORIGIN = window.location.origin;
const LABELS = { loading: 'Opening Google Drive' };

const tokenResponse = (data = { token: TOKEN, config: { api_key: 'AIza-dev-key', app_id: '1234567890' } }) => ({ data: { status: true, data } });

const fakePopup = () => ({ closed: false, postMessage: vi.fn(), close: vi.fn(function close() { this.closed = true; }) });

const deliver = (data, { origin = ORIGIN, source } = {}) => {
    const event = new Event('message');
    Object.defineProperties(event, { data: { value: data }, origin: { value: origin }, source: { value: source } });
    window.dispatchEvent(event);
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const configOf = (popup) => {
    const call = popup.postMessage.mock.calls.find(([message]) => message && message.type === 'drive-picker:config');
    return call ? { message: call[0], targetOrigin: call[1] } : null;
};

const outcome = (promise) => {
    const state = { settled: false };
    promise.then((value) => Object.assign(state, { settled: true, value }), (error) => Object.assign(state, { settled: true, error }));
    return state;
};

const open = async (over = {}) => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const result = outcome(pickCloudFiles({ provider: 'google_drive', multiple: true, labels: LABELS, ...over }));
    await settle();
    deliver({ type: 'drive-picker:ready' }, { source: popup });
    await settle();
    const sent = configOf(popup);
    return { popup, result, nonce: sent && sent.message.nonce, sent };
};

const pickedDoc = { id: 'drive-file-1', name: 'Plan.pdf', sizeBytes: '2048', mimeType: 'application/pdf', url: 'https://drive.google.com/file/d/drive-file-1/view',
    iconUrl: 'https://drive-thirdparty.googleusercontent.com/16/type/application/pdf', thumbnails: [{ url: 'https://lh3.googleusercontent.com/small', width: 32 }, { url: 'https://lh3.googleusercontent.com/big', width: 640 }] };

describe('the Google Drive picker opens in its own popup page', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        apiRequest.mockImplementation((type, url) => (type === 'get' && url === TOKEN_ROUTE ? Promise.resolve(tokenResponse()) : Promise.reject(new Error(`unexpected ${type} ${url}`))));
    });

    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

    it('opens the popup page on the click, before the token request returns, with nothing in its URL', () => {
        let answer;
        apiRequest.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        const popup = fakePopup();
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup);
        pickCloudFiles({ provider: 'google_drive', labels: LABELS });
        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(openSpy.mock.calls[0][0]).toBe(POPUP_PATH);
        answer(tokenResponse());
    });

    it('sends the token and the picker settings only after the popup says it is ready, to the app origin only', async () => {
        const popup = fakePopup();
        vi.spyOn(window, 'open').mockReturnValue(popup);
        pickCloudFiles({ provider: 'google_drive', multiple: false, labels: LABELS });
        await settle();
        expect(popup.postMessage).not.toHaveBeenCalled();

        deliver({ type: 'drive-picker:ready' }, { source: popup });
        await settle();
        const sent = configOf(popup);
        expect(sent.targetOrigin).toBe(ORIGIN);
        expect(sent.message.nonce).toMatch(/^[0-9a-f]{32}$/);
        expect(sent.message.config).toEqual({ token: TOKEN, developerKey: 'AIza-dev-key', appId: '1234567890', multiple: false, labels: LABELS });
    });

    it('does not send the token to a ready message from another origin or another window', async () => {
        const popup = fakePopup();
        vi.spyOn(window, 'open').mockReturnValue(popup);
        pickCloudFiles({ provider: 'google_drive', labels: LABELS });
        await settle();
        deliver({ type: 'drive-picker:ready' }, { source: popup, origin: 'https://evil.example' });
        deliver({ type: 'drive-picker:ready' }, { source: window });
        deliver({ type: 'drive-picker:ready' }, { source: fakePopup() });
        await settle();
        expect(popup.postMessage).not.toHaveBeenCalled();
    });

    it('accepts a valid pick, normalises the files and ends the exchange', async () => {
        const { popup, result, nonce } = await open();
        deliver({ type: 'drive-picker:picked', nonce, files: [pickedDoc] }, { source: popup });
        await settle();
        expect(result.value).toEqual([{
            id: 'drive-file-1',
            name: 'Plan.pdf',
            size: 2048,
            mimeType: 'application/pdf',
            url: 'https://drive.google.com/file/d/drive-file-1/view',
            iconUrl: pickedDoc.iconUrl,
            thumbnailUrl: 'https://lh3.googleusercontent.com/big',
        }]);
    });

    it('falls back to the Drive link when the picked file has no https url', async () => {
        const { popup, result, nonce } = await open();
        deliver({ type: 'drive-picker:picked', nonce, files: [{ ...pickedDoc, url: 'javascript:alert(1)' }] }, { source: popup });
        await settle();
        expect(result.value[0].url).toBe('https://drive.google.com/open?id=drive-file-1');
    });

    it('ignores a pick from another origin', async () => {
        const { popup, result, nonce } = await open();
        deliver({ type: 'drive-picker:picked', nonce, files: [pickedDoc] }, { source: popup, origin: 'https://evil.example' });
        await settle();
        expect(result.settled).toBe(false);
    });

    it('ignores a pick from another window', async () => {
        const { result, nonce } = await open();
        deliver({ type: 'drive-picker:picked', nonce, files: [pickedDoc] }, { source: window });
        deliver({ type: 'drive-picker:picked', nonce, files: [pickedDoc] }, { source: fakePopup() });
        await settle();
        expect(result.settled).toBe(false);
    });

    it('ignores a message of another type or without a type', async () => {
        const { popup, result, nonce } = await open();
        deliver({ type: 'drive-picker:done', nonce, files: [pickedDoc] }, { source: popup });
        deliver({ nonce, files: [pickedDoc] }, { source: popup });
        deliver(JSON.stringify({ type: 'drive-picker:picked', nonce, files: [pickedDoc] }), { source: popup });
        await settle();
        expect(result.settled).toBe(false);
    });

    it('ignores a pick with a wrong nonce or none', async () => {
        const { popup, result } = await open();
        deliver({ type: 'drive-picker:picked', nonce: '0'.repeat(32), files: [pickedDoc] }, { source: popup });
        deliver({ type: 'drive-picker:picked', files: [pickedDoc] }, { source: popup });
        await settle();
        expect(result.settled).toBe(false);
    });

    it('ignores a replayed nonce from an earlier pick', async () => {
        const first = await open();
        deliver({ type: 'drive-picker:picked', nonce: first.nonce, files: [pickedDoc] }, { source: first.popup });
        await settle();
        expect(first.result.value).toHaveLength(1);

        const second = await open();
        expect(second.nonce).not.toBe(first.nonce);
        deliver({ type: 'drive-picker:picked', nonce: first.nonce, files: [pickedDoc] }, { source: second.popup });
        deliver({ type: 'drive-picker:picked', nonce: first.nonce, files: [pickedDoc] }, { source: first.popup });
        await settle();
        expect(second.result.settled).toBe(false);
        deliver({ type: 'drive-picker:cancel', nonce: second.nonce }, { source: second.popup });
        await settle();
        expect(second.result.value).toEqual([]);
    });

    it('sends the settings once, however many ready messages arrive', async () => {
        const { popup } = await open();
        deliver({ type: 'drive-picker:ready' }, { source: popup });
        await settle();
        expect(popup.postMessage.mock.calls.filter(([message]) => message.type === 'drive-picker:config')).toHaveLength(1);
    });

    it('resolves with no files when the user cancels', async () => {
        const { popup, result, nonce } = await open();
        deliver({ type: 'drive-picker:cancel', nonce }, { source: popup });
        await settle();
        expect(result.value).toEqual([]);
    });

    it('resolves with no files when the user closes the popup', async () => {
        vi.useFakeTimers();
        const popup = fakePopup();
        vi.spyOn(window, 'open').mockReturnValue(popup);
        const result = outcome(pickCloudFiles({ provider: 'google_drive', labels: LABELS }));
        await vi.advanceTimersByTimeAsync(10);
        popup.closed = true;
        await vi.advanceTimersByTimeAsync(2000);
        expect(result.value).toEqual([]);
    });

    it('rejects with the error the popup reports', async () => {
        const { popup, result, nonce } = await open();
        deliver({ type: 'drive-picker:error', nonce }, { source: popup });
        await settle();
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.code).toBe('picker_failed');
    });

    it('reports a blocked popup without asking the server for a token', async () => {
        vi.spyOn(window, 'open').mockReturnValue(null);
        await expect(pickCloudFiles({ provider: 'google_drive', labels: LABELS })).rejects.toMatchObject({ code: 'popup_blocked' });
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('closes the popup and asks to connect when the server has no token', async () => {
        apiRequest.mockResolvedValue(tokenResponse({ token: '', config: {} }));
        const popup = fakePopup();
        vi.spyOn(window, 'open').mockReturnValue(popup);
        await expect(pickCloudFiles({ provider: 'google_drive', labels: LABELS })).rejects.toMatchObject({ code: 'not_connected' });
        expect(popup.close).toHaveBeenCalled();
        expect(popup.postMessage).not.toHaveBeenCalled();
    });

    it('never loads the Google script into the app page', async () => {
        const { popup, nonce } = await open();
        deliver({ type: 'drive-picker:cancel', nonce }, { source: popup });
        await settle();
        expect(document.querySelector('script[src*="apis.google.com"]')).toBeNull();
    });
});
