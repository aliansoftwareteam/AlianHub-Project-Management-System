import { onBeforeUnmount, unref, watch } from 'vue';
import { useStore } from 'vuex';

export const CUSTOM_FIELDS_EVENT = 'customFieldsChanged';

/* The event says only that a definition changed somewhere in the company, so the definitions are read again.
   The socket is passed in: the shell that provides it cannot inject it. */
export function useFieldDefinitionsSync(socket) {
    const { dispatch } = useStore();
    let bound = null;

    const onChanged = () => dispatch('settings/setfinalCustomFields');

    function unbind() {
        bound?.off?.(CUSTOM_FIELDS_EVENT, onChanged);
        bound = null;
    }

    function bind() {
        const live = unref(socket);
        if (live === bound) return;
        unbind();
        if (!live?.on) return;
        bound = live;
        live.on(CUSTOM_FIELDS_EVENT, onChanged);
    }

    watch(() => unref(socket), bind, { immediate: true });
    onBeforeUnmount(unbind);
}
