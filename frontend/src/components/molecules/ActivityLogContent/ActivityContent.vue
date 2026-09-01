<template>
    <div class="d-flex align-items-center">
        <div v-if="isAlianActivity" class="alian-mark" aria-hidden="true">A</div>
        <UserProfile v-else class="log-use-profile" :data="data.userData" :show-dot="false" :width="'30px'" :thumbnail="'30x30'" />
        <div class="ml-015 wrapperNameImage">
            <span v-html="convert(data.Message)"></span>
            <span>&nbsp;{{getDateAndTime(data.createdAt == undefined ? new Date().getTime(): new Date(data?.createdAt).getTime())}}</span>
        </div>
    </div>
</template>
<script setup>
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import { computed, defineComponent,defineProps, inject, ref } from "vue";
import { useProjects } from '@/composable/projects';
import { useGetterFunctions } from "@/composable";
import moment from "moment";
import { useStore } from 'vuex';
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
const props = defineProps({
    data: Object,
});

const isAlianActivity = computed(() => String((props.data && props.data.UserId) || '') === 'alian' || String((props.data && props.data.Key) || '') === 'agent_writeback');

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
</script>
<style src="./style.css"></style>