<template>
    <div class="rap-wrapper" v-if="projects.length">
        <div class="rap-head">
            <span class="rap-title">{{ $t('dashboardCard.recently_added_projects') }}</span>
            <span class="rap-count">{{ projects.length }}</span>
        </div>
        <p class="rap-hint">{{ $t('dashboardCard.recently_added_projects_hint') }}</p>

        <div class="rap-list">
            <div
                v-for="p in projects"
                :key="p._id"
                class="rap-row"
                :class="{ 'rap-row-selected': isChecked(p._id) }"
                @click="$emit('toggle', p._id)"
            >
                <!-- Dismiss (X): removes this suggestion for good (the parent
                     persists it so it won't come back). .stop keeps it from
                     triggering the row's add-toggle. -->
                <button
                    type="button"
                    class="rap-dismiss"
                    :title="$t('dashboardCard.dismiss_recent_project')"
                    @click.stop="$emit('dismiss', p._id)"
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                </button>

                <!-- Project icon — mirrors the project dropdown / sidebar rendering -->
                <span
                    v-if="p.projectIcon && p.projectIcon.type === 'color'"
                    class="rap-icon"
                    :style="{ backgroundColor: p.projectIcon.data }"
                >{{ initial(p) }}</span>
                <WasabiImage
                    v-else-if="p.projectIcon && p.projectIcon.type === 'image'"
                    class="rap-icon rap-icon-img"
                    thumbnail="30x30"
                    :data="{ url: p.projectIcon.data }"
                />
                <span v-else class="rap-icon rap-icon-fallback">{{ initial(p) }}</span>

                <span class="rap-name" :title="p.ProjectName">{{ p.ProjectName || '—' }}</span>
                <span class="rap-new">{{ $t('dashboardCard.new_badge') }}</span>
                <span class="rap-date">{{ createdLabel(p) }}</span>

                <input
                    type="checkbox"
                    class="rap-checkbox"
                    :checked="isChecked(p._id)"
                    tabindex="-1"
                />
            </div>
        </div>
    </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import WasabiImage from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';

const { t } = useI18n();

const props = defineProps({
    // Newly-added project objects (already filtered + sorted by the parent).
    projects: { type: Array, default: () => [] },
    // The card's current project selection (selectedProjects in the modal).
    selectedIds: { type: Array, default: () => [] },
});

defineEmits(['toggle', 'dismiss']);

const isChecked = (id) => props.selectedIds.includes(id);

const initial = (p) => (p?.ProjectName || '?').charAt(0).toUpperCase();

// Resolve createdAt to epoch ms, tolerant of the shapes this codebase uses
// (ISO string / ms number / Firestore-style { seconds }). Matches the parent.
const createdMs = (createdAt) => {
    if (!createdAt) return NaN;
    if (typeof createdAt === 'object') {
        if (createdAt instanceof Date) return createdAt.getTime();
        const sec = createdAt.seconds ?? createdAt._seconds;
        if (sec != null) return Number(sec) * 1000;
        return new Date(createdAt).getTime();
    }
    return new Date(createdAt).getTime();
};

// Small, friendly "when created" label: Today / Yesterday / "6 Jun".
const createdLabel = (p) => {
    const ms = createdMs(p?.createdAt);
    if (Number.isNaN(ms)) return '';
    const d = new Date(ms);
    const now = new Date();
    const dayMs = 86400000;
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (startDay === startToday) return t('dashboardCard.today');
    if (startDay === startToday - dayMs) return t('dashboardCard.yesterday');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
</script>

<style scoped>
.rap-wrapper {
    margin: 6px 0 14px;
    padding: 10px 12px;
    border: 1px solid #E2E6FA;
    border-radius: 8px;
    background: #FBFCFF;
}
.rap-head {
    display: flex;
    align-items: center;
    gap: 8px;
}
.rap-title {
    font-size: 13px;
    font-weight: 600;
    color: #1F212A;
}
.rap-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    background: #EEF0FE;
    color: #6473E8;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
}
.rap-hint {
    margin: 4px 0 8px;
    font-size: 11px;
    line-height: 1.4;
    color: #8A909C;
}
.rap-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 168px;
    overflow-y: auto;
}
.rap-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    background: #fff;
    border: 1px solid #EDF0F7;
    /* Same green left marker the project sidebar uses for "new" projects. */
    border-left: 2px solid #3ba510;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
}
.rap-row:hover {
    background: #F6F8FF;
}
.rap-row-selected {
    background: #F2F4FE;
    border-color: #C9D0F8;
    border-left-color: #3ba510;
}
/* Dismiss (X) — leftmost in the row, just inside the green marker. Subtle
   grey by default, turns red on hover to read as a "remove" action. */
.rap-dismiss {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #B6BCC9;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}
.rap-dismiss:hover {
    background: #FDECEC;
    color: #E5484D;
}
.rap-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    overflow: hidden;
}
.rap-icon-fallback {
    background: #6473E8;
}
.rap-icon-img {
    object-fit: cover;
}
.rap-name {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: #1F212A;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.rap-new {
    flex-shrink: 0;
    padding: 1px 5px;
    background: #1CB303;
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    border-radius: 5px;
}
.rap-date {
    flex-shrink: 0;
    font-size: 11px;
    color: #94A3B8;
}
.rap-checkbox {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    accent-color: #6473E8;
    /* The whole row is the click target. */
    pointer-events: none;
}
</style>
