import * as env from "@/config/env";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import { storageQueryBuilder } from "@/utils/storageQueryBuild";

const PROFILE_BUCKET = "USER_PROFILES";
const TTL_MS = 5 * 60 * 1000;

const cache = new Map();

/* A stored profile picture is a bare file name. The browser would read it as a path
 * under the site root, so only a signed URL may ever reach an img src. */
export function isStoredProfilePath(value) {
    return typeof value === "string" && value !== "" && !value.includes("/") && !/^(data|blob|https?):/i.test(value);
}

function fetchSignedUrl(path, companyId) {
    if (env.STORAGE_TYPE === "server") {
        const query = storageQueryBuilder("get", PROFILE_BUCKET, path);
        return apiRequest(query.method, query.route).then((response) => response?.data?.url || "");
    }
    return apiRequestWithoutCompnay("get", `${env.WASABI_RETRIVE_USER_PROFILE}/${companyId}/${path}`, { companyId, path })
        .then((response) => (response?.data?.status === true ? response.data.statusText || "" : ""));
}

/* Rows that show the same person share one request; a failed one is not remembered. */
export function signedProfileUrl(path, companyId = "") {
    const key = `${companyId}/${path}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const promise = fetchSignedUrl(path, companyId);
    cache.set(key, { at: Date.now(), promise });
    promise.catch(() => cache.delete(key));
    return promise;
}

export function clearSignedProfileUrls() {
    cache.clear();
}
