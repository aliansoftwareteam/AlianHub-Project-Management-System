import { readonly, ref } from "vue";
import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";
import { version as packageVersion } from "../../../package.json";

const version = ref(packageVersion);
let pending = null;

/* package.json only moves when release-please cuts a release, so the running
 * build label has to come from the server; the bundled version stays as the
 * answer when an older backend has no /version route. */
export function fetchAppVersion() {
    if (!pending) {
        pending = apiRequestWithoutSecure("get", env.APP_VERSION)
            .then((res) => {
                const data = res?.data?.status === true ? res.data.data : null;
                return data && data.version ? data : { version: packageVersion };
            })
            .catch(() => ({ version: packageVersion }))
            .then((info) => {
                version.value = info.version;
                return info;
            });
    }
    return pending;
}

export function useAppVersion() {
    fetchAppVersion();
    return { version: readonly(version) };
}
