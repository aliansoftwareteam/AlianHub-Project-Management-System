<template>
    <div class="desktop-app" data-test="desktop-app-card">
        <section class="ah-card" aria-labelledby="desktop-app-title">
            <header class="ah-card__head">
                <h2 id="desktop-app-title" class="ah-h3">{{ $t('TimeTracker.desktop_title') }}</h2>
                <span v-if="info && info.enabled" class="ah-chip" data-test="desktop-app-seats">{{ seatsText }}</span>
            </header>
            <div class="ah-card__body">
                <p v-if="loading" class="desktop-app__loading" role="status">
                    <span class="ah-spin" aria-hidden="true"></span>
                    <span class="ah-small">{{ $t('TimeTracker.desktop_loading') }}</span>
                </p>

                <div v-else-if="trackerOff" class="desktop-app__off" data-test="desktop-app-off">
                    <p>{{ $t('TimeTracker.desktop_addon_off') }}</p>
                    <a v-if="isAdmin && info.portalUrl" class="ah-btn ah-btn--primary" :href="info.portalUrl" target="_blank" rel="noopener">{{ $t('TimeTracker.desktop_add_tracker') }}</a>
                    <p v-else-if="isAdmin" class="ah-small">{{ $t('TimeTracker.desktop_addon_off_admin') }}</p>
                    <p v-else class="ah-small">{{ $t('TimeTracker.desktop_ask_admin') }}</p>
                </div>

                <template v-else>
                    <p class="ah-small desktop-app__intro">{{ $t('TimeTracker.desktop_intro') }}</p>

                    <div v-if="primary" class="desktop-app__primary">
                        <span class="desktop-app__os" aria-hidden="true">
                            <span v-if="osIcon(primary)" class="ah-mask-icon" :style="maskOf(osIcon(primary))"></span>
                        </span>
                        <div class="desktop-app__meta">
                            <span class="desktop-app__name">{{ downloadLabel(primary) }}</span>
                            <span class="desktop-app__facts">
                                <span v-if="primary.version">{{ $t('TimeTracker.desktop_version', { version: primary.version }) }}</span>
                                <span v-if="primary.os === thisOs">{{ $t('TimeTracker.desktop_this_computer') }}</span>
                            </span>
                            <span v-if="primary.note" class="ah-small">{{ primary.note }}</span>
                        </div>
                        <a class="ah-btn ah-btn--primary desktop-app__download" :href="primary.url" download data-test="desktop-app-primary">
                            <span class="ah-mask-icon" :style="maskOf(downloadIcon)" aria-hidden="true"></span>{{ $t('TimeTracker.desktop_download_for', { os: downloadLabel(primary) }) }}
                        </a>
                    </div>
                    <p v-else class="ah-empty desktop-app__empty" data-test="desktop-app-none">{{ $t('TimeTracker.no_builds') }}</p>

                    <template v-if="others.length">
                        <h3 class="ah-label desktop-app__label">{{ $t('TimeTracker.desktop_other_platforms') }}</h3>
                        <ul class="desktop-app__others" data-test="desktop-app-others">
                            <li v-for="download in others" :key="download.url" class="desktop-app__row">
                                <span class="desktop-app__os" aria-hidden="true">
                                    <span v-if="osIcon(download)" class="ah-mask-icon" :style="maskOf(osIcon(download))"></span>
                                </span>
                                <div class="desktop-app__meta">
                                    <span class="desktop-app__name" data-test="desktop-app-other-name">{{ downloadLabel(download) }}</span>
                                    <span v-if="download.version" class="ah-small">{{ $t('TimeTracker.desktop_version', { version: download.version }) }}</span>
                                    <span v-if="download.note" class="ah-small">{{ download.note }}</span>
                                </div>
                                <a
                                    class="ah-btn ah-btn--secondary ah-btn--sm"
                                    :href="download.url"
                                    download
                                    :aria-label="$t('TimeTracker.desktop_download_for', { os: downloadLabel(download) })"
                                >
                                    <span class="ah-mask-icon" :style="maskOf(downloadIcon)" aria-hidden="true"></span>{{ $t('TimeTracker.desktop_download') }}
                                </a>
                            </li>
                        </ul>
                    </template>
                </template>
            </div>
        </section>

        <template v-if="!loading && !trackerOff">
            <section class="ah-card" aria-labelledby="desktop-app-connect-title">
                <header class="ah-card__head">
                    <h2 id="desktop-app-connect-title" class="ah-h3">{{ $t('TimeTracker.desktop_connect_title') }}</h2>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="desktop-app-open" @click="openTracker">{{ $t('TimeTracker.desktop_open_in_tracker') }}</button>
                </header>
                <div class="ah-card__body">
                    <ol class="desktop-app__steps">
                        <li>{{ $t('TimeTracker.desktop_step_install') }}</li>
                        <li>{{ $t('TimeTracker.desktop_step_open', { action: $t('TimeTracker.desktop_open_in_tracker') }) }}</li>
                        <li>{{ $t('TimeTracker.desktop_step_timer') }}</li>
                    </ol>
                    <p v-if="openHint" class="ah-small desktop-app__hint" role="status" data-test="desktop-app-open-hint">{{ openHint }}</p>
                </div>
            </section>

            <section v-if="info" class="ah-card" aria-labelledby="desktop-app-shots-title" data-test="desktop-app-screenshots">
                <header class="ah-card__head">
                    <h2 id="desktop-app-shots-title" class="ah-h3">{{ $t('TimeTracker.desktop_screenshots_title') }}</h2>
                </header>
                <div class="ah-card__body">
                    <dl class="desktop-app__stats">
                        <div class="desktop-app__stat">
                            <dt class="ah-small">{{ $t('TimeTracker.desktop_storage_used') }}</dt>
                            <dd data-test="desktop-app-storage">{{ storageText }}</dd>
                        </div>
                        <div class="desktop-app__stat">
                            <dt class="ah-small">{{ $t('TimeTracker.desktop_kept_for') }}</dt>
                            <dd data-test="desktop-app-kept">{{ keptText }}</dd>
                        </div>
                    </dl>
                    <p class="ah-small desktop-app__note">{{ $t('TimeTracker.desktop_storage_note') }}</p>
                </div>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { isOwnerOrAdmin } from "@/utils/roles";
import { maskOf } from "@/utils/iconMask";
import { openTrackerConnect, workspaceAddressOf } from "@/utils/trackerDeepLink";
import windowsIcon from "@/assets/images/svg/Windows.svg";
import macIcon from "@/assets/images/svg/Mac.svg";
import linuxIcon from "@/assets/images/svg/Linux.svg";
import downloadIcon from "@/assets/images/svg/downloadVector.svg";

defineOptions({ name: "DesktopAppCard" });

const props = defineProps({
    info: { type: Object, default: null },
    loading: { type: Boolean, default: false },
    localDownloads: { type: Array, default: () => [] },
});

const { t } = useI18n();
const { getters } = useStore();
const openHint = ref("");

const isAdmin = computed(() => isOwnerOrAdmin(Number((getters["settings/companyUserDetail"] || {}).roleType)));
const trackerOff = computed(() => Boolean(props.info && !props.info.enabled));

const detectOs = () => {
    if (typeof navigator === "undefined") return "windows";
    const platform = `${(navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
    if (/android|iphone|ipad|ipod/.test(platform)) return null;
    if (platform.includes("mac")) return "mac";
    if (platform.includes("linux") || platform.includes("x11")) return "linux";
    return "windows";
};
const thisOs = detectOs();

const downloads = computed(() => {
    const feed = (props.info && props.info.release && props.info.release.downloads) || [];
    return feed.length ? feed : props.localDownloads;
});
const primary = computed(() => downloads.value.find((d) => d.os === thisOs) || downloads.value[0] || null);
const others = computed(() => downloads.value.filter((d) => d !== primary.value));

const OS_ICONS = { windows: windowsIcon, mac: macIcon, linux: linuxIcon };
const osIcon = (download) => OS_ICONS[download.os] || null;

const OS_KEYS = { windows: "TimeTracker.desktop_os_windows", mac: "TimeTracker.desktop_os_mac", linux: "TimeTracker.desktop_os_linux" };
const downloadLabel = (download) => {
    const os = OS_KEYS[download.os] ? t(OS_KEYS[download.os]) : download.name || download.os;
    return download.os === "linux" && download.kind ? t("TimeTracker.desktop_os_with_format", { os, format: download.kind }) : os;
};

const seatsText = computed(() => {
    const seats = (props.info && props.info.seats) || { used: null, limit: null };
    return seats.limit
        ? t("TimeTracker.desktop_seats", { used: seats.used, limit: seats.limit })
        : t("TimeTracker.desktop_seats_any");
});

const TB = 1024 * 1024 * 1024 * 1024;
const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const screenshots = computed(() => (props.info && props.info.screenshots) || {});

const storageText = computed(() => {
    const bytes = screenshots.value.bytes;
    if (bytes === null || bytes === undefined) return t("TimeTracker.desktop_storage_pending");
    if (bytes >= TB) return t("TimeTracker.desktop_size_tb", { n: (bytes / TB).toFixed(1) });
    if (bytes >= GB) return t("TimeTracker.desktop_size_gb", { n: (bytes / GB).toFixed(1) });
    return t("TimeTracker.desktop_size_mb", { n: Math.round(bytes / MB) });
});

const keptText = computed(() => {
    const retention = screenshots.value.retention || {};
    return retention.enabled && retention.maxAgeMonths
        ? t("TimeTracker.desktop_months", { n: retention.maxAgeMonths }, retention.maxAgeMonths)
        : t("TimeTracker.desktop_until_deleted");
});

const openTracker = () => {
    openHint.value = "";
    const result = openTrackerConnect(workspaceAddressOf(window.location), {
        onNotOpened: () => { openHint.value = t("TimeTracker.desktop_not_opened"); },
    });
    if (!result.ok) openHint.value = t(result.reason === "unsupported" ? "TimeTracker.desktop_only" : "TimeTracker.desktop_not_opened");
};
</script>

<style scoped>
.desktop-app {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
    width: 100%;
    max-width: 720px;
}
.desktop-app__loading {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    margin: 0;
    color: var(--ink-2);
}
.desktop-app__off p {
    margin: 0 0 var(--sp-4);
}
.desktop-app__intro {
    margin: 0 0 var(--sp-6);
}
.desktop-app__primary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-6);
    padding: var(--sp-6);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    background: var(--surface-2);
}
.desktop-app__os {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-card);
    background: var(--fill);
    color: var(--ink);
}
.desktop-app__os .ah-mask-icon {
    width: 18px;
    height: 18px;
}
.desktop-app__meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
}
.desktop-app__name {
    font: var(--text-body);
    font-weight: var(--fw-title);
    color: var(--ink);
}
.desktop-app__facts {
    display: flex;
    flex-wrap: wrap;
    font: var(--text-small);
    color: var(--ink-2);
}
.desktop-app__facts > span + span::before {
    content: "·";
    margin: 0 var(--sp-3);
}
.desktop-app__download,
.desktop-app__row .ah-btn {
    min-height: var(--hit-min);
}
.desktop-app__empty {
    margin: 0;
}
.desktop-app__label {
    display: block;
    margin: var(--sp-8) 0 var(--sp-2);
}
.desktop-app__others {
    list-style: none;
    margin: 0;
    padding: 0;
}
.desktop-app__row {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
    padding: var(--sp-5) 0;
    border-top: 1px solid var(--hairline);
}
.desktop-app__row:first-child {
    border-top: 0;
}
.desktop-app__steps {
    counter-reset: step;
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-6);
}
.desktop-app__steps li {
    counter-increment: step;
    display: flex;
    align-items: flex-start;
    gap: var(--sp-4);
    font: var(--text-small);
    color: var(--ink-2);
}
.desktop-app__steps li::before {
    content: counter(step);
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: 1px solid var(--border);
    border-radius: 50%;
    font: var(--text-data);
    color: var(--ink);
}
.desktop-app__hint,
.desktop-app__note {
    margin: var(--sp-6) 0 0;
}
.desktop-app__stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-6);
    margin: 0;
}
.desktop-app__stat {
    padding: var(--sp-5) var(--sp-6);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    background: var(--surface-2);
}
.desktop-app__stat dd {
    margin: var(--sp-1) 0 0;
    font: var(--text-h2);
    color: var(--ink);
}
@media (max-width: 600px) {
    .desktop-app__download {
        width: 100%;
    }
    .desktop-app__steps,
    .desktop-app__stats {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
