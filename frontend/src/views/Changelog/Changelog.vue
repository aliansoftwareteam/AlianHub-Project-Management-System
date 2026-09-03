<template>
    <div class="chg">
        <div class="chg__wrap">
            <div class="chg__head">
                <div>
                    <div class="chg__title">{{ $t('InboxV2.chg_title') }}</div>
                    <div class="chg__sub">
                        <template v-if="currentVersion">
                            {{ $t('InboxV2.chg_on_version', { v: currentVersion }) }}
                            <template v-if="updateAvailable"> {{ $t('InboxV2.chg_available', { v: latestVersion }) }}</template>
                            <template v-else> {{ $t('InboxV2.chg_up_to_date') }}</template>
                        </template>
                    </div>
                </div>
                <a v-if="repoUrl" class="ah-btn ah-btn--primary ah-btn--sm chg__cta" :href="`${repoUrl}/releases`" target="_blank" rel="noopener noreferrer">{{ $t('InboxV2.chg_upgrade_guide') }}</a>
            </div>

            <div v-if="loading" class="chg__state">{{ $t('Inbox.loading') }}</div>
            <div v-else-if="error" class="chg__state">
                {{ $t('Changelog.load_failed') }}
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="fetchChangelog()">{{ $t('Changelog.retry') }}</button>
            </div>
            <div v-else-if="!releases.length" class="ah-empty">{{ $t('Changelog.no_releases') }}</div>

            <div v-else class="chg__list">
                <article
                    v-for="(release, index) in releases"
                    :key="`${release.version}-${index}`"
                    class="chg__release"
                    :class="{ 'is-old': release.version !== currentVersion && index > 2 }"
                >
                    <div class="chg__stamp">
                        <span>v{{ release.version }}</span>
                        <span v-if="release.date">{{ shortDate(release) }}</span>
                    </div>
                    <div class="chg__body">
                        <div class="chg__row">
                            <span class="chg__name">{{ headline(release) }}</span>
                            <span v-if="index === 0" class="ah-chip ah-chip--brand ah-chip--mono chg__chip">NEW</span>
                            <span v-if="release.version === currentVersion" class="ah-chip ah-chip--mono chg__chip">{{ $t('Changelog.installed') }}</span>
                            <span v-if="release.selfHost?.notes?.length" class="ah-chip ah-chip--ok ah-chip--mono chg__chip">SELF-HOST</span>
                            <span
                                class="ah-chip ah-chip--mono chg__chip"
                                :class="release.selfHost?.upgradeNeeded || release.selfHost?.breaking ? 'ah-chip--warn' : 'ah-chip--ok'"
                                :title="$t('InboxV2.chg_upgrade_needed_q')"
                            >{{ release.selfHost?.upgradeNeeded || release.selfHost?.breaking ? $t('InboxV2.chg_upgrade_needed') : $t('InboxV2.chg_upgrade_plain') }}</span>
                            <span class="ah-toolbar__spacer"></span>
                            <a v-if="release.compareUrl" :href="release.compareUrl" target="_blank" rel="noopener noreferrer" class="chg__link">{{ $t('Changelog.compare_changes') }}</a>
                        </div>

                        <p v-for="(note, n) in release.notes" :key="`n${n}`" class="chg__text" v-html="note"></p>

                        <div class="chg__shipped">
                            <div class="ah-label">{{ $t('InboxV2.chg_what_shipped') }}</div>
                            <div v-for="(section, s) in shipped(release)" :key="s" class="chg__section">
                                <div v-if="section.title" class="chg__section-title">{{ section.title }}</div>
                                <ul class="chg__items">
                                    <li v-for="(item, i) in section.items" :key="i" v-html="item.html"></li>
                                </ul>
                            </div>
                        </div>

                        <div class="chg__selfhost" :class="{ 'is-needed': release.selfHost?.upgradeNeeded || release.selfHost?.breaking }">
                            <div class="ah-label">{{ $t('InboxV2.chg_for_self_hosters') }}</div>
                            <template v-if="release.selfHost?.notes?.length">
                                <div v-for="(note, i) in release.selfHost.notes" :key="i" class="chg__selfhost-note" v-html="note"></div>
                            </template>
                            <div v-else class="chg__selfhost-note chg__selfhost-note--plain">{{ $t('InboxV2.chg_selfhost_none') }}</div>
                            <div class="chg__req">{{ $t('InboxV2.chg_upgrade_steps') }}</div>
                        </div>
                    </div>
                </article>
            </div>

            <div class="chg__foot">
                {{ $t('InboxV2.chg_footer') }}
                <a v-if="repoUrl" :href="`${repoUrl}/releases.atom`" target="_blank" rel="noopener noreferrer" class="chg__link">RSS</a>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { apiRequestWithoutCompnay } from '@/services';
import * as env from '@/config/env';

defineOptions({ name: 'ChangelogPage' });

const loading = ref(true);
const error = ref(false);
const currentVersion = ref('');
const latestVersion = ref('');
const repoUrl = ref('');
const releases = ref([]);

const semver = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
const updateAvailable = computed(() => {
    const a = semver(latestVersion.value); const b = semver(currentVersion.value);
    for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
    return false;
});

const strip = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s*\(\[?[a-f0-9]{7,}\]?.*$/i, '').trim();
const headline = (release) => {
    if (release.label) return release.label;
    const first = release.sections.find((s) => s.items.length);
    const text = first ? strip(first.items[0].html) : '';
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : `v${release.version}`;
};
const shipped = (release) => release.sections.filter((s) => s.items.length && !/breaking|self-?host|upgrade/i.test(s.title));

const shortDate = (release) => {
    const d = new Date(`${release.date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return release.date;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
};

function fetchChangelog() {
    loading.value = true;
    error.value = false;
    apiRequestWithoutCompnay('get', env.GET_CHANGELOG).then((response) => {
        if (response?.data?.status) {
            const d = response.data.data || {};
            currentVersion.value = d.currentVersion || '';
            latestVersion.value = d.latestVersion || (d.releases && d.releases[0] && d.releases[0].version) || '';
            repoUrl.value = d.repoUrl || '';
            releases.value = d.releases || [];
        } else {
            error.value = true;
        }
    }).catch(() => { error.value = true; }).finally(() => { loading.value = false; });
}

onMounted(fetchChangelog);
</script>

<style scoped>
.chg { padding: 20px 24px 40px; background: var(--canvas); min-height: 100%; box-sizing: border-box; font-family: var(--font-ui); color: var(--ink); font-size: 12.5px; }
.chg__wrap { max-width: 760px; margin: 0 auto; background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-card); padding: 22px 26px; display: flex; flex-direction: column; gap: 14px; box-shadow: var(--shadow-card); }
.chg__head { display: flex; align-items: center; gap: 10px; }
.chg__title { font-size: 15px; font-weight: 600; }
.chg__sub { font-size: 12px; color: var(--ink-label); margin-top: 2px; }
.chg__cta { margin-left: auto; text-decoration: none; }
.chg__state { padding: 32px 0; text-align: center; color: var(--ink-2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.chg__list { display: flex; flex-direction: column; gap: 18px; }
.chg__release { display: flex; gap: 14px; }
.chg__release.is-old { opacity: .65; }
.chg__stamp { width: 78px; flex: none; font: 500 10.5px/1.5 var(--font-mono); color: var(--ink-2); padding-top: 2px; display: flex; flex-direction: column; }
.chg__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.chg__row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.chg__name { font-size: 13px; font-weight: 600; }
.chg__chip { height: 18px; padding: 0 5px; font-size: 9px; font-weight: 600; letter-spacing: .02em; }
.chg__link { font-size: 12px; color: var(--brand); text-decoration: none; }
.chg__link:hover { text-decoration: underline; }
.chg__text { margin: 0; color: var(--ink-label); line-height: 1.5; }
.chg__shipped { display: flex; flex-direction: column; gap: 6px; }
.chg__section-title { font-size: 12px; font-weight: 600; color: var(--ink); margin-top: 2px; }
.chg__items { margin: 0; padding-left: 18px; color: var(--ink-label); line-height: 1.5; }
.chg__items li { margin-bottom: 2px; overflow-wrap: anywhere; }
.chg__items :deep(a), .chg__text :deep(a), .chg__selfhost-note :deep(a) { color: var(--brand); text-decoration: none; }
.chg__items :deep(code), .chg__selfhost-note :deep(code) { font: 500 11px/1 var(--font-mono); background: rgba(0, 0, 0, .06); border-radius: 4px; padding: 2px 5px; }
.chg__selfhost { display: flex; flex-direction: column; gap: 5px; padding: 10px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--hairline); }
.chg__selfhost.is-needed { border-color: var(--warn); background: var(--warn-bg); }
.chg__selfhost-note { color: var(--ink); line-height: 1.5; }
.chg__selfhost-note--plain { color: var(--ink-label); }
.chg__req { font: 400 11px/1.5 var(--font-mono); color: var(--warn-ink); }
.chg__selfhost:not(.is-needed) .chg__req { color: var(--ok-ink); }
.chg__foot { margin-top: auto; padding: 11px 13px; background: var(--surface-2); border-radius: 10px; font-size: 12px; line-height: 1.5; color: var(--ink-label); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
@media (max-width: 767px) { .chg { padding: 12px; } .chg__wrap { padding: 16px; } .chg__release { flex-direction: column; gap: 6px; } .chg__stamp { flex-direction: row; gap: 8px; width: auto; } }
</style>
