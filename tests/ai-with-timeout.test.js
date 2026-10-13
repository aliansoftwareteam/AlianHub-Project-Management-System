const { withTimeout } = require('../Modules/AI/withTimeout');

afterEach(() => jest.useRealTimers());

describe('withTimeout', () => {
    test('a call that finishes in time gives its own answer', async () => {
        await expect(withTimeout(Promise.resolve('done'), 1000, 'too slow')).resolves.toBe('done');
    });

    test('a call that fails in time fails with its own error, not the timeout', async () => {
        await expect(withTimeout(Promise.reject(new Error('bad key')), 1000, 'too slow')).rejects.toThrow('bad key');
    });

    test('a call that never ends is stopped with the given message', async () => {
        jest.useFakeTimers();
        const pending = withTimeout(new Promise(() => {}), 5000, 'The model took too long.');
        const outcome = expect(pending).rejects.toThrow('The model took too long.');
        jest.advanceTimersByTime(5000);
        await outcome;
    });

    test('just before the limit the call is still running', async () => {
        jest.useFakeTimers();
        let settled = false;
        const pending = withTimeout(new Promise(() => {}), 5000, 'slow').catch(() => { settled = true; });
        jest.advanceTimersByTime(4999);
        await Promise.resolve();
        expect(settled).toBe(false);
        jest.advanceTimersByTime(1);
        await pending;
        expect(settled).toBe(true);
    });

    test('the timer is cleared once the call settles, so nothing is left to keep the process alive', async () => {
        jest.useFakeTimers();
        await withTimeout(Promise.resolve(1), 60000, 'slow');
        expect(jest.getTimerCount()).toBe(0);
        await withTimeout(Promise.reject(new Error('x')), 60000, 'slow').catch(() => {});
        expect(jest.getTimerCount()).toBe(0);
    });
});
