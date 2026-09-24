import { closeTopEscapeLayer, hasEscapeLayer } from "@/composable/useEscapeLayer";

// Keys typed inside these belong to them: they close themselves on Esc.
const OWN_LAYERS = ".modal, .swal2-container, .sidebar-main, #my-sidebar, .dp__menu, [role=\"menu\"], [role=\"listbox\"]";
const TEXT_ENTRY = "textarea, select, [role=\"textbox\"], input:not([type=\"checkbox\"]):not([type=\"radio\"]):not([type=\"button\"]):not([type=\"submit\"]):not([type=\"reset\"])";

function escapeStep(event, panel, mark) {
    if (event.defaultPrevented) return "ignore";
    const target = event.target && event.target.nodeType === 1 ? event.target : null;
    if (target && target.closest(OWN_LAYERS)) return "ignore";
    if (hasEscapeLayer({ after: mark })) return "layer";
    const typing = target && (target.isContentEditable || target.matches(TEXT_ENTRY));
    if (typing && panel && panel.contains(target)) return "blur";
    return "close";
}

/* Esc closes the innermost open thing: a picker or date picker opened over the panel,
 * then a text field (left with its text, never cleared), and only then the panel. */
export function handlePanelEscape(event, { panel, close, mark = -1 }) {
    const step = escapeStep(event, panel, mark);
    if (step === "layer") {
        event.preventDefault();
        closeTopEscapeLayer({ after: mark });
    } else if (step === "blur") {
        event.preventDefault();
        event.target.blur();
        panel.focus({ preventScroll: true });
    } else if (step === "close") {
        close();
    }
    return step;
}
