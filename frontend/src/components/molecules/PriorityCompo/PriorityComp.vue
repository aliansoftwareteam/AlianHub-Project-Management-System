<template>
    <div class="priority__component" :id="tourId">
        <div class="d-flex align-items-center cursor-pointer" @click.stop.prevent="permission ? visible = true : ''">
            <img
                v-if="isBundledPriorityImage(selectedPriority.image)"
                :src="companyPrioritiesIcons(priorityVal)?.statusImage"
                alt="priority_image" 
                :title="selectedPriority.name"
                class="priority__image"
            />
            <WasabiImage v-else
                class="priority__wasabi-image"
                :data="{ url: selectedPriority.image }"
            />
            <span v-if="showName" class="ml-10px">{{ selectedPriority.name }}</span>
        </div>
        <Sidebar
            :title="$t('Permissions.select_priorities')"
            v-model:visible="visible"
            :value="[{...selectedPriority}]"
            :options="priorityList"
            :enable-search="true"
            :closeOnBackDrop="true"
            @selected="selectedPriorityFromSidebar"
            :zIndex="zIndexPriority"
            :imageDisplayForPriority="true"
            :listenKeys="true"
        />
    </div>
</template>

<script setup>
//Import
import { defineProps, ref, defineComponent, defineEmits, computed, inject } from 'vue';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import { useGetterFunctions } from '@/composable/index';
import { companyPrioritiesIcons, isBundledPriorityImage } from '@/composable/commonFunction';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";

// UTILS
const { getPriorities } = useGetterFunctions();
const priorityList = getPriorities();
priorityList.map((ele)=>{
    if(ele.image == undefined) {
        ele.image = ele.statusImage
        return ele
    }
    return ele
})
const defaultTaskStatusImg = inject('$defaultTaskStatusImg')

const emit = defineEmits(["select"])

//Declare variables and components
defineComponent({
    name: "PriorityComp",
    components: {
        Sidebar
    }
})
const props = defineProps({
    priorityVal: {
        type: String,
        required: true
    },
    showName: {
        type: Boolean,
        required: false,
        default: false
    },
    permission: {
        type: Boolean,
        default: true
    },
    zIndexPriority: {
        type: Number,
        default: 7
    },
    tourId: {
        type: String,
        default: ''
    }
})

const visible = ref(false);

//define computed methods
const selectedPriority = computed(() => {
    let obj = {
        name: "N/A",
        image: defaultTaskStatusImg.value,
        value: ''
    }

    if(priorityList){
        let ind = priorityList.findIndex((x) => x.value === props.priorityVal);

        if(ind !== -1) {
            obj.name = priorityList[ind].name
            obj.image = priorityList[ind].statusImage
            obj.value = priorityList[ind].value
        }
    }
    return obj;
});

//define methods
function selectedPriorityFromSidebar(val) {
    if(val.value == props.priorityVal){
        return;
    }

    emit('select', val)
}
</script>
<style scoped>
.priority__wasabi-image{
    width: 10px !important; 
    height: 10px !important;
}
.priority__image{
    min-width: 11px !important;
    height: 11px !important;
}
</style>