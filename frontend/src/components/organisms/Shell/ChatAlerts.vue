<template>
    <teleport to="body">
        <section class="ah-chat-alerts" :aria-label="$t('Chat.alerts_region')" aria-live="polite">
            <transition-group name="ah-chat-alert">
                <div
                    v-for="alert in alerts"
                    :key="alert.commentId"
                    class="ah-chat-alert"
                    @mouseenter="hold(alert)"
                    @mouseleave="release(alert)"
                    @focusin="hold(alert)"
                    @focusout="release(alert)"
                >
                    <button type="button" class="ah-chat-alert__open" @click="openConversation(alert)">
                        <UserProfile decorative :showDot="false" :data="{ image: alert.image, title: alert.sender }" width="32px" :thumbnail="'35x35'" />
                        <span class="ah-chat-alert__text">
                            <strong class="ah-chat-alert__title">{{ alert.title }}</strong>
                            <span class="ah-chat-alert__body">{{ alert.body }}</span>
                        </span>
                    </button>
                    <button type="button" class="ah-chat-alert__close" :aria-label="$t('Chat.alert_dismiss')" @click="dismiss(alert)">
                        <ShellIcon name="x" :size="14" />
                    </button>
                </div>
            </transition-group>
        </section>
    </teleport>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import ShellIcon from "./ShellIcon.vue";
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import { useGetterFunctions } from "@/composable";
import { isDnd } from "@/components/molecules/Home/homeState";
import { firebaseConfigured } from "@/config/firebaseInit";
import { useChatAccess } from "./chatUnread";
import { isLookingAt, describeNotice } from "./chatAlerts";

defineOptions({ name: "ChatAlerts" });

const SHOW_MS = 6000;
const MAX_SHOWN = 3;
const REMEMBERED = 50;
const NOTICE_EVENT = "chatMessageNotice";
const BRAND_ICON = "/api/v1/getlogo?key=favicon";

const { getters } = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { getUser } = useGetterFunctions();
const companyId = inject("$companyId");
const userId = inject("$userId");
const { canOpenChat, canReadDirect } = useChatAccess();

const alerts = ref([]);
const timers = new Map();
const seen = [];

const socket = computed(() => getters["settings/getSocketInstance"]);
const me = computed(() => getUser(userId.value) || {});

const visible = () => document.visibilityState === "visible";

/* Firebase already shows a background notice in a browser that registered for it; showing one here too would double it. */
function pushRegisteredHere() {
    if (!firebaseConfigured) return false;
    try {
        return Boolean(localStorage.getItem("webTokens"));
    } catch {
        return false;
    }
}

function wantsBrowserNotice(notice) {
    if (notice.browser === false || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    if (visible() && document.hasFocus()) return false;
    return !pushRegisteredHere();
}

function forget(alert) {
    clearTimeout(timers.get(alert.commentId));
    timers.delete(alert.commentId);
}

function dismiss(alert) {
    forget(alert);
    alerts.value = alerts.value.filter((shown) => shown.commentId !== alert.commentId);
}

function release(alert) {
    forget(alert);
    timers.set(alert.commentId, setTimeout(() => dismiss(alert), SHOW_MS));
}

function hold(alert) {
    forget(alert);
}

function openConversation(alert) {
    dismiss(alert);
    router.push({ name: "chat_project_channel", params: { cid: companyId.value, pid: alert.projectId, sid: alert.conversationId } });
}

function showPopUp(alert) {
    alerts.value = [alert, ...alerts.value];
    alerts.value.slice(MAX_SHOWN).forEach(dismiss);
    release(alert);
}

function showBrowserNotice(alert) {
    try {
        const shown = new Notification(alert.title, { body: alert.body, tag: `chat-${alert.commentId}`, icon: BRAND_ICON });
        shown.onclick = () => {
            window.focus();
            openConversation(alert);
            shown.close();
        };
    } catch (error) {
        // Phone browsers only show notifications from a service worker; the badge still tells them.
    }
}

function onNotice(notice) {
    if (!notice || !notice.commentId || seen.includes(notice.commentId)) return;
    seen.push(notice.commentId);
    if (seen.length > REMEMBERED) seen.shift();
    if (String(notice.senderId) === String(userId.value) || !canOpenChat.value) return;
    if (!notice.channel && !canReadDirect.value) return;
    if (isLookingAt(route, notice) && visible()) return;
    if (isDnd() || me.value.isDnd) return;

    const sender = getUser(notice.senderId) || {};
    const alert = describeNotice(notice, { t, senderName: sender.Employee_Name, image: sender.Employee_profileImageURL });
    if (visible()) showPopUp(alert);
    if (wantsBrowserNotice(notice)) showBrowserNotice(alert);
}

const listens = (candidate) => Boolean(candidate) && typeof candidate.on === "function";

watch(socket, (next, previous) => {
    if (listens(previous)) previous.off(NOTICE_EVENT, onNotice);
    if (listens(next)) next.on(NOTICE_EVENT, onNotice);
}, { immediate: true });

watch(() => route.fullPath, () => {
    alerts.value.filter((alert) => isLookingAt(route, alert)).forEach(dismiss);
});

onBeforeUnmount(() => {
    if (listens(socket.value)) socket.value.off(NOTICE_EVENT, onNotice);
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
});
</script>
