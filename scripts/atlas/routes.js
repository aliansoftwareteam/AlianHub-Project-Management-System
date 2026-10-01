const PARAM = /:([A-Za-z]+)/g;

const paramsOf = (route) => [...route.split('?')[0].matchAll(PARAM)].map((match) => match[1]);

function resolveRoute(route, params) {
    const missing = paramsOf(route).filter((name) => !params[name]);
    if (missing.length) return { path: null, missing };
    const [pathname, query] = route.split('?');
    const filled = pathname.replace(PARAM, (_, name) => encodeURIComponent(params[name]));
    return { path: query ? `${filled}?${query}` : filled, missing: [] };
}

module.exports = { paramsOf, resolveRoute };
