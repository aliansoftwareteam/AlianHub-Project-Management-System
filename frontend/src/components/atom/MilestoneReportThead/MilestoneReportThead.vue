<template>
    <tr>
        <th class="fixed padding_warpper_sheet" rowspan="2">
            <div class="d-flex thtitle-wrapper justify-content-between">
                <div class="thtitle thtitle_family cursor-default text-left" v-for="(thead, tableHeadIndex) in tableHead" :key="tableHeadIndex">
                    {{$t(`Milestone.${thead}`)}}
                </div>
            </div>
        </th>
        <th colspan="100%">
            <div class="days-selected-dropdown">
                <SelectComp
                    :name="SelectionuiqId"
                    title=""
                    displayKey="name"
                    v-model="year1[0]"
                    :options="year"
                    :enableSearch="false"
                    :disabled="false"
                    class="select__component"
                    :selectImage="true"
                    @update:modelValue="(e)=>{handleDropDownYear(e)}"
                />
            </div>
            <div class="days-selected-dropdown days-selected-dropdown-value" v-if="days && days.length">
                <SelectComp
                    :name="SelectionuiqIds"
                    title=""
                    displayKey="name"
                    v-model="allMonths1[0]"
                    :options="allMonths"
                    :enableSearch="false"
                    :disabled="false"
                    class="select__component"
                    :selectImage="true"
                    @update:modelValue="(e)=>{handleDropDownMonth(e)}"
                />
            </div>
        </th>
    </tr>
    <tr class="fixed">
        <template v-if="days && days.length">
            <template v-for="(thead, tableHeadIndex) in days" :key="'H'+tableHeadIndex">
                <th :class="[{
                        'bg-color-highlight':new Date().getMonth() === new Date(thead.date).getMonth() && new Date().getDate() === tableHeadIndex + 1,
                        'border-color-highlight-left':new Date().getMonth() === new Date(thead.date).getMonth() && new Date().getDate() === tableHeadIndex + 1,
                        'border-color-highlight-left-next':new Date().getMonth() === new Date(thead.date).getMonth() && new Date().getDate() === tableHeadIndex
                    }]"
                >                                 
                    <div class="date_days_month month_avalue">
                        <span class="month_name_data">
                            <span class="monthDateFamily mr-day">{{tableHeadIndex < 9 ? '0' : ''}}{{tableHeadIndex + 1}}</span> <span class="monthDateFamily">{{ thead.day }}</span>
                        </span>
                    </div>
                </th>
            </template>
        </template>
        <template v-else>
            <template v-for="(thead, tableHeadIndex) in allMonths" :key="'H'+tableHeadIndex">
                <th :class="[{'bg-color-highlight':new Date().getMonth() === tableHeadIndex,'border-color-highlight-left':new Date().getMonth() === tableHeadIndex,'border-color-highlight-left-next':new Date().getMonth() + 1 === tableHeadIndex}]">                                 
                    <div class="date_days_month month_avalue">
                        <span class="month_name_data monthFamily cursor-pointer" @click="handleMonth(tableHeadIndex,year1[0].name)">{{ thead.name }}</span>
                    </div>
                </th>
            </template>
        </template>
    </tr>
</template>

<script setup>
    // import
    import { ref,defineEmits } from 'vue';
    import SelectComp from "@/components/molecules/Select/Select.vue"
    import { useCustomComposable } from '@/composable';
    import moment from 'moment';
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    // make unique id
    const { makeUniqueId} = useCustomComposable();
    const SelectionuiqId = `AssignedSelection${makeUniqueId(6)}`;
    const SelectionuiqIds = `AssignedSelection${makeUniqueId(6)}`;
    // emit 
    const emit = defineEmits(['yearEmit','monthDate'])
    // variable
    const tableHead = ref(['project_name', 'status_date', 'start_date', 'end_date']);
    const year1 = ref([
        {
            name: `${new Date().getFullYear()}`
        }
    ]);
    const allMonths1 = ref([
        {
            name:''
        }
    ]);
    const year= ref([
        {
            name: "2020"
        },
        {
            name: "2021"
        },
        {
            name: "2022"
        },
        {
            name: "2023"
        },
        {
            name: "2024"
        },
        {
            name: "2025"
        },
        {
            name: "2026"
        },
        {
            name: "2027"
        },
        {
            name: "2028"
        },
        {
            name: "2029"
        },
        {
            name: "2030"
        },
    ]);
    const allMonths= ref([
        {
            name: t('monthName.jan'),
            count: 0
        },
        {
            name: t('monthName.feb'),
            count: 1
        },
        {
            name: t('monthName.mar'),
            count: 2
        },
        {
            name: t('monthName.apr'),
            count: 3
        },
        {
            name: t('monthName.may'),
            count: 4
        },
        {
            name: t('monthName.jun'),
            count: 5
        },
        {
            name: t('monthName.jul'),
            count: 6
        },
        {
            name: t('monthName.aug'),
            count: 7
        },
        {
            name: t('monthName.sep'),
            count: 8
        },
        {
            name: t('monthName.oct'),
            count: 9
        },
        {
            name: t('monthName.nov'),
            count: 10
        },
        {
            name: t('monthName.dec'),
            count: 11
        }
    ]);
    const days = ref([]);
    
    // function select year
    const handleDropDownYear = (e) => {
        emit('yearEmit',e.name,e.name);
        emit('monthDate',[]);
        days.value = [];
    };
    const handleDropDownMonth = (e) => {
        days.value = [];
        const startDate = moment(`01-${e.name}-${year1.value[0].name}`, 'DD-MMMM-YYYY');
        const endDate = startDate.clone().endOf('month');
        const differ = endDate.diff(startDate, 'days');
        for (let i = 0; i <= differ; i++) {
            const date = startDate.clone().add(i, 'days');
            const day = date.format('ddd');
            days.value.push({ date: date.format('YYYY-MM-DD'), day });
        }
        emit('monthDate',days.value);
    }
    // month
    const handleMonth = (value,year) => {
        let month = value + 1;
        days.value = [];
        const startDate = moment(`01-${month}-${year}`, 'DD-MM-YYYY');
        const endDate = startDate.clone().endOf('month');
        const differ = endDate.diff(startDate, 'days');
        for (let i = 0; i <= differ; i++) {
            const date = startDate.clone().add(i, 'days');
            const day = date.format('ddd');
            days.value.push({ date: date.format('YYYY-MM-DD'), day });
        }
        allMonths1.value[0].name = allMonths.value[new Date(days.value[0].date).getMonth()].name
        emit('monthDate',days.value);
    }
</script>
<style scoped>
.select__component{
    width: 52px !important;
}
</style>
