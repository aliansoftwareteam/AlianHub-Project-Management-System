import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { errorKey, fieldOf, refusalKey } from "./goalRequest";

const TOAST = { position: "top-right" };
const SAID = { conflict: "Goals.conflict", forbidden: "Goals.not_allowed" };

/* A refusal that names a field goes back to the form that asked, to show on that field, with the
   server's reason and the sources at fault when it gave them. Any other is said in a toast, except
   a goal that has gone: the page says that once and closes its panel. */
export function useGoalWrite() {
    const store = useStore();
    const { t } = useI18n();
    const toast = useToast();

    async function write(action, payload, { messages = {} } = {}) {
        try {
            return { ok: true, goal: await store.dispatch(`goals/${action}`, payload) };
        } catch (error) {
            if (error.kind === "field") {
                const field = fieldOf(error.field);
                const byField = errorKey(error.field);
                const key = refusalKey(error) === byField ? messages[field] || byField : refusalKey(error);
                return { ok: false, field, code: error.code || "", sources: error.sources || null, pointer: error.field, message: t(key) };
            }
            if (error.kind !== "missing") toast.error(t(SAID[error.kind] || "Goals.save_failed"), TOAST);
            return { ok: false, field: "", code: "", sources: null, pointer: "", message: "" };
        }
    }

    return { write };
}
