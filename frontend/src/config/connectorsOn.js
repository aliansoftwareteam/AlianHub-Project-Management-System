import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";
import { applyPublicConfig, publicConfig } from "@/config/publicConfig";

let reading = null;

/* The connector routes exist only where the server switched a connector on, so asking them anywhere else answers
 * 404. The public config says which, and a page can mount before App.vue has read it. */
export async function connectorsOn() {
    if (!publicConfig.loaded) {
        reading = reading || Promise.resolve()
            .then(() => apiRequestWithoutSecure("get", env.INSTANCE_PUBLIC_CONFIG))
            .then((res) => applyPublicConfig(res?.data?.data || {}))
            .catch(() => null)
            .finally(() => { reading = null; });
        await reading;
    }
    return publicConfig.connectors === true;
}
