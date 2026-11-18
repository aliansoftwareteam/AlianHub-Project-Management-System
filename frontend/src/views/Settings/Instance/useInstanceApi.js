import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

const unwrap = (res) => {
    const body = res?.data;
    if (!body || body.status !== true) throw new Error(body?.statusText || "The server did not answer.");
    return body.data;
};

const message = (error) => error?.response?.data?.statusText || error?.message || "Something went wrong.";

/* One place for the Instance pages to talk to /api/v2/instance/*: the session
 * token travels in the Authorization header, so downloads go through fetch
 * rather than a plain link. */
export function useInstanceApi() {
    const get = (url, options) => apiRequestWithoutCompnay("get", url, null, null, options).then(unwrap);
    const post = (url, body = {}) => apiRequestWithoutCompnay("post", url, body).then(unwrap);
    const put = (url, body = {}) => apiRequestWithoutCompnay("put", url, body).then(unwrap);
    const del = (url) => apiRequestWithoutCompnay("delete", url).then(unwrap);

    const download = async (url, filename) => {
        const res = await apiRequestWithoutCompnay("get", url, null, null, { responseType: "blob" });
        const href = URL.createObjectURL(res.data);
        const a = document.createElement("a");
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    };

    const guide = (anchor) => `${env.ADMIN_GUIDE_URL}#${anchor}`;

    return { get, post, put, del, download, message, guide, env };
}

export const formatBytes = (n) => {
    if (!Number.isFinite(n)) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
};

export const formatWhen = (value) => (value ? new Date(value).toLocaleString() : "—");
