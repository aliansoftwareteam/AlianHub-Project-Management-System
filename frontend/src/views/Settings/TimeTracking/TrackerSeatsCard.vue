<template>
    <section class="ah-card tracker-seats" aria-labelledby="tracker-seats-title" data-test="tracker-seats-card">
        <header class="ah-card__head">
            <h2 id="tracker-seats-title" class="ah-h3">{{ $t('TimeTracker.seats_title') }}</h2>
            <span class="ah-chip" data-test="tracker-seats-used">{{ $t('TimeTracker.desktop_seats', { used: seats.used, limit: seats.limit }) }}</span>
        </header>
        <div class="ah-card__body">
            <p class="ah-small tracker-seats__line">{{ $t('TimeTracker.seats_intro') }}</p>
            <p v-if="!holders.length" class="ah-small tracker-seats__line" data-test="tracker-seats-empty">{{ $t('TimeTracker.seats_empty') }}</p>
            <ul v-else class="tracker-seats__list">
                <li v-for="person in holders" :key="person.userId" class="tracker-seats__row" data-test="tracker-seats-holder">
                    <span class="tracker-seats__name">{{ person.name }}</span>
                    <button
                        type="button"
                        class="ah-btn ah-btn--ghost ah-btn--sm"
                        :disabled="releasing === person.userId"
                        :aria-label="$t('TimeTracker.seats_release_named', { name: person.name })"
                        data-test="tracker-seats-release"
                        @click="release(person)"
                    >{{ $t('TimeTracker.seats_release') }}</button>
                </li>
            </ul>
        </div>
    </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "TrackerSeatsCard" });

const props = defineProps({
    seats: { type: Object, required: true },
});
const emit = defineEmits(["released"]);

const { t } = useI18n();
const { getters } = useStore();
const $toast = useToast();
const releasing = ref("");

const nameOf = (userId) => {
    const user = (getters["users/users"] || []).find((u) => u._id === userId);
    if (user && user.Employee_Name) return user.Employee_Name;
    const seat = (getters["settings/companyUsers"] || []).find((row) => row.userId === userId);
    return (seat && seat.userEmail) || t("TimeTracker.seats_unknown_person");
};

const holders = computed(() => (props.seats.holders || [])
    .map((userId) => ({ userId, name: nameOf(userId) }))
    .sort((a, b) => a.name.localeCompare(b.name)));

const release = async (person) => {
    releasing.value = person.userId;
    try {
        const res = await apiRequest("post", env.TRACKER_USER_PERMISSION_MANAGEMENT, { DataObj: { ops: false, data: { status: 2, userId: person.userId } } });
        if (res && res.data && res.data.status) {
            $toast.success(t("TimeTracker.seats_released", { name: person.name }), { position: "top-right" });
            emit("released", person.userId);
        } else {
            $toast.error((res && res.data && res.data.message) || t("Toast.something_went_wrong"), { position: "top-right" });
        }
    } catch (error) {
        console.error("ERROR in releasing a tracker seat: ", error);
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        releasing.value = "";
    }
};
</script>

<style scoped>
.tracker-seats {
    width: 100%;
    max-width: 720px;
    margin-top: var(--sp-8);
}
.tracker-seats__line {
    margin: 0 0 var(--sp-4);
}
.tracker-seats__list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.tracker-seats__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    min-height: 40px;
    border-top: 1px solid var(--hairline);
}
.tracker-seats__name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink);
}
</style>
