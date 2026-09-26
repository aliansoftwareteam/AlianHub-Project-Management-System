import { ref } from "vue";

/* MaintenanceBanner is the only poller of /health and the only writer; the shell reads it to
 * replace a page whose boot calls were refused. */
export const maintenanceOn = ref(false);
