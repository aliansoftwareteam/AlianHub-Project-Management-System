<template>
    <div class="dis-dropdown-custom-field" v-if="render">
        <div :class="props.isProjectDetail ? 'formkit__content-wrapper-project-detail' : 'formkit__content-wrapper'">
            <div class="">
                <div class="formkit-outer" data-family="text" data-type="text" data-empty="true">
                    <div class="formkit-wrapper">
                        <div class="formkit-label__wrapper">
                            <label class="formkit-label">
                                <img class="custom__field-image" :src="getImageData(props.detail.fieldImageGrey)">
                                <ToolTip :label="props?.detail?.fieldTitle" :text="props?.detail?.fieldDescription" :showReadMore="true" width="150px" />
                            </label>
                            <span>
                                <img @click="handleEdit" :src="editIconImage" class="formkit-label__image pr-22px cursor-pointer" />
                            </span>
                        </div>
                        <div class="formkit-inner">
                            <div class="d-flex justify-content-between w-100">
                                <a v-if="!items?.length && !checkDefault.length" class="formkit-input" @click="isVisible = true">{{ detail.fieldPlaceholder }}</a>
                                <div class="d-flex" v-else>
                                    <div class="mr-10px font-size-12 font-weight-400 cursor-pointer" v-for="(item) in items && items.length ? items || [] : checkDefault || []" :key="item.id" @click="isVisible = true">
                                        <span class="d-block border-radius-15-px p3x-14px" :style="[{ color: item.color, backgroundColor: item.color + '20' }]">
                                            {{ item.label }}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <Sidebar
            v-model:visible="isVisible"
            :title="$t('CustomField.select_field', { field: detail.fieldTitle })"
            :enable-search="true"
            :options="detail.fieldOptions || []"
            @selected="selectedObj($event)"
            :zIndex="8"
            :listenKeys="true"
        />
    </div>
</template>

<script setup>
// Packages
import ToolTip from "@/components/molecules/ToolTip/ToolTip.vue";
import { ref, defineProps, defineEmits, onMounted,watch, nextTick } from "vue";
import useCustomFieldImage from '@/composable/customFieldIcon.js';
const { getImageData } = useCustomFieldImage();

// Components
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';

// Props
const props = defineProps({
    detail: {
        type: Object,
        default: () => {}
    },
    isProjectDetail:{
        type: String,
        default: ''
    }
});

// Emits
const emit = defineEmits(['blurUpdate','handleEdit']);

// Variables
const isVisible = ref(false);
const details = ref(props.detail);
const items = ref([]);
const checkDefault = ref([]);
const render = ref(true);

const editIconImage = require("@/assets/images/editing.png");

const optionsOf = (detail) => JSON.parse(JSON.stringify(Array.isArray(detail?.fieldOptions) ? detail.fieldOptions : []));

watch(() => props.detail, (newVal) => {
    if(newVal){
        items.value = optionsOf(newVal).filter(x => newVal?.fieldValue?.includes(x.id));
        checkDefault.value = optionsOf(newVal).filter((x) => x.selected === true);
        details.value = newVal;
    }
});

onMounted(() => {
    render.value = false;
    nextTick(()=>{
        if(props.detail && props?.detail?.fieldValue) {
            details.value = props.detail;
            items.value = optionsOf(props.detail).filter(x => props.detail?.fieldValue?.includes(x.id));
        }
        checkDefault.value = optionsOf(props.detail).filter((x) => x?.selected === true);
        render.value = true;
    });
})

const selectedObj = (obj) => {
    items.value = optionsOf(props.detail).filter(x => x.id === obj.id);
    emit('blurUpdate', obj, props.detail, "");
}

const handleEdit = () => {
    emit('handleEdit',props?.detail)
}
</script>