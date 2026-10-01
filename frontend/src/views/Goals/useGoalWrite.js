import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { errorKey, fieldOf } from "./goalRequest";

const TOAST = { position: "top-right" };
const SAID = { conflict: "Goals.conflict", forbidden: "Goals.not_allowed" };

/* A refusal that names a field goes back to the form that asked, to show on that field. Any other
   is said in a toast, except a goal that has gone: the page says that once and closes its panel. */
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
                return { ok: false, field, message: t(messages[field] || errorKey(error.field)) };
            }
            if (error.kind !== "missing") toast.error(t(SAID[error.kind] || "Goals.save_failed"), TOAST);
            return { ok: false, field: "", message: "" };
        }
    }

    return { write };
}
