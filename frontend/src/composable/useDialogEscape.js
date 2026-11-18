import { onBeforeUnmount, unref, watch } from "vue";

/* Open dialogs, outermost first. Escape closes the last one only and stops in the capture
 * phase, so neither a dialog underneath nor the page's own Escape handler sees the key,
 * wherever focus happens to be. */
const openDialogs = [];

function onKeydown(event) {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    openDialogs[openDialogs.length - 1]();
}

export function useDialogEscape(activeRef, close) {
    let entry = null;

    const release = () => {
        if (!entry) return;
        openDialogs.splice(openDialogs.indexOf(entry), 1);
        entry = null;
        if (!openDialogs.length) document.removeEventListener("keydown", onKeydown, true);
    };

    watch(() => Boolean(unref(activeRef)), (active) => {
        if (!active) {
            release();
            return;
        }
        if (entry) return;
        entry = () => close();
        if (!openDialogs.length) document.addEventListener("keydown", onKeydown, true);
        openDialogs.push(entry);
    }, { immediate: true, flush: "sync" });

    onBeforeUnmount(release);
}
