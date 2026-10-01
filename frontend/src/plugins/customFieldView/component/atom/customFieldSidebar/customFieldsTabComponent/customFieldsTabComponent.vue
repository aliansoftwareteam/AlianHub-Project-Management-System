<template>
    <template v-for="(tabs,index) in tabArray" :key="index">
        <div class="d-flex align-items-center pt-20px mb-20px custom_field-border custom_field-tabs" role="tablist" v-if="tabs.type === props.componentDetail.cfType">
            <button
                v-for="(tabValue,ind) in tabs.tab" :key="ind"
                type="button"
                role="tab"
                :aria-selected="tabIndex === ind + 1 ? 'true' : 'false'"
                :class="{'is-active' : tabIndex === ind + 1}"
                class="custom_field-tab"
                @click="tabIndex = ind + 1,emit('handleIndex',ind + 1)"
            >
                {{tabValue}}
            </button>
        </div>
    </template>
</template>

<script setup>
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
<style>
.custom_field-tabs { gap: 40px; }
.custom_field-tab {
    margin: 0;
    padding: 0 0 7px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--ink-2);
    font: 500 14px/30px var(--font-ui);
    cursor: pointer;
}
.custom_field-tab.is-active { border-bottom-color: var(--brand); color: var(--ink); }
.custom_field-tab:focus-visible { outline: none; border-radius: 4px; box-shadow: var(--focus); }
</style>
