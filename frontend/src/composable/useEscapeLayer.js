import { onBeforeUnmount, unref, watch } from "vue";

/* Pickers, date pickers and sheets that float over a surface register here, so a host
 * with its own Esc (the task panel) can close the innermost one instead of itself. */
const stack = [];
let sequence = 0;

export function pushEscapeLayer(close) {
    sequence += 1;
    const entry = { close, seq: sequence };
    stack.push(entry);
    return () => {
        const index = stack.indexOf(entry);
        if (index !== -1) stack.splice(index, 1);
    };
}

export function escapeLayerMark() {
    return sequence;
}

export function hasEscapeLayer({ after = -1 } = {}) {
    const top = stack[stack.length - 1];
    return Boolean(top) && top.seq > after;
}

export function closeTopEscapeLayer({ after = -1 } = {}) {
    if (!hasEscapeLayer({ after })) return false;
    const top = stack.pop();
    top.close();
    return true;
}

export function useEscapeLayer(openSource, close) {
    let remove = null;
    const release = () => {
        if (remove) remove();
        remove = null;
    };
    watch(() => Boolean(typeof openSource === "function" ? openSource() : unref(openSource)), (open) => {
        if (open && !remove) remove = pushEscapeLayer(close);
        else if (!open) release();
    }, { immediate: true, flush: "sync" });
    onBeforeUnmount(release);
}
