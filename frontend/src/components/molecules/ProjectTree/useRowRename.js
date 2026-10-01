import { nextTick, onMounted, ref } from "vue";
import { useToast } from "vue-toast-notification";

/* A tree row's name edited in place: Enter saves, Escape or leaving the field cancels.
   `check(wanted)` answers why the name cannot be used, or nothing; `save(wanted)` answers { ok, message }. */
export function useRowRename({ current, check, save, fallbackMessage, done }) {
    const $toast = useToast();
    const input = ref(null);
    const name = ref(current);
    const saving = ref(false);
    let over = false;

    const complain = (message) => $toast.error(message, { position: "top-right" });

    function finish() {
        if (over) return;
        over = true;
        done();
    }

    function cancel() {
        if (!saving.value) finish();
    }

    async function submit() {
        const wanted = name.value.trim();
        if (wanted === current) return finish();
        const problem = check(wanted);
        if (problem) return complain(problem);

        saving.value = true;
        const result = await save(wanted);
        saving.value = false;
        if (!result.ok) {
            complain(result.message || fallbackMessage());
            return nextTick(() => input.value?.focus());
        }
        return finish();
    }

    function onKeydown(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            submit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            finish();
        }
    }

    onMounted(() => {
        input.value?.focus();
        input.value?.select();
    });

    return { input, name, saving, cancel, onKeydown };
}
