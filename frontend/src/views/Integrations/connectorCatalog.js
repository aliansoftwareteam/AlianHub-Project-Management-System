export const SIGN_IN = Object.freeze({ OAUTH: "oauth", TOKEN: "token" });
/* The Google Calendar connector from before the registry, with a card and a return of its own until task 077. */
export const LEGACY_GOOGLE_CONNECTOR = "google_calendar";
export const OTHER_CATEGORY = "other";
export const ALL_CATEGORIES = "all";

/* A provider the server adds later lands in "other" until it is given a category here. */
export const CATEGORY_OF = Object.freeze({
    google: "productivity",
    wisprflow: "productivity",
    slack: "communication",
    notion: "docs",
    dropbox: "files",
    github: "development",
    supabase: "development",
    hubspot: "sales",
    upwork: "work",
    canva: "design",
});

export const categoryOf = (provider) => CATEGORY_OF[provider] || OTHER_CATEGORY;

const ATTENTION = ["broken", "reauth_required"];
export const needsAttention = (row) => Boolean(row && row.connection && ATTENTION.includes(row.connection.status));

export const statusDot = (row) => (needsAttention(row) ? "ah-dot--warn" : "ah-dot--ok");

export const connectorRows = (data = {}) => {
    const held = new Map((data.connections || []).filter((conn) => conn && conn.connected).map((conn) => [conn.provider, conn]));
    const offered = (data.providers || []).map((entry) => ({
        provider: entry.provider,
        products: entry.products || [],
        signIn: entry.signIn || [],
        connection: held.get(entry.provider) || null,
    }));
    return {
        mine: offered.filter((row) => row.connection),
        browse: offered.filter((row) => !row.connection),
        unavailable: (data.unavailable || []).map((entry) => ({ provider: entry.provider })),
    };
};

export const sortMine = (rows, nameOf) => [...rows].sort((a, b) => {
    const attention = Number(needsAttention(b)) - Number(needsAttention(a));
    return attention || String(nameOf(a.provider)).localeCompare(String(nameOf(b.provider)));
});

/* `textOf(row)` gives the words a person sees on the card: its name, its one line and its category. */
export const filterBrowse = (rows, { query = "", category = ALL_CATEGORIES } = {}, textOf = () => []) => {
    const words = String(query).trim().toLowerCase();
    return rows.filter((row) => {
        if (category !== ALL_CATEGORIES && categoryOf(row.provider) !== category) return false;
        return !words || textOf(row).some((text) => String(text || "").toLowerCase().includes(words));
    });
};

export const categoriesIn = (rows) => [...new Set(rows.map((row) => categoryOf(row.provider)))].sort();

export const initialsOf = (name) => String(name || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "?";

export const takesToken = (row) => (row.signIn || []).includes(SIGN_IN.TOKEN);
export const takesOauth = (row) => (row.signIn || []).includes(SIGN_IN.OAUTH);

export const asksBeforeConnect = (row) => takesToken(row) || (takesOauth(row) && (row.products || []).length > 1);

export const toolsOffAfter = (current, key, on) => {
    const without = (current || []).filter((value) => value !== key);
    return on ? without : [...without, key];
};
