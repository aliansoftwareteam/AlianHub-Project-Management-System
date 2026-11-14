import { beforeEach, describe, expect, it } from "vitest";
import { pageLocationOf, resetAnalyticsForTests, routePatternOf, startAnalytics, trackPageView } from "@/utils/analytics";

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0) AlianHub/3.0 Chrome/130.0 Electron/33.0.0 Safari/537.36";

const fakeWindow = (userAgent = BROWSER) => {
    const appended = [];
    return {
        appended,
        location: { origin: "https://app.example.com", href: "https://app.example.com/?code=secret#/reset-password?token=abc" },
        navigator: { userAgent },
        document: { head: { appendChild: (el) => appended.push(el) }, createElement: () => ({}) },
    };
};

const events = (win) => win.dataLayer.map((args) => Array.from(args)).filter(([kind]) => kind === "event");

describe("Google Analytics", () => {
    beforeEach(() => resetAnalyticsForTests());

    it("does nothing without a valid id", () => {
        for (const id of [undefined, "", "UA-1234-1", "G-<script>"]) {
            const win = fakeWindow();
            expect(startAnalytics(id, win)).toBe(false);
            expect(win.appended).toHaveLength(0);
            expect(win.dataLayer).toBeUndefined();
        }
    });

    it("does nothing in the desktop app", () => {
        const win = fakeWindow(DESKTOP);
        expect(startAnalytics("G-ABCDEF12", win)).toBe(false);
        expect(win.appended).toHaveLength(0);
    });

    it("loads gtag.js once with page views, signals and ad personalisation off", () => {
        const win = fakeWindow();
        expect(startAnalytics("G-ABCDEF12", win)).toBe(true);
        expect(startAnalytics("G-ABCDEF12", win)).toBe(false);
        expect(win.appended).toHaveLength(1);
        expect(win.appended[0].src).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABCDEF12");
        const config = win.dataLayer.map((args) => Array.from(args)).find(([kind]) => kind === "config");
        expect(config[1]).toBe("G-ABCDEF12");
        expect(config[2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
        expect(config[2].page_location).not.toMatch(/code|token|#/);
    });

    it("sends the route pattern, never workspace, project or task ids, a query string or a fragment", () => {
        const win = fakeWindow();
        startAnalytics("G-ABCDEF12", win);
        trackPageView({ path: "/6512ab/project/88f/list", name: "ProjectList", matched: [{ path: "/:cid" }, { path: "/:cid/project/:id/list" }] });
        trackPageView({ path: "/reset-password?token=abc#x", name: "ResetPassword", matched: [{ path: "/reset-password" }] });
        expect(events(win)).toEqual([
            ["event", "page_view", { page_location: "https://app.example.com/:cid/project/:id/list", page_path: "/:cid/project/:id/list", route_name: "ProjectList" }],
            ["event", "page_view", { page_location: "https://app.example.com/reset-password", page_path: "/reset-password", route_name: "ResetPassword" }],
        ]);
        expect(JSON.stringify(events(win))).not.toMatch(/6512ab|88f|token/);
    });

    it("falls back to the route name, never the filled-in path, when no record matched", () => {
        expect(routePatternOf({ path: "/6512ab/x", name: "Home" })).toBe("/Home");
        expect(routePatternOf({ path: "/6512ab/x" })).toBe("/");
    });

    it("holds the first page view until the config arrives", () => {
        const win = fakeWindow();
        trackPageView({ path: "/login", name: "Log-in", matched: [{ path: "/login" }] });
        startAnalytics("G-ABCDEF12", win);
        expect(events(win)).toEqual([["event", "page_view", { page_location: "https://app.example.com/login", page_path: "/login", route_name: "Log-in" }]]);
    });

    it("never throws from tracking", () => {
        expect(() => trackPageView(undefined)).not.toThrow();
        expect(() => trackPageView({ path: "/x" })).not.toThrow();
        expect(pageLocationOf("", "https://a.test")).toBe("https://a.test/");
    });
});
