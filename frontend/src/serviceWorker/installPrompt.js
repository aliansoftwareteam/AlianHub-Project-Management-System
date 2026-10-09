import { ref } from 'vue';

export const installAvailable = ref(false);

let offer = null;

export const isStandalone = (win) => Boolean((win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || (win.navigator && win.navigator.standalone));

/* Call before the app mounts: the browser fires beforeinstallprompt once, early. Holding the event
 * back also stops the browser's own install bar, so the only offer is the entry in the profile menu. */
export const watchInstallPrompt = (win = window) => {
    win.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        offer = event;
        installAvailable.value = !isStandalone(win);
    });
    win.addEventListener('appinstalled', () => {
        offer = null;
        installAvailable.value = false;
    });
};

// A browser lets an offer be used once.
export const promptInstall = async () => {
    const event = offer;
    offer = null;
    installAvailable.value = false;
    if (event) await event.prompt();
};

export const resetInstallPrompt = () => {
    offer = null;
    installAvailable.value = false;
};
