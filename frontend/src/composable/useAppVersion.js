import { computed, readonly, ref } from "vue";
import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";
import { version as packageVersion } from "../../../package.json";
import { sourceCodeUrl } from "./sourceCode";

const version = ref(packageVersion);
const info = ref({ version: packageVersion, release: packageVersion });
const sourceUrl = computed(() => sourceCodeUrl(info.value));
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
            .then((answer) => {
                version.value = answer.version;
                info.value = { release: answer.version, ...answer };
                return answer;
            });
    }
    return pending;
}

export function useAppVersion() {
    fetchAppVersion();
    return { version: readonly(version), sourceUrl };
}
