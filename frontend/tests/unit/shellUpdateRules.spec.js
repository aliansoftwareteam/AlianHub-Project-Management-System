import { describe, it, expect } from 'vitest';
import { STEP, UPDATE_CHECK_EVERY_MS, isPageCurrent, pageScriptPaths, updateStep, controllerChangeStep, shouldCheckForUpdate } from '@/serviceWorker/updateRules';

const NEW_BUILD = ['/index.html', '/js/chunk-vendors.f6a982e8.js', '/js/app.22222222.js', '/js/1057.1f479109.js'];

describe('is this tab already running the build a worker holds', () => {
    it('is when every script the page loaded is in that build', () => {
        expect(isPageCurrent(['/js/chunk-vendors.f6a982e8.js', '/js/app.22222222.js'], NEW_BUILD)).toBe(true);
    });

    it('is not when the page loaded a script of an earlier build', () => {
        expect(isPageCurrent(['/js/chunk-vendors.f6a982e8.js', '/js/app.11111111.js'], NEW_BUILD)).toBe(false);
    });

    it('is unknown when the worker did not say what it holds, or the page shows no scripts', () => {
        expect(isPageCurrent(['/js/app.22222222.js'], null)).toBe(null);
        expect(isPageCurrent([], NEW_BUILD)).toBe(null);
    });

    it('reads only the scripts served by this origin', () => {
        const scripts = [
            { src: 'https://hub.example.com/js/app.22222222.js' },
            { src: 'https://accounts.google.com/gsi/client' },
            { src: '' },
        ];
        expect(pageScriptPaths(scripts, 'https://hub.example.com')).toEqual(['/js/app.22222222.js']);
    });
});

describe('what to do when a new worker is waiting', () => {
    it('does nothing while no worker waits', () => {
        expect(updateStep({ waiting: false, pageCurrent: null })).toBe(STEP.NONE);
    });

    it('lets it take over quietly when this tab already runs its build', () => {
        expect(updateStep({ waiting: true, pageCurrent: true })).toBe(STEP.ACTIVATE);
    });

    it('asks the person when this tab runs an earlier build, or cannot tell', () => {
        expect(updateStep({ waiting: true, pageCurrent: false })).toBe(STEP.PROMPT);
        expect(updateStep({ waiting: true, pageCurrent: null })).toBe(STEP.PROMPT);
    });
});

describe('what to do when another worker takes over this tab', () => {
    it('reloads the tab whose person accepted the prompt', () => {
        expect(controllerChangeStep({ accepted: true, pageCurrent: false })).toBe(STEP.RELOAD);
    });

    it('never reloads a tab that did not ask for it', () => {
        expect(controllerChangeStep({ accepted: false, pageCurrent: false })).toBe(STEP.PROMPT);
        expect(controllerChangeStep({ accepted: false, pageCurrent: true })).toBe(STEP.NONE);
        expect(controllerChangeStep({ accepted: false, pageCurrent: null })).toBe(STEP.NONE);
    });
});

describe('when to ask the server for a newer worker', () => {
    const at = 1_700_000_000_000;

    it('asks when the tab is looked at again after an hour', () => {
        expect(shouldCheckForUpdate({ now: at + UPDATE_CHECK_EVERY_MS, lastCheckedAt: at, visible: true, online: true })).toBe(true);
    });

    it('does not ask sooner, while hidden, or with no connection', () => {
        expect(shouldCheckForUpdate({ now: at + UPDATE_CHECK_EVERY_MS - 1, lastCheckedAt: at, visible: true, online: true })).toBe(false);
        expect(shouldCheckForUpdate({ now: at + UPDATE_CHECK_EVERY_MS, lastCheckedAt: at, visible: false, online: true })).toBe(false);
        expect(shouldCheckForUpdate({ now: at + UPDATE_CHECK_EVERY_MS, lastCheckedAt: at, visible: true, online: false })).toBe(false);
    });
});
