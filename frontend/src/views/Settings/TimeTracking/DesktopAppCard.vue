<template>
    <section class="ah-card desktop-app" aria-labelledby="desktop-app-title" data-test="desktop-app-card">
        <header class="ah-card__head">
            <h2 id="desktop-app-title" class="ah-h3">{{ $t('TimeTracker.desktop_title') }}</h2>
            <span v-if="info && info.enabled" class="ah-small" data-test="desktop-app-seats">{{ seatsText }}</span>
        </header>
        <div class="ah-card__body">
            <p v-if="loading" class="ah-small desktop-app__line">{{ $t('TimeTracker.desktop_loading') }}</p>

            <div v-else-if="info && !info.enabled" data-test="desktop-app-off">
                <p class="desktop-app__line">{{ $t('TimeTracker.desktop_addon_off') }}</p>
                <a v-if="isAdmin && info.portalUrl" class="ah-btn ah-btn--primary" :href="info.portalUrl" target="_blank" rel="noopener">{{ $t('TimeTracker.desktop_add_tracker') }}</a>
                <p v-else-if="isAdmin" class="ah-small desktop-app__line">{{ $t('TimeTracker.desktop_addon_off_admin') }}</p>
                <p v-else class="ah-small desktop-app__line">{{ $t('TimeTracker.desktop_ask_admin') }}</p>
            </div>

            <template v-else>
                <div v-if="primary" class="desktop-app__primary">
                    <a class="ah-btn ah-btn--primary" :href="primary.url" data-test="desktop-app-primary">{{ $t('TimeTracker.desktop_download_for', { os: downloadLabel(primary) }) }}</a>
                    <span class="ah-small">{{ $t('TimeTracker.desktop_version', { version: primary.version }) }}</span>
                </div>
                <p v-if="others.length" class="ah-small desktop-app__line" data-test="desktop-app-others">
                    <template v-for="(download, index) in others" :key="download.url">
                        <a :href="download.url" class="desktop-app__link">{{ downloadLabel(download) }}</a><span v-if="index < others.length - 1" aria-hidden="true"> · </span>
                    </template>
                </p>
                <slot v-if="!primary" name="fallback"></slot>

                <div class="desktop-app__open">
                    <span class="ah-small">{{ $t('TimeTracker.desktop_installed_it') }}</span>
                    <button type="button" class="ah-btn ah-btn--outline" data-test="desktop-app-open" @click="openTracker">{{ $t('TimeTracker.desktop_open_in_tracker') }}</button>
                </div>
                <p v-if="openHint" class="ah-small desktop-app__line" role="status" data-test="desktop-app-open-hint">{{ openHint }}</p>

                <template v-if="info">
                    <p class="ah-small desktop-app__line" data-test="desktop-app-screenshots">{{ screenshotsText }}</p>
                    <p class="ah-small desktop-app__line">{{ $t('TimeTracker.desktop_storage_note') }}</p>
                </template>
            </template>
        </div>
    </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { isOwnerOrAdmin } from "@/utils/roles";
import { openTrackerConnect } from "@/utils/trackerDeepLink";

defineOptions({ name: "DesktopAppCard" });

const props = defineProps({
    info: { type: Object, default: null },
    loading: { type: Boolean, default: false },
});

const { t } = useI18n();
const { getters } = useStore();
const openHint = ref("");

const isAdmin = computed(() => isOwnerOrAdmin(Number((getters["settings/companyUserDetail"] || {}).roleType)));

const detectOs = () => {
    if (typeof navigator === "undefined") return "windows";
    const platform = `${(navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
    if (platform.includes("mac")) return "mac";
    if (platform.includes("linux") || platform.includes("x11")) return "linux";
    return "windows";
};

const downloads = computed(() => (props.info && props.info.release && props.info.release.downloads) || []);
const primary = computed(() => {
    const os = detectOs();
    return downloads.value.find((d) => d.os === os) || downloads.value[0] || null;
});
const others = computed(() => downloads.value.filter((d) => d !== primary.value));

const OS_KEYS = { windows: "TimeTracker.desktop_os_windows", mac: "TimeTracker.desktop_os_mac", linux: "TimeTracker.desktop_os_linux" };
const downloadLabel = (download) => {
    const os = t(OS_KEYS[download.os] || OS_KEYS.windows);
    return download.os === "linux" ? t("TimeTracker.desktop_os_with_format", { os, format: download.kind }) : os;
};

const seatsText = computed(() => {
    const seats = (props.info && props.info.seats) || { used: 0, limit: null };
    return seats.limit
        ? t("TimeTracker.desktop_seats", { used: seats.used, limit: seats.limit })
        : t("TimeTracker.desktop_seats_unlimited", { used: seats.used }, seats.used);
});

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const sizeText = (bytes) => {
    if (bytes === null || bytes === undefined) return t("TimeTracker.desktop_screenshots_pending");
    if (bytes >= GB) return t("TimeTracker.desktop_size_gb", { n: (bytes / GB).toFixed(1) });
    return t("TimeTracker.desktop_size_mb", { n: Math.round(bytes / MB) });
};

const screenshotsText = computed(() => {
    const shots = (props.info && props.info.screenshots) || {};
    const retention = shots.retention || {};
    const kept = retention.enabled && retention.maxAgeMonths
        ? t("TimeTracker.desktop_kept_months", { n: retention.maxAgeMonths }, retention.maxAgeMonths)
        : t("TimeTracker.desktop_kept_forever");
    return t("TimeTracker.desktop_screenshots", { size: sizeText(shots.bytes), kept });
});

const openTracker = () => {
    openHint.value = "";
    const result = openTrackerConnect(window.location.origin, {
        onNotOpened: () => { openHint.value = t("TimeTracker.desktop_not_opened"); },
    });
    if (!result.ok) openHint.value = t(result.reason === "unsupported" ? "TimeTracker.desktop_only" : "TimeTracker.desktop_not_opened");
};
</script>

<style scoped>
.desktop-app {
    width: 100%;
    max-width: 560px;
    margin: 24px auto 0;
    text-align: left;
}
.desktop-app__primary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-6);
}
.desktop-app__line {
    margin: var(--sp-4) 0 0;
}
.desktop-app__link {
    color: var(--brand);
}
.desktop-app__open {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-4);
    margin-top: var(--sp-8);
}
</style>
