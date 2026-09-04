exports.pickKnownApps = (keys, catalog) => {
    const known = new Set((catalog || []).map((app) => app.key));
    return Array.from(new Set((keys || []).filter((key) => known.has(key))));
};
