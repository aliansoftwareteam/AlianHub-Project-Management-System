<template>
    <div class="d-flex align-items-center">
        <UserProfile class="log-use-profile" :data="data.userData" :show-dot="false" :width="'30px'" :thumbnail="'30x30'" />
        <div class="ml-015 wrapperNameImage">
            <span v-html="activityHtml(data.Message)"></span>
            <span>&nbsp;{{getDateAndTime(data.createdAt == undefined ? new Date().getTime(): new Date(data?.createdAt).getTime())}}</span>
        </div>
    </div>
</template>
<script setup>
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import { defineComponent,defineProps, inject, ref } from "vue";
import { useProjects } from '@/composable/projects';
import { useGetterFunctions } from "@/composable";
import moment from "moment";
import { useStore } from 'vuex';
import { notificationHtml } from "@/utils/notificationHtml";
const { getters } = useStore();

const {getDateAndTime} = useProjects();
const {getUser} = useGetterFunctions();
const userId = inject('$userId');
const dateFormatInject = inject('$dateFormat');
const dateFormat = ref(getters?.['settings/companyDateFormat']?.dateFormat || dateFormatInject?.value || 'DD/MM/YYYY');

defineComponent({
    name: "ActivityContent",
    components: {
        UserProfile
    },
})
defineProps({
    data: Object,
});

function convert(message) {
    const regex = /TIMESTAMP_[0-9]+/g;
    const dateRegex = /DATE_\d+/g;
    let updatedMessage = message;

    const matches = message.match(regex);
    const dateMatch = message.match(dateRegex);
    const format = getUser(userId.value).timeFormat;
    if (matches) {
        for (const match of matches) {
            const timestamp = match.replace("TIMESTAMP_", "");
            const formattedTime = Number(format) === 12
            ? moment(parseInt(timestamp)).format("hh:mm A")
            : moment(parseInt(timestamp)).format("HH:mm");
            updatedMessage = updatedMessage.replace(match, formattedTime);
        }
    }
    if (dateMatch) {
        const dateTimestamp = dateMatch[0].replace("DATE_", "");
        const formattedDate = moment(parseInt(dateTimestamp)).format(dateFormat.value);
        updatedMessage = updatedMessage.replace(dateMatch[0], formattedDate);
    }

    return updatedMessage;
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&#039;": "'", "&apos;": "'", "&#96;": "`", "&#40;": "(", "&#41;": ")" };

/* Writers escape names to different degrees, so the text is decoded once before notificationHtml escapes all of
 * it again. Older checklist rows put attributes on their <b>, which notificationHtml would otherwise show as text. */
function activityHtml(message) {
    const decoded = convert(String(message || ""))
        .replace(/<b\s[^>]*>/gi, "<b>")
        .replace(/&(amp|lt|gt|quot|apos|#39|#039|#96|#40|#41);/g, (entity) => ENTITIES[entity]);
    return notificationHtml(decoded);
}
</script>
<style src="./style.css"></style>