const crypto = require('crypto');
const { createSignInStore, authorizeParams, TTL_MS } = require('../time-tracker-app/main/helpers/signInStore');
const { normaliseWorkspaceAddress } = require('../time-tracker-app/renderer/utils/workspaceAddress');

const ABB = 'https://abb.alianhub.com';

const makeStore = () => {
    let clock = 1_000_000;
    const store = createSignInStore({ normalise: (url) => normaliseWorkspaceAddress(url), now: () => clock });
    return { store, advance: (ms) => { clock += ms; } };
};

describe('a browser sign-in started from the finder', () => {
    it('hands the window the code for the workspace the browser chose, once', () => {
        const { store } = makeStore();
        const { state, challenge } = store.begin(null);
        expect(store.receive({ code: 'c1', userId: 'u1', state, workspace: `${ABB}/` })).toBe(true);
        expect(store.peek()).toEqual({ workspace: ABB });

        const taken = store.take(ABB);
        expect(taken).toMatchObject({ code: 'c1', userId: 'u1' });
        expect(crypto.createHash('sha256').update(taken.verifier).digest('base64url')).toBe(challenge);
        expect(store.take(ABB)).toBeNull();
        expect(store.peek()).toBeNull();
    });

    it('gives the code only to the window on that workspace', () => {
        const { store } = makeStore();
        const { state } = store.begin(null);
        store.receive({ code: 'c1', state, workspace: ABB });
        expect(store.take('https://xyz.alianhub.com')).toBeNull();
        expect(store.peek()).toEqual({ workspace: ABB });
    });

    it.each([
        ['a wrong state', (state) => ({ code: 'c', state: `${state}x`, workspace: ABB })],
        ['no state', () => ({ code: 'c', workspace: ABB })],
        ['no code', (state) => ({ state, workspace: ABB })],
        ['no workspace', (state) => ({ code: 'c', state })],
        ['a plain-http workspace', (state) => ({ code: 'c', state, workspace: 'http://abb.example.com' })],
        ['something that is not an address', (state) => ({ code: 'c', state, workspace: 'javascript:alert(1)' })],
    ])('ignores a link with %s', (label, link) => {
        const { store } = makeStore();
        const { state } = store.begin(null);
        expect(store.receive(link(state))).toBe(false);
        expect(store.peek()).toBeNull();
    });

    it('ignores every link when no sign-in was started', () => {
        const { store } = makeStore();
        expect(store.receive({ code: 'c', state: 'guess', workspace: ABB })).toBe(false);
    });

    it('takes one link per sign-in', () => {
        const { store } = makeStore();
        const { state } = store.begin(null);
        expect(store.receive({ code: 'c1', state, workspace: ABB })).toBe(true);
        expect(store.receive({ code: 'c2', state, workspace: 'https://evil.example' })).toBe(false);
        expect(store.take(ABB).code).toBe('c1');
    });

    it('forgets a sign-in after ten minutes, before and after the code arrives', () => {
        const before = makeStore();
        const { state } = before.store.begin(null);
        before.advance(TTL_MS);
        expect(before.store.receive({ code: 'c', state, workspace: ABB })).toBe(false);

        const after = makeStore();
        const started = after.store.begin(null);
        after.store.receive({ code: 'c', state: started.state, workspace: ABB });
        after.advance(TTL_MS);
        expect(after.store.peek()).toBeNull();
        expect(after.store.take(ABB)).toBeNull();
    });

    it('lets a new Sign in replace one still waiting', () => {
        const { store } = makeStore();
        const first = store.begin(null);
        const second = store.begin(null);
        expect(store.receive({ code: 'c', state: first.state, workspace: ABB })).toBe(false);
        expect(store.receive({ code: 'c', state: second.state, workspace: ABB })).toBe(true);
    });
});

describe('a browser sign-in started on a known workspace', () => {
    it('keeps the workspace it started on, whatever the link names', () => {
        const { store } = makeStore();
        const { state } = store.begin(ABB);
        store.receive({ code: 'c', state, workspace: 'https://other.example' });
        expect(store.peek()).toEqual({ workspace: ABB });
    });

    it('still takes a link without a state from a server older than the finder', () => {
        const { store } = makeStore();
        store.begin(ABB);
        expect(store.receive({ code: 'c', userId: 'u' })).toBe(true);
        expect(store.take(ABB)).toMatchObject({ code: 'c', userId: 'u' });
    });
});

describe('reading an authorize link', () => {
    it('reads the code, user, state and workspace', () => {
        expect(authorizeParams('alianhub-tracker://authorize/?client_id=u1&code=c%2B1&state=s1&workspace=https%3A%2F%2Fabb.alianhub.com')).toEqual({
            code: 'c+1', userId: 'u1', state: 's1', workspace: ABB,
        });
        expect(authorizeParams('myapp://authorize?client_id=u1&code=c1')).toEqual({ code: 'c1', userId: 'u1', state: null, workspace: null });
    });
});
