import { ref } from "vue";
import { getMessaging, getToken } from "firebase/messaging";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

const STORED_TOKEN = "webTokens";

const currentPermission = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
const permission = ref(currentPermission());

/* Shared so a screen opened while the browser's question is still up (the checklist step navigates straight away) updates when it is answered. */
export function browserNotificationPermission () {
    permission.value = currentPermission();
    return permission;
}

const saveWebToken = (userId, webToken) => apiRequestWithoutCompnay("put", env.UPDATE_SESSION, { userId, updateObject: { webToken } });

async function registerWebPush (userId) {
    const user = await apiRequestWithoutCompnay("get", `${env.USER_UPATE}/${userId}`);
    if (user?.status !== 200 || !user.data) return;
    const token = await getToken(getMessaging());
    if (!token || localStorage.getItem(STORED_TOKEN) === token) return;
    await saveWebToken(userId, token);
    localStorage.setItem(STORED_TOKEN, token);
}

async function clearWebPush (userId) {
    if (!localStorage.getItem(STORED_TOKEN)) return;
    await saveWebToken(userId, "");
    localStorage.removeItem(STORED_TOKEN);
}

export function refreshWebPush (userId) {
    if (currentPermission() !== "granted") return;
    registerWebPush(userId).catch((error) => console.error("ERROR in web push token: ", error));
}

/* Call straight from a click: browsers ignore or block a permission request made without a user gesture. */
export async function askForBrowserNotifications (userId) {
    if (currentPermission() !== "default") return;
    permission.value = await Notification.requestPermission();
    const sync = permission.value === "granted" ? registerWebPush : clearWebPush;
    await sync(userId).catch((error) => console.error("ERROR in web push token: ", error));
}
