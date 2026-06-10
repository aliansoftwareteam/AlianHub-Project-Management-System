<template>
    <div class="changelog-page">
        <div class="changelog-container">
            <!-- PAGE HEAD -->
            <div class="changelog-head d-flex justify-content-between flex-wrap">
                <div>
                    <h1 class="changelog-title">{{ $t('Changelog.whats_new') }}</h1>
                    <p class="changelog-subtitle">{{ $t('Changelog.subtitle') }}</p>
                </div>
                <div class="d-flex align-items-center changelog-head-meta">
                    <span v-if="currentVersion" class="changelog-chip changelog-chip--version">{{ $t('Changelog.current_version') }} v{{ currentVersion }}</span>
                    <a v-if="repoUrl" :href="`${repoUrl}/releases`" target="_blank" rel="noopener noreferrer" class="changelog-github-link">{{ $t('Changelog.view_on_github') }}</a>
                </div>
            </div>

            <!-- LOADING -->
            <div v-if="loading" class="changelog-state changelog-state--loading">
                <Spinner :isSpinner="true"/>
            </div>

            <!-- ERROR -->
            <div v-else-if="error" class="changelog-state">
                <p class="changelog-state-text">{{ $t('Changelog.load_failed') }}</p>
                <button type="button" class="changelog-retry" @click="fetchChangelog()">{{ $t('Changelog.retry') }}</button>
            </div>

            <!-- EMPTY -->
            <div v-else-if="!releases.length" class="changelog-state">
                <p class="changelog-state-text">{{ $t('Changelog.no_releases') }}</p>
            </div>

            <!-- RELEASES -->
            <div v-else class="changelog-timeline">
                <div v-for="(release, index) in releases" :key="`${release.version}-${index}`" class="changelog-release">
                    <div class="changelog-release-card">
                        <div class="changelog-release-head d-flex align-items-center flex-wrap">
                            <span class="changelog-release-version">v{{ release.version }}</span>
                            <span v-if="index === 0" class="changelog-chip changelog-chip--latest">{{ $t('Changelog.latest') }}</span>
                            <span v-if="release.version === currentVersion" class="changelog-chip changelog-chip--installed">{{ $t('Changelog.installed') }}</span>
                            <span v-if="release.label" class="changelog-release-label">{{ release.label }}</span>
                            <span class="changelog-release-spacer"></span>
                            <span v-if="release.date" class="changelog-release-date">{{ formatDate(release.date) }}</span>
                            <a v-if="release.compareUrl" :href="release.compareUrl" target="_blank" rel="noopener noreferrer" class="changelog-compare-link">{{ $t('Changelog.compare_changes') }}</a>
                        </div>

                        <p v-for="(note, noteIndex) in release.notes" :key="noteIndex" class="changelog-release-note" v-html="note"></p>

                        <div v-for="(section, sectionIndex) in release.sections" :key="sectionIndex" class="changelog-section">
                            <div v-if="section.title" class="changelog-section-title">{{ section.title }}</div>
                            <ul class="changelog-items">
                                <li v-for="(item, itemIndex) in section.items" :key="itemIndex" v-html="item.html"></li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGE
import { defineComponent, onMounted, ref } from "vue";

// COMPONENTS
import Spinner from "@/components/atom/SpinnerComp/SpinnerComp.vue";

// SERVICES
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

// COMPONENT
defineComponent({
    name: "Changelog-Page",

    components: {
        Spinner
    }
});

const loading = ref(true);
const error = ref(false);
const currentVersion = ref("");
const repoUrl = ref("");
const releases = ref([]);

function fetchChangelog() {
    loading.value = true;
    error.value = false;
    apiRequestWithoutCompnay("get", env.GET_CHANGELOG).then((response) => {
        if (response?.data?.status) {
            currentVersion.value = response.data.data?.currentVersion || "";
            repoUrl.value = response.data.data?.repoUrl || "";
            releases.value = response.data.data?.releases || [];
        } else {
            error.value = true;
        }
    }).catch((fetchError) => {
        console.error("ERROR in fetch changelog:", fetchError);
        error.value = true;
    }).finally(() => {
        loading.value = false;
    });
}

function formatDate(isoDate) {
    const date = new Date(`${isoDate}T00:00:00`);
    if (isNaN(date.getTime())) return isoDate;
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

onMounted(() => {
    fetchChangelog();
});
</script>

<style scoped>
.changelog-page {
    padding: 24px 16px 48px;
}
.changelog-container {
    max-width: 860px;
    margin: 0 auto;
}
.changelog-head {
    gap: 12px;
    margin-bottom: 24px;
}
.changelog-title {
    font-size: 24px;
    font-weight: 700;
    color: #2B2B2B;
    margin: 0 0 4px;
}
.changelog-subtitle {
    font-size: 14px;
    color: #6F6F6F;
    margin: 0;
}
.changelog-head-meta {
    gap: 12px;
}
.changelog-chip {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
}
.changelog-chip--version {
    background: #2F3990;
    color: #fff;
}
.changelog-chip--latest {
    background: #E8F5E9;
    color: #2E7D32;
}
.changelog-chip--installed {
    background: #EAF0FF;
    color: #2F3990;
}
.changelog-github-link,
.changelog-compare-link {
    font-size: 13px;
    color: #2F3990;
    text-decoration: none;
    white-space: nowrap;
}
.changelog-github-link:hover,
.changelog-compare-link:hover {
    text-decoration: underline;
}
.changelog-state {
    text-align: center;
    padding: 48px 16px;
    border: 1px solid #E8E8E8;
    border-radius: 8px;
    background: #fff;
}
.changelog-state--loading {
    position: relative;
    min-height: 160px;
    border: none;
    background: transparent;
}
.changelog-state-text {
    font-size: 14px;
    color: #6F6F6F;
    margin: 0 0 12px;
}
.changelog-retry {
    border: none;
    background: #2F3990;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 18px;
    border-radius: 6px;
    cursor: pointer;
}
.changelog-timeline {
    position: relative;
    padding-left: 24px;
}
.changelog-timeline::before {
    content: "";
    position: absolute;
    left: 5px;
    top: 8px;
    bottom: 8px;
    width: 2px;
    background: #E4E6F2;
}
.changelog-release {
    position: relative;
    margin-bottom: 16px;
}
.changelog-release::before {
    content: "";
    position: absolute;
    left: -24px;
    top: 22px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid #2F3990;
}
.changelog-release-card {
    background: #fff;
    border: 1px solid #E8E8E8;
    border-radius: 8px;
    padding: 18px 22px;
}
.changelog-release-head {
    gap: 8px;
}
.changelog-release-version {
    font-size: 18px;
    font-weight: 700;
    color: #2F3990;
}
.changelog-release-label {
    font-size: 13px;
    color: #6F6F6F;
}
.changelog-release-spacer {
    flex: 1 1 auto;
}
.changelog-release-date {
    font-size: 13px;
    color: #6F6F6F;
}
.changelog-release-note {
    font-size: 14px;
    color: #494949;
    line-height: 1.6;
    margin: 12px 0 0;
}
.changelog-section {
    margin-top: 14px;
}
.changelog-section-title {
    font-size: 13px;
    font-weight: 700;
    color: #2B2B2B;
    margin-bottom: 6px;
}
.changelog-items {
    margin: 0;
    padding-left: 20px;
}
.changelog-items li {
    font-size: 14px;
    color: #494949;
    line-height: 1.6;
    margin-bottom: 4px;
    overflow-wrap: anywhere;
}
.changelog-items li :deep(a),
.changelog-release-note :deep(a) {
    color: #2F3990;
    text-decoration: none;
}
.changelog-items li :deep(a:hover),
.changelog-release-note :deep(a:hover) {
    text-decoration: underline;
}
.changelog-items li :deep(code) {
    background: #F4F4F7;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 13px;
}
@media (max-width: 600px) {
    .changelog-timeline {
        padding-left: 0;
    }
    .changelog-timeline::before,
    .changelog-release::before {
        display: none;
    }
}
</style>
