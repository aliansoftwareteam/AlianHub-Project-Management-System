<template>
    <NotepadPanel v-model="shellState.notepad" />
    <ClipsPanel v-model="shellState.clips" />
    <ReminderPanel v-model="shellState.reminders" />
    <ClipRecorder />
    <TalkToTextPopover v-model="shellState.talkToText" />

    <Sidebar width="550px" :title="$t('Header.take_tour')" v-model:visible="shellState.tour" className="tour_sidebar">
        <template #head>
            <div class="d-flex align-items-center justify-content-between assignee-headtitle text-capitalize">{{ $t('Header.take_tour') }}</div>
            <div class="d-flex align-items-center justify-content-between">
                <button class="ah-btn ah-btn--ghost ah-btn--sm mr-20px" type="button" @click="handleTourOps(tourList, true)">{{ $t('Header.Mark_all_as_complete') }}</button>
                <img :src="closeIcon" alt="close" class="cursor-pointer" @click="shellState.tour = false" />
            </div>
        </template>
        <template #body>
            <div class="overflow-y-auto style-scroll mh-100 pt-5px">
                <template v-if="tourList.length">
                    <div v-for="item in tourList" :key="item.id" class="notification p5px-p15px">
                        <div class="p-9px d-flex tour-box-card justify-content-between">
                            <div class="d-flex position-re align-items-center">
                                <img class="tour_image" :src="tourImages[item.image] || defaultUserIcon" :alt="item.image" />
                                <div class="d-flex ml-1 flex-column comment__notification-message">
                                    <strong class="tour__title font-weight-700 black font-size-16">{{ item.title }}</strong>
                                    <div class="tour__description font-weight-500 font-size-14 GunPowder pr-10px overflow-hidden" :title="item.description">{{ item.description }}</div>
                                </div>
                            </div>
                            <div class="text-center">
                                <span class="image_wrapper_tour">
                                    <img class="cursor-pointer" :src="!item.isCompleted ? tourComplete : tourRemain" alt="toggle" @click="handleTourOps(item)" />
                                </span>
                            </div>
                        </div>
                    </div>
                </template>
                <div v-else class="text-center red py-10px">{{ $t('Filters.no_data_found') }}</div>
            </div>
        </template>
    </Sidebar>
</template>

<script setup>
import { inject, ref, watch } from "vue";
import { useStore } from "vuex";
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import NotepadPanel from "@/components/molecules/Notepad/NotepadPanel.vue";
import ClipsPanel from "@/components/molecules/Clips/ClipsPanel.vue";
import ReminderPanel from "@/components/molecules/GeneralReminder/ReminderPanel.vue";
import ClipRecorder from "@/components/molecules/ClipRecorder/ClipRecorder.vue";
import TalkToTextPopover from "@/components/molecules/TalkToText/TalkToTextPopover.vue";
import { useGetterFunctions } from "@/composable/index.js";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import { shellState } from "./shellState";

const { getters, commit } = useStore();
const { getUser } = useGetterFunctions();
const userId = inject("$userId");
const defaultUserIcon = inject("$defaultUserAvatar");

const closeIcon = require("@/assets/images/svg/CloseSidebar.svg");
const tourComplete = require("@/assets/images/svg/tourcomplete.svg");
const tourRemain = require("@/assets/images/svg/tourremain.svg");
const tourImages = {
    ai_tour: require("@/assets/images/svg/ai_tour.svg"),
    automate_screen_tour: require("@/assets/images/svg/automate_screen_tour.svg"),
    custom_field_tour: require("@/assets/images/svg/custom_field_tour.svg"),
    dependencies_tour: require("@/assets/images/svg/dependencies_tour.svg"),
    project_listing_tour: require("@/assets/images/svg/project_listing_tour.svg"),
    task_details_tour: require("@/assets/images/svg/task_details_tour.svg"),
    template_tour: require("@/assets/images/svg/template_tour.svg"),
    time_tracker_tour: require("@/assets/images/svg/time_tracker_tour.svg"),
    timesheet_tour: require("@/assets/images/svg/timesheet_tour.svg")
};

const tourList = ref([]);
watch(() => shellState.tour, (open) => {
    if (open) tourList.value = JSON.parse(JSON.stringify(getters["ToursData/Tours"] || []));
});

const saveTour = (tour, after) => apiRequestWithoutCompnay("put", env.USER_UPATE, {
    userId: userId.value,
    updateObject: { $set: { tour } },
    newObj: { returnDocument: "after" }
}).then(after).catch((error) => console.error("ERROR in handleTourOps", error));

function handleTourOps(tourObject, completeAll = false) {
    if (completeAll) {
        const tours = tourList.value.reduce((acc, t) => ({ ...acc, [t.id]: true }), {});
        return saveTour(tours, (response) => {
            tourList.value = tourList.value.map((t) => ({ ...t, isCompleted: true }));
            commit("ToursData/mutateTours", tourList.value);
            commit("users/mutateUsers", { data: { ...response.data.data, tourStatus: tourObject }, op: "modified" });
        });
    }
    const tour = { ...(getUser(userId.value)?.tourStatus || {}), [tourObject.id]: !tourObject.isCompleted };
    return saveTour(tour, (response) => {
        const i = tourList.value.findIndex((t) => t.id === tourObject.id);
        if (i === -1) return;
        tourList.value[i] = { ...tourList.value[i], isCompleted: !tourObject.isCompleted };
        commit("ToursData/mutateSingleTours", { id: tourObject.id, isCompleted: !tourObject.isCompleted });
        commit("users/mutateUsers", { data: { ...response.data.data, tourStatus: tourObject }, op: "modified" });
    });
}
</script>
