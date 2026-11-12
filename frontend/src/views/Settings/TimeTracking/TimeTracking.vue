<template>
    <div class="time-tracking">
        <div v-if="addOnOff" class="tt-addon ah-card ah-card__body" data-test="tracker-addon">
            <h2 class="ah-h3">{{ $t('Plan.tracker_addon_title') }}</h2>
            <p class="ah-small">{{ $t('Plan.tracker_addon_body') }}</p>
            <a v-if="portalUrl && privileged" :href="portalUrl" target="_blank" rel="noopener" class="ah-btn ah-btn--primary ah-btn--sm">{{ $t('Plan.tracker_addon_action') }}</a>
        </div>
        <DesktopAppCard v-else :info="desktopApp" :loading="cardLoading" :local-downloads="localDownloads" />
    </div>
</template>

<script setup>
import { onMounted, ref, computed, inject } from "vue";
import { useStore } from "vuex";
import DesktopAppCard from "./DesktopAppCard.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { isManagedHosting, publicConfig } from "@/config/publicConfig";
import { isOwnerOrAdmin } from "@/utils/roles";

const { dispatch, getters } = useStore();
const companyId = inject("$companyId");
const addOnOff = computed(() => isManagedHosting() && getters["settings/selectedCompany"]?.planFeature?.trackerTimesheet === false);
const privileged = computed(() => isOwnerOrAdmin(getters["settings/companyUserDetail"]?.roleType));
const portalUrl = computed(() => publicConfig.hosting?.portalUrl || "");

const desktopApp = ref(null);
const desktopLoading = ref(true);
const builds = ref([]);
const buildsLoaded = ref(false);

const feedHasDownloads = computed(() => Boolean(desktopApp.value?.release?.downloads?.length));
const cardLoading = computed(() => desktopLoading.value || (!feedHasDownloads.value && !buildsLoaded.value));

const localDownloads = computed(() => builds.value
    .filter((build) => build && build.downloadUrl)
    .map((build) => ({
        os: String(build.type || "").toLowerCase(),
        name: build.type,
        version: String(build.version || "").replace(/^v/i, ""),
        url: build.downloadUrl,
        note: build.description || "",
    })));

onMounted(() => {
    apiRequest("get", env.TRACKER_DESKTOP_APP)
        .then((res) => { desktopApp.value = res && res.data && res.data.status ? res.data.data : null; })
        .catch((error) => console.error("ERROR in loading the desktop tracker card: ", error))
        .finally(() => { desktopLoading.value = false; });

    const cached = getters["settings/TimeTracker"];
    if (cached && cached.length) {
        builds.value = cached;
        buildsLoaded.value = true;
        return;
    }
    dispatch("settings/setTimeTrackerDownload", companyId.value)
        .then((res) => { builds.value = res || []; })
        .catch((error) => console.error("ERROR in set setTimeTrackerDownload: ", error))
        .finally(() => { buildsLoaded.value = true; });
});
</script>

<style scoped>
.tt-addon {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-4);
    max-width: 720px;
}
</style>
