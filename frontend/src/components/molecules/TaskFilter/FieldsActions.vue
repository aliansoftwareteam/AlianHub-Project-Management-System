<template>
    <div class="d-flex justify-content-between w-100 save-filter-wrapper">
        <div class="save-filter-section d-flex align-items-center cursor-pointer" v-if="from === ''">
            <span class="text">
                <DropDown v-if="!isEdit" :bodyClass="{'save-thisfilters-dropdown' : true}" z-index="999">
                    <template #head>
                        <div class="d-flex align-items-center justify-content-between mobile__field-actions" v-if="clientWidth <=767">
                            <a href="#" class="mr-10px" @click.stop.prevent="$refs.saveFilterRef.click(), inputName='', isInvalid=false" :class="{'font-size-16' : clientWidth <=767 }" :style="{color : clientWidth <=767 ? '#646464' : '#2F3990'}">{{$t('Projects.cancel')}}</a>
                            <span :class="{'font-size-20 font-weight-500' : clientWidth <=767 }" :style="{color : clientWidth <=767 ? '#090A0A' : ''}">{{$t('Filters.save_this_filters')}}</span>
                            <button class="btn-primary p-0 bg-transparent" type="button" @click.stop.prevent="$emit('save', inputName), resetField()" :class="{ 'font-size-18 font-weight-700' : clientWidth <= 767}" :style="{color : clientWidth <=767 ? '#2F3990' : ''}" >{{$t('Projects.save')}}</button>
                        </div>
                    </template>
                    <template #button>
                        <span ref="saveFilterRef">{{ $t('Filters.save_filters') }}</span>
                    </template>
                    <template #options>
                        <div :style="{width : clientWidth <=767 ? '100%' : ' 254px'}" class="savedfilter-input-wrapper" >
                            <h5 class="font-weight-500 font-size-15"  v-if="clientWidth > 767">{{$t('Filters.save_this_filters')}}</h5>
                            <div class="hr__bottom"  v-if="clientWidth > 767"></div>
                            <div class="savefilter-inputserach-wrapper">
                                <InputText
                                    type="text"
                                    :maxLength="50"
                                    :minLength="3"
                                    v-model.trim="inputName"
                                    :placeHolder="$t('Filters.Enter_Filter_Name')"
                                    :isDirectFocus="true"
                                    :class="{'border-red': isInvalid}"
                                    autocomplete="off"
                                    @enter="$emit('save', inputName), resetField()"
                                />
                                <div class="d-flex align-items-center justify-content-end m10px-0px" v-if="clientWidth > 767">
                                    <a href="#" class="mr-10px blue" @click.stop.prevent="$refs.saveFilterRef.click(), inputName='', isInvalid=false">{{$t('Projects.cancel')}}</a>
                                    <button class="btn-primary save__btn" type="button" @click.stop.prevent="$emit('save', inputName), resetField()" :class="{'font-size-12': clientWidth > 767}">{{$t('Projects.save')}}</button>
                                </div>
                            </div>
                        </div>
                    </template>
                </DropDown>
                <span v-if="isEdit" @click="$emit('update', $event)">{{$t('Filters.update_filter')}}</span>
            </span>
            <span class="drop-icon">
                <DropDown mode="listbox" :bodyClass="{'update-searchfilter-dropdown' : true}" z-index="999">
                    <template #head>
                        <div class="d-flex align-items-center justify-content-between mobile__field-actions" v-if="clientWidth <=767" >
                            <a href="#" class="mr-10px blue" @click.stop.prevent="$refs.saveFilterRef.click(), inputName='', isInvalid=false" :class="{'font-size-16' : clientWidth <=767 }" :style="{color : clientWidth <=767 ? '#646464' : '#2F3990'}">{{$t('Projects.cancel')}}</a>
                            <h3 :class="{'font-size-20 font-weight-500' : clientWidth <=767 }" :style="{color : clientWidth <=767 ? '#090A0A' : ''}">{{$t('Filters.my_filter')}}</h3>
                            <button class="btn-primary p-0 bg-transparent" type="button" @click.stop.prevent="$emit('save', inputName), resetField()" :class="{ 'font-size-18 font-weight-700' : clientWidth <= 767}" :style="{color : clientWidth <=767 ? '#2F3990' : ''}" >{{ $t('Projects.save') }}</button>
                        </div>
                    </template>
                    <template #button>
                        <img ref="saveFilterRef" src="@/assets/images/svg/save_filter_fdropdown.svg" :alt="$t('Filters.my_filter')" class="saveFilterDropArrow position-re"/>
                    </template>
                    <template #options>
                        <div :style="{width : clientWidth <=767 ? '100%' : ' 225px'}" class="saved-filters">
                            <div class="savefilter-inputserach-wrapper">
                            <InputText
                                type="text"
                                v-model.trim="search"
                                :placeholder="$t('Projects.search')"
                                :isDirectFocus="true"
                                autocomplete="off"
                            />
                            </div>
                            <div class="mt-10px border-top-lightwhite" v-if="clientWidth > 767">
                                <h5 class="filter-list-title p0x-10px">{{ $t('Filters.my_filter') }}</h5>
                            </div>
                            <div class="saved-filterdropdownlist-wrapper">
                                <DropDownOption v-for="(item, index) in filteredOptions" :key="index" class="dropdown-item justify-content-between saved-filters-dropdown" :class="{'edit-input-mobile' : clientWidth <=767 && item.isEdit }" @click="!item.isEdit && $emit('apply', {item: item, type: 'saved'})">
                                    <span class="saved-serach-title text-capitalize w-100 font-size-14" v-if="!item.isEdit"
                                    :style="{color : clientWidth > 767 ? '#818181' : '#3B3B3B' }"
                                    >{{ $t(`${ item.name }`)}}</span>
                                    <InputText v-if="item.isEdit" type="text" @enter="updateFilter(item)" v-model.trim="filterName" :isDirectFocus="true" autocomplete="off" :class="[{'border-red': isInvalid}]" :style="{maxWidth: clientWidth >767 ? '80%':'100%'}"/>
                                    <div v-if="item.isEdit" class="edit-delete-erapper">
                                        <img src="@/assets/images/svg/greencheck2.svg" alt="Edit" class="m0px-10px greencheck__img"  @click.stop="updateFilter(item)">
                                        <img src="@/assets/images/svg/deletered.svg" alt="Delete" @click.stop="item.isEdit=false,isInvalid=false">
                                    </div>
                                    <div v-if="!item.isEdit" class="hover-action">
                                        <img src="@/assets/images/svg/edit_gray.svg" alt="Edit" class="mr-10px" @click.stop="editFilter(item)">
                                        <img src="@/assets/images/svg/deletered.svg" alt="Delete" @click.stop="$emit('delete', item)">
                                    </div>
                                </DropDownOption>
                                <div v-if="!filteredOptions.length" class="gray81 m11px-0px">{{$t('Filters.no_data_found')}}</div>
                            </div>
                         </div>
                    </template>
                </DropDown>
            </span>
        </div>
        <div class="action-section">
            <a href="#" class="mr-10px" @click.stop.prevent="$emit('clear', $event)" v-if="clientWidth > 767"  :class="{'font-weight-400 font-size-12' : clientWidth > 767 }">{{ $t('Filters.clearall') }}</a>
            <button v-if="from === ''" class="btn-primary font-ui" type="button" @click.stop.prevent="$emit('apply', {item: $event, type: 'custom'})">{{ $t('Filters.show_result') }}</button>
        </div>
    </div>
</template>

<script setup>
// Packages
import { ref, defineProps, defineEmits, computed, inject } from 'vue';

// Component
import InputText from '@/components/atom/InputText/InputText.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

// Emites
defineEmits(["apply", "save", "update", "delete", "clear"])

// Props
const props = defineProps({
    filters: {
        type: Array,
        default: () => []
    },
    isEdit: {
        type: Boolean,
        default: false
    },
    getFiltersData: {
        type: Function
    },
    handleUpdate: {
        type: Function
    },
    from: {
        type: String,
        default: ''
    }
})

// Variables
const clientWidth = inject("$clientWidth");
const search = ref('');
const inputName = ref('');
const filterName = ref('');
const docId = ref('');
const saveFilterRef = ref('');
const isInvalid = ref(false);

/**
 * This function is used to filter data in already saved filter in the dropdown
 */
const filteredOptions = computed(() => {
    return props.filters.filter((item) => {
        return item.name.toLowerCase().includes(search.value.toLowerCase());
    })
})

/**
 * This function is used to handle edit filter name emit event
 */
const editFilter = (item) => {
    item.isEdit = true;
    filterName.value = item.name;
    docId.value = item._id;
}

/**
 * This function is used to update filter name
 */
const updateFilter = (item) => {
    if (filterName.value === '') {
        isInvalid.value = true;
        return;
    }
    isInvalid.value = false;
    item.isEdit = false;
    item.name = filterName.value;
    const obj = { name: filterName.value, id: docId.value }
    props.handleUpdate(obj).then(() => {
        props.getFiltersData()
    })
}

/**
 * Reset save input value and refs event emits after save
 */
const resetField = () => {
    if (inputName.value === "") {
        isInvalid.value = true;
        return;
    }
    saveFilterRef.value.click();
    inputName.value = "";
    isInvalid.value = false;
}
</script>

<style scoped>
.mobile__field-actions{
    margin-top: -4px;
}
.savedfilter-input-wrapper h5{
    padding: 10px 10px 0 10px;
}
.hr__bottom{
    margin: 10px 0px 11px 0;
    border-bottom: 1px solid #f2f2f2;
}
.save__btn
{
    padding: 0 13.33px;
}
.saveFilterDropArrow{
    top: -1px;
}
.greencheck__img{
    width: 15px;
}
</style>