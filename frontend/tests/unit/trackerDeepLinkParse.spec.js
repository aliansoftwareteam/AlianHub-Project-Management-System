import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTrackerDeepLink, isTrackerCapableDevice, openInTracker } from '@/utils/trackerDeepLink';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const originalLocation = window.location;

const setUserAgent = (ua) => vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);

const task = { taskId: 't1', projectId: 'p1' };

describe('trackerDeepLink', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        setUserAgent(DESKTOP_UA);
        Object.defineProperty(window, 'location', { configurable: true, value: { href: 'https://app.test/' } });
    });
    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    describe('isTrackerCapableDevice', () => {
        it('accepts a desktop browser', () => {
            expect(isTrackerCapableDevice()).toBe(true);
        });

        it.each([
            ['Android phone', 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari/537.36'],
            ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'],
            ['iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'],
            ['iPod', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 12_0)'],
            ['Windows Phone', 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1)'],
            ['IE Mobile', 'Mozilla/5.0 (compatible; MSIE 10.0; IEMobile/10.0)'],
            ['lowercase mobile marker', 'some mobile browser'],
        ])('refuses %s', (_label, ua) => {
            setUserAgent(ua);
            expect(isTrackerCapableDevice()).toBe(false);
        });

        it('treats an empty user agent as a desktop', () => {
            setUserAgent('');
            expect(isTrackerCapableDevice()).toBe(true);
        });
    });

    describe('buildTrackerDeepLink', () => {
        it('puts every given id in the link, after the trackerStart type', () => {
            const link = buildTrackerDeepLink({ taskId: 't1', projectId: 'p1', sprintId: 's1', folderId: 'f1', comment: 'hello' });
            expect(link.startsWith('myapp://open?')).toBe(true);
            const params = new URL(link.replace('myapp://', 'http://x/')).searchParams;
            expect(Object.fromEntries(params)).toEqual({
                type: 'trackerStart', taskId: 't1', projectId: 'p1', sprintId: 's1', folderId: 'f1', comment: 'hello',
            });
        });

        it('leaves out the optional ids that were not given', () => {
            expect(buildTrackerDeepLink(task)).toBe('myapp://open?type=trackerStart&taskId=t1&projectId=p1');
        });

        it('drops empty-string and null values instead of sending blank keys', () => {
            const link = buildTrackerDeepLink({ ...task, sprintId: '', folderId: null, comment: undefined });
            expect(link).toBe('myapp://open?type=trackerStart&taskId=t1&projectId=p1');
        });

        it('encodes a comment with spaces, ampersands and unicode so it survives the round trip', () => {
            const comment = 'fix a&b = c? #1 café';
            const link = buildTrackerDeepLink({ ...task, comment });
            expect(link).not.toContain(' ');
            expect(new URLSearchParams(link.split('?')[1]).get('comment')).toBe(comment);
        });

        it('still produces a typed link when called with nothing', () => {
            expect(buildTrackerDeepLink()).toBe('myapp://open?type=trackerStart');
        });
    });

    describe('openInTracker', () => {
        it('refuses with "missing" when the task or project id is absent, and does not navigate', () => {
            expect(openInTracker({ projectId: 'p1' })).toEqual({ ok: false, reason: 'missing' });
            expect(openInTracker({ taskId: 't1' })).toEqual({ ok: false, reason: 'missing' });
            expect(openInTracker()).toEqual({ ok: false, reason: 'missing' });
            expect(window.location.href).toBe('https://app.test/');
        });

        it('refuses with "unsupported" on a mobile device, and does not navigate', () => {
            setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
            expect(openInTracker(task)).toEqual({ ok: false, reason: 'unsupported' });
            expect(window.location.href).toBe('https://app.test/');
        });

        it('checks for missing ids before device support', () => {
            setUserAgent('Android Mobile');
            expect(openInTracker({})).toEqual({ ok: false, reason: 'missing' });
        });

        it('navigates to the deep link and reports success', () => {
            expect(openInTracker({ ...task, comment: 'hi' })).toEqual({ ok: true });
            expect(window.location.href).toBe('myapp://open?type=trackerStart&taskId=t1&projectId=p1&comment=hi');
        });

        it('reports "launch-failed" when the browser refuses the navigation', () => {
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { set href(_v) { throw new Error('blocked'); } },
            });
            expect(openInTracker(task)).toEqual({ ok: false, reason: 'launch-failed' });
        });

        describe('not-opened detection', () => {
            beforeEach(() => vi.useFakeTimers());

            it('calls onNotOpened after 1.5s when the page never lost focus', () => {
                const onNotOpened = vi.fn();
                expect(openInTracker(task, { onNotOpened }).ok).toBe(true);
                vi.advanceTimersByTime(1499);
                expect(onNotOpened).not.toHaveBeenCalled();
                vi.advanceTimersByTime(1);
                expect(onNotOpened).toHaveBeenCalledTimes(1);
            });

            it('stays quiet when the window blurs because the tracker took focus', () => {
                const onNotOpened = vi.fn();
                openInTracker(task, { onNotOpened });
                window.dispatchEvent(new Event('blur'));
                vi.advanceTimersByTime(2000);
                expect(onNotOpened).not.toHaveBeenCalled();
            });

            it('stays quiet when the tab becomes hidden', () => {
                const onNotOpened = vi.fn();
                const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
                openInTracker(task, { onNotOpened });
                document.dispatchEvent(new Event('visibilitychange'));
                hidden.mockRestore();
                vi.advanceTimersByTime(2000);
                expect(onNotOpened).not.toHaveBeenCalled();
            });

            it('still warns when visibility changes but the tab stays visible', () => {
                const onNotOpened = vi.fn();
                openInTracker(task, { onNotOpened });
                document.dispatchEvent(new Event('visibilitychange'));
                vi.advanceTimersByTime(1500);
                expect(onNotOpened).toHaveBeenCalledTimes(1);
            });

            it('ignores a blur that happens after the timeout window', () => {
                const onNotOpened = vi.fn();
                openInTracker(task, { onNotOpened });
                vi.advanceTimersByTime(1500);
                window.dispatchEvent(new Event('blur'));
                expect(onNotOpened).toHaveBeenCalledTimes(1);
            });

            it('ignores an onNotOpened that is not a function', () => {
                expect(openInTracker(task, { onNotOpened: 'nope' })).toEqual({ ok: true });
                expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
            });

            it('does not arm the check when the launch is refused up front', () => {
                const onNotOpened = vi.fn();
                openInTracker({ taskId: 't1' }, { onNotOpened });
                vi.advanceTimersByTime(2000);
                expect(onNotOpened).not.toHaveBeenCalled();
            });
        });
    });
});
