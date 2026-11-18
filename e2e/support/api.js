/* A thin wrapper over the global fetch: every call resolves to { status, body, headers }
 * and never throws on a 4xx/5xx, so a test can assert on a refusal directly. */
function createApiClient({ baseURL, accessToken = null, companyId = null } = {}) {
    if (!baseURL) throw new Error('createApiClient needs a baseURL');

    async function request(method, urlPath, { body, headers = {}, query } = {}) {
        const url = new URL(urlPath, baseURL);
        for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
        const finalHeaders = { accept: 'application/json', ...headers };
        if (accessToken) finalHeaders.authorization = `Bearer ${accessToken}`;
        if (companyId) finalHeaders.companyid = companyId;
        if (body !== undefined) finalHeaders['content-type'] = 'application/json';

        const res = await fetch(url, { method, headers: finalHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await res.text();
        let parsed = text;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {}
        return { status: res.status, body: parsed, headers: res.headers };
    }

    return {
        baseURL,
        accessToken,
        companyId,
        request,
        get: (urlPath, options) => request('GET', urlPath, options),
        post: (urlPath, body, options) => request('POST', urlPath, { ...options, body }),
        put: (urlPath, body, options) => request('PUT', urlPath, { ...options, body }),
        patch: (urlPath, body, options) => request('PATCH', urlPath, { ...options, body }),
        delete: (urlPath, options) => request('DELETE', urlPath, options),
        withCompany: (otherCompanyId) => createApiClient({ baseURL, accessToken, companyId: otherCompanyId }),
    };
}

module.exports = { createApiClient };
