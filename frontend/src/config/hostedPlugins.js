import { watch } from "vue";
import { isManagedHosting, publicConfig } from "@/config/publicConfig";

/* A hosted plan is bought in the AlianHub account, so the in-app billing plugins never register
 * there. Whether this instance is hosted is known only once the public config has answered. */
export function installUnlessHosted(app, plugins) {
    const install = () => {
        if (!isManagedHosting()) plugins.forEach((plugin) => app.use(plugin));
    };
    if (publicConfig.loaded) {
        install();
        return;
    }
    const stop = watch(() => publicConfig.loaded, (loaded) => {
        if (!loaded) return;
        stop();
        install();
    });
}
