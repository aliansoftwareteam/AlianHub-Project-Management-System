/* The tracker opens its sign-in page with a query, so the first segment ends at "?" as well as at "/". */
const firstSegment = (path) => String(path || '').split(/[/?#]/)[1] || '';

export const returnsInto = (path, companyIds) => {
    const segment = String(path || '').startsWith('/') ? firstSegment(path) : '';
    return segment === 'oauth2' || Boolean(segment && companyIds?.includes(segment));
};

const KEY = 'loginReturnPath';

/* GitHub and GitLab send the browser back to the origin alone, without the path it was signing in for. */
export const rememberReturnPath = (path) => {
    if (path) sessionStorage.setItem(KEY, path);
    else sessionStorage.removeItem(KEY);
};

export const takeReturnPath = () => {
    const path = sessionStorage.getItem(KEY) || '';
    sessionStorage.removeItem(KEY);
    return path;
};
