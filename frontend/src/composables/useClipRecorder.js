// Shared, module-scoped singleton state for the GLOBAL clip recorder.
//
// The recorder is mounted ONCE at the app shell (Header.vue) so an in-progress
// recording survives in-app navigation (opening/closing a task, route changes).
// Any component can drive it through these helpers — they all share the one
// reactive `state` object below because the module is evaluated only once.
//
// Usage:
//   import { useClipRecorder } from "@/composables/useClipRecorder";
//   const { openRecorder } = useClipRecorder();
//   openRecorder();                                  // library-only clip
//   openRecorder({ type: 'task', taskId, ... }, cb); // record + attach to task
import { reactive } from "vue";

// reactive: drives the recorder's `v-if="open"` + lets it read the target.
const state = reactive({
    open: false,
    // `null` => library-only clip; otherwise an opener-provided descriptor
    // (e.g. { type: 'task', taskId, projectId, ... }) the recorder passes back
    // to onSaved so the opener can decide what to do with the saved clip.
    target: null,
});

// Kept OUTSIDE the reactive object on purpose: a function reference doesn't need
// to be reactive, and stashing it here avoids needless reactivity churn.
let onSavedCallback = null;

// Open the recorder. `target` describes the context (null for library-only);
// `onSaved(clipRecord)` is invoked after a clip is successfully uploaded +
// recorded, so e.g. a task can attach the resulting clip to itself.
function openRecorder(target = null, onSaved = null) {
    state.target = target || null;
    onSavedCallback = typeof onSaved === "function" ? onSaved : null;
    state.open = true;
}

// Close the recorder and clear per-session context.
function closeRecorder() {
    state.open = false;
    state.target = null;
    onSavedCallback = null;
}

// Read the stored saved-callback (the recorder calls this after saving).
function getOnSaved() {
    return onSavedCallback;
}

export function useClipRecorder() {
    return {
        state,
        openRecorder,
        closeRecorder,
        getOnSaved,
    };
}
