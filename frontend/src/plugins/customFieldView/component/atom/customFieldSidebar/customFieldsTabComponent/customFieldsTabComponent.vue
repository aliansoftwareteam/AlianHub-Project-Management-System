<template>    
    <template v-for="(tabs,index) in tabArray" :key="index">
        <div class="d-flex align-items-center pt-20px mb-20px custom_field-border" v-if="tabs.type === props.componentDetail.cfType">
            <h4 
                v-for="(tabValue,ind) in tabs.tab" :key="ind"
                :class="[{'activeClass' : tabIndex === ind + 1,'mr-40px':tabs.tab.length !== ind +1}]" 
                class="font-roboto-sans font-size-14 font-weight-500 line-height-30px m-0 GunPowder cursor-pointer pb-7px" 
                @click="tabIndex = ind + 1,emit('handleIndex',ind + 1)"
            >
                {{tabValue}}
            </h4>
        </div>
    </template>
</template>

<script setup>
    //import
    import { ref, watch } from "vue";
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    const tabArray = ref([
        {
            type:'text',
            tab:[t('general.general'),t('Filters.options')]
        },
        {
            type: 'checkbox',
            tab: [t('general.general')]
        },
        {
            type:'dropdown',
            tab:[t('general.general'), t('Filters.options'), t('general.advanced')]
        },
        {
            type:'date',
            tab:[t('general.general'),t('Filters.options'),t('Projects.time'),t('general.limits')]
        },
        {
            type:'money',
            tab:[t('general.general'), t('Filters.options')]
        },
        {
            type:'textarea',
            tab:[t('general.general'), t('Filters.options')]
        },
        {
            type:"number",
            tab:[t('general.general'),t('Filters.options')]
        },
        {
            type:"phone",
            tab:[t('general.general'),t('Filters.options')]
        },
        {
            type:"email",
            tab:[t('general.general')]
        },
        {
            type:'formula',
            tab:[t('general.general')]
        },
        {
            type:'rollup',
            tab:[t('general.general')]
        }
    ]);
    const emit = defineEmits(['handleIndex']);
    const props = defineProps({
        componentDetail:{
            type:Object,
            default:() => {}
        },
        tabIndexComp:{
            type:Number,
            default:1
        }
    });
    const tabIndex = ref(props.tabIndexComp)
    watch(() => props.tabIndexComp , (val)=>{
        tabIndex.value = val;
    });
</script>
