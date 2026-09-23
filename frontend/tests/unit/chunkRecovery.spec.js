import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChunkRecovery, isChunkLoadError } from '@/config/chunkRecovery';

const chunkError = () => Object.assign(new Error('Loading chunk project-list-view failed.'), { name: 'ChunkLoadError' });

const fakeRouter = () => {
    const router = { handler: null, onError: (fn) => { router.handler = fn; } };
    return router;
};

describe('isChunkLoadError', () => {
    it.each([
        [chunkError()],
        [new Error('Loading CSS chunk gantt failed.')],
        [new TypeError('Failed to fetch dynamically imported module: /js/x.js')],
        [new TypeError('Importing a module script failed.')],
        ['ChunkLoadError'],
    ])('recognises %s', (error) => {
        expect(isChunkLoadError(error)).toBe(true);
    });

    it.each([[null], [undefined], [new Error('Cannot read properties of undefined')], [new TypeError('Failed to fetch')]])(
        'leaves %s alone',
        (error) => {
            expect(isChunkLoadError(error)).toBe(false);
        }
    );
});

describe('installChunkRecovery', () => {
    let reload;
    let listeners;

    beforeEach(() => {
        window.sessionStorage.clear();
        reload = vi.fn();
        vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
        listeners = [];
        vi.spyOn(window, 'addEventListener').mockImplementation((type, fn) => { if (type === 'unhandledrejection') listeners.push(fn); });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reloads once when a lazy route chunk is missing', () => {
        const router = fakeRouter();
        installChunkRecovery({ config: {} }, router);
        router.handler(chunkError());
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload a second time within the guard window', () => {
        const router = fakeRouter();
        installChunkRecovery({ config: {} }, router);
        router.handler(chunkError());
        router.handler(chunkError());
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('logs other route errors instead of reloading', () => {
        const router = fakeRouter();
        installChunkRecovery({ config: {} }, router);
        const bug = new Error('boom');
        router.handler(bug);
        expect(reload).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(bug);
    });

    it('reloads for a failed async component and passes other errors to the previous handler', () => {
        const previous = vi.fn();
        const app = { config: { errorHandler: previous } };
        installChunkRecovery(app, fakeRouter());

        app.config.errorHandler(chunkError(), null, 'async component loader');
        expect(reload).toHaveBeenCalledTimes(1);
        expect(previous).not.toHaveBeenCalled();

        const bug = new Error('render bug');
        app.config.errorHandler(bug, null, 'render');
        expect(previous).toHaveBeenCalledWith(bug, null, 'render');
    });

    it('still logs component errors when no handler was installed before', () => {
        const app = { config: {} };
        installChunkRecovery(app, fakeRouter());
        const bug = new Error('render bug');
        app.config.errorHandler(bug, null, 'render');
        expect(console.error).toHaveBeenCalledWith(bug);
    });

    it('reloads for an unhandled dynamic-import rejection', () => {
        installChunkRecovery({ config: {} }, fakeRouter());
        listeners.forEach((fn) => fn({ reason: new TypeError('Failed to fetch dynamically imported module: /js/y.js') }));
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
