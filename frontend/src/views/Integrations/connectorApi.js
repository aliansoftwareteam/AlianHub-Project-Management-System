import { apiRequest } from "@/services";
import * as env from "@/config/env";

export class ConnectorRequestError extends Error {
    constructor(message, code) {
        super(message || "");
        this.name = "ConnectorRequestError";
        this.code = code || "";
    }
}

/* The server's own words are kept as the message; a caller shows its translated fallback when there are none. */
const send = async (method, url, body) => {
    let res;
    try {
        res = await apiRequest(method, url, body);
    } catch (error) {
        const answer = error?.response?.data || {};
        throw new ConnectorRequestError(answer.statusText, answer.code);
    }
    if (!res?.data?.status) throw new ConnectorRequestError(res?.data?.statusText, res?.data?.code);
    return res.data.data;
};

const base = () => env.CONNECTORS;

export const connectorApi = {
    list: () => send("get", base()),
    connect: (provider, products) => send("post", `${base()}/${provider}/connect`, { products }),
    complete: (provider, state, code) => send("post", `${base()}/${provider}/complete`, { state, code }),
    saveToken: (provider, token) => send("post", `${base()}/${provider}/token`, { token }),
    setProducts: (connectionId, products) => send("put", `${base()}/connections/${connectionId}/products`, { products }),
    disconnect: (connectionId) => send("delete", `${base()}/connections/${connectionId}`),
    connectionTools: (connectionId) => send("get", `${base()}/connections/${connectionId}/tools`),
    setTool: (connectionId, key, change) => send("put", `${base()}/connections/${connectionId}/tools/${encodeURIComponent(key)}`, change),
    setSwitch: (provider, on) => send("put", `${base()}/switches/${provider}`, { on }),
};

export const goToConsent = (url) => { if (url) window.location.assign(url); };
