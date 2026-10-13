import { reactive } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useCustomComposable } from "@/composable";
import { mutateArrangeProjectRules } from "@/store/Settings/mutations";

/* Project-specific permissions live in one store slot that belongs to the project on screen,
 * so any other project's rules are read into a local copy instead of replacing that slot. */
export function useOtherProjectRules() {
    const { getters } = useStore();
    const { checkPermission } = useCustomComposable();
    const rules = reactive({});

    const inStore = (pid) => (getters["settings/projectRawRules"] || []).some((r) => String(r.projectId) === String(pid));

    function check(path, project) {
        if (project.isGlobalPermission !== false) return checkPermission(path, true);
        if (inStore(project._id)) return checkPermission(path, false);
        const own = rules[project._id];
        if (!own) return null;
        return checkPermission(path, false, {
            gettersVal: { "settings/companyUserDetail": getters["settings/companyUserDetail"], "settings/projectRules": own, "settings/rules": getters["settings/rules"] }
        });
    }

    function load(project) {
        const pid = String(project._id);
        if (rules[pid] || inStore(pid)) return Promise.resolve();
        return apiRequest("get", `${env.PROJECTRULES}/${pid}`)
            .then((res) => {
                const scratch = {};
                mutateArrangeProjectRules(scratch, { op: "added", data: Array.isArray(res?.data) ? res.data : [], projectId: pid });
                rules[pid] = scratch.projectRules || {};
            })
            .catch((e) => console.error("ERROR loading project rules: ", e));
    }

    const loadAll = (projects) => Promise.all((projects || []).filter((p) => p.isGlobalPermission === false).map(load));

    return { check, load, loadAll };
}
