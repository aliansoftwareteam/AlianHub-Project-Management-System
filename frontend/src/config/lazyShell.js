import { defineAsyncComponent } from 'vue';
import { useToast } from 'vue-toast-notification';
import { i18n } from '@/locales/main';

export const notifyLoadFailure = () => useToast().error(i18n.global.t('generalErrorMessage.something_went_wrong'));

/* A part of the shell that opens on a key or a click and draws nothing until then, so it has no
 * loading state of its own. A failed fetch shows the app's general error toast; the rejection still
 * reaches chunkRecovery, which reloads once to pick up the current build. */
export const lazyShellPart = (loader) => defineAsyncComponent({
    loader,
    onError: (error, retry, fail) => {
        notifyLoadFailure();
        fail();
    }
});
