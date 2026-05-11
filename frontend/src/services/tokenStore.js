/**
 * Token store (BUG-006 / #60 fix).
 *
 * Before: access/refresh tokens lived in a cookie with `httpOnly: false`,
 * so any DOM XSS or browser extension could read them via `document.cookie`.
 *
 * Now: the backend sets the cookie as `httpOnly: true` (server-only) and
 * also returns both tokens in the login JSON response. The frontend keeps
 * its copy in sessionStorage so subsequent requests can attach the
 * Authorization header. sessionStorage is per-tab and cleared on tab close,
 * which is the closest match to the previous behaviour without exposing
 * the cookie to JavaScript.
 *
 * Note: sessionStorage is still readable from any JS in this origin, so a
 * stored-XSS payload could exfiltrate tokens from here just like before.
 * The cookie hardening is the in-scope change for BUG-006; a follow-up can
 * move all auth to the HttpOnly cookie via `withCredentials: true` so the
 * frontend stops storing the token at all.
 */
import Cookies from 'js-cookie';

const ACCESS_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';

const safeStorage = () => {
    if (typeof window === 'undefined') return null;
    try { return window.sessionStorage; } catch (_) { return null; }
};

const read = (key) => {
    const s = safeStorage();
    if (!s) return '';
    return s.getItem(key) || '';
};

const write = (key, value) => {
    const s = safeStorage();
    if (!s) return;
    if (value) s.setItem(key, value);
    else s.removeItem(key);
};

export const tokenStore = {
    getAccessToken() { return read(ACCESS_KEY); },
    getRefreshToken() { return read(REFRESH_KEY); },

    setAccessToken(token) { write(ACCESS_KEY, token || ''); },
    setRefreshToken(token) { write(REFRESH_KEY, token || ''); },

    setTokens({ accessToken, refreshToken } = {}) {
        if (accessToken !== undefined) this.setAccessToken(accessToken);
        if (refreshToken !== undefined) this.setRefreshToken(refreshToken);
    },

    clear() {
        write(ACCESS_KEY, '');
        write(REFRESH_KEY, '');
        // Also remove the legacy JS-readable cookies if any lingering pre-fix
        // session still has them set, so we don't return stale values from
        // any code path that still calls Cookies.get directly.
        try { Cookies.remove(ACCESS_KEY); } catch (_) { /* noop */ }
        try { Cookies.remove(REFRESH_KEY); } catch (_) { /* noop */ }
    },
};

export default tokenStore;
