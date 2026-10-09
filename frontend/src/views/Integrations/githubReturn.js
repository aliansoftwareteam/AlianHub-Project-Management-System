export const GITHUB_RETURN_KEYS = ["github", "state", "code"];

export const withoutGithubReturn = (query = {}) => Object.fromEntries(Object.entries(query).filter(([key]) => !GITHUB_RETURN_KEYS.includes(key)));

/* A lapsed session sends the address on to the login page; a GitHub code and state must not travel with it. */
export const loginReturnPath = (to) => {
    if (!to.query || !to.query.github) return to.fullPath;
    const rest = new URLSearchParams();
    for (const [key, value] of Object.entries(withoutGithubReturn(to.query))) {
        for (const one of [].concat(value)) rest.append(key, one === null ? "" : one);
    }
    const qs = rest.toString();
    return `${to.path}${qs ? `?${qs}` : ""}`;
};
