import { isDesktopShell } from "@/serviceWorker/registration";

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;
const SCRIPT_URL = "https://www.googletagmanager.com/gtag/js";

let started = false;
let pending = null;
let target = null;

/* Hash routing hides the route from GA, and the query string carries sign-in, reset and referral
 * tokens, so GA only ever gets the origin plus the route path, never the address bar. */
export const pagePathOf = (path) => String(path || "/").split(/[?#]/)[0] || "/";

/* The filled-in path holds workspace, project and task ids; GA gets the route's pattern instead. */
export const routePatternOf = (route) => {
    const matched = Array.isArray(route?.matched) ? route.matched : [];
    const record = matched[matched.length - 1];
    return record?.path || (route?.name ? `/${String(route.name)}` : "/");
};
export const pageLocationOf = (path, origin) => `${origin}${pagePathOf(path)}`;

const send = (win, path, name) => {
    win.gtag("event", "page_view", { page_location: pageLocationOf(path, win.location.origin), page_path: pagePathOf(path), route_name: name || "" });
};

export function startAnalytics(measurementId, win = typeof window === "undefined" ? null : window) {
    try {
        if (started || !win || !MEASUREMENT_ID.test(String(measurementId || ""))) return false;
        if (isDesktopShell(win.navigator?.userAgent)) return false;
        started = true;
        target = win;
        win.dataLayer = win.dataLayer || [];
        // gtag.js reads Arguments objects off the data layer; an array is ignored.
        win.gtag = function gtag() { win.dataLayer.push(arguments); };
        win.gtag("js", new Date());
        win.gtag("config", measurementId, {
            send_page_view: false,
            page_location: pageLocationOf(pending?.path, win.location.origin),
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
        });
        const script = win.document.createElement("script");
        script.async = true;
        script.src = `${SCRIPT_URL}?id=${encodeURIComponent(measurementId)}`;
        script.onerror = () => {};
        win.document.head.appendChild(script);
        if (pending) send(win, pending.path, pending.name);
        pending = null;
        return true;
    } catch {
        return false;
    }
}

export function trackPageView(route) {
    try {
        if (!route) return;
        const path = routePatternOf(route);
        if (!started) {
            pending = { path, name: route.name };
            return;
        }
        send(target, path, route.name);
    } catch {
        // Analytics must never break navigation.
    }
}

export function resetAnalyticsForTests() {
    started = false;
    pending = null;
    target = null;
}
