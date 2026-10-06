<template>
    <DropDown 
        mode="listbox"
        :multiselectable="isMultiSelect"
        :id="props.id"
        @isVisible="handleClose()" 
        maxHeight="20dvh" 
        :keepSameWidth="true" 
        :zIndex="10" 
        :zindexCustomDrop="8"
    >
        <template #button>
            <div :ref="props.id" class="custom-field" :class="{'d-flex align-items-center justify-content-between': clientWidth > 480}">
                <label class="custom-field-label" :class="{'w-35': clientWidth > 480,'mb-5px': clientWidth <= 480}" :for="`field`">
                    {{ $t(`dashboardCard.${props?.field?.label}`) }}
                </label>
                
                <div v-if="isMultiSelect && selectedItems.length" class="custom-field-input d-flex align-items-center" :class="{'w-65': clientWidth > 480}">
                    <template v-if="displayType === 'text' || displayType === 'project'">
                        <span v-for="(item, ind) in selectedItems.slice(0, 2)" :key="ind" class="ml-1 drop-down-list-component-black drop-down-list-component-font-size-14 text-ellipsis mw-90px">
                            {{ getDisplayText(item) }}
                            <span v-if="ind < selectedItems.slice(0, 3).length - 1">,</span>
                        </span>
                        <div v-if="selectedItems.length > 2" class="additional-users-count">
                            +{{ selectedItems.length - 2 }}
                        </div>
                        
                    </template>
                    
                    <template v-else-if="displayType === 'profile'">
                        <div v-for="(item, ind) in selectedItems.slice(0, 2)" :key="ind">
                            <div v-if="item.startsWith('tId_')">
                                <span 
                                    class="status_square ml-1 team-assign_round" 
                                    :style="{color: items?.find(e => e[props.matchField] === item)?.teamColor?.color, backgroundColor: items?.find(e => e[props.matchField] === item)?.teamColor?.bgColor}"
                                >
                                    {{ items?.find(e => e[props.matchField] === item)?.Employee_Name.charAt(0) }}
                                </span>
                            </div>
                            <UserProfile 
                                v-else
                                :showDot="false" 
                                :isBorder="false" 
                                :data="{ 
                                    image: items?.find(e => e[props.matchField] === item)?.Employee_profileImageURL, 
                                    title: items?.find(e => e[props.matchField] === item)?.Employee_Name
                                }" 
                                width="18px" 
                                height="18px" 
                                :thumbnail="'20x20'" 
                            />
                        </div>
                        <div v-if="selectedItems.length > 2" class="additional-users-count">
                            +{{ selectedItems.length - 2 }}
                        </div>
                    </template>
                    
                    <template v-else-if="displayType === 'color'">
                        <div v-for="(item, ind) in selectedItems.slice(0, 2)" :key="ind">
                            <span 
                                class="status_square ml-1" 
                                :style="{backgroundColor: items?.find(e => e?.key === item)?.textColor}"
                            ></span>
                            <span class="ml-1 drop-down-list-component-black drop-down-list-component-font-size-14 text-ellipsis mw-90px">
                                {{ getDisplayText(item) }}
                                <span v-if="ind < selectedItems.slice(0, 3).length - 1">,</span>
                            </span>
                        </div>
                        <div v-if="selectedItems.length > 2" class="additional-users-count">
                            +{{ selectedItems.length - 2 }}
                        </div>
                    </template>
                </div>
                
                <div v-else-if="!isMultiSelect && (selectedItem || selectedItem === 0)" class="custom-field-input d-flex align-items-center" :class="{'w-65': clientWidth > 480}">
                    <template v-if="displayType === 'text'">
                        <span class="ml-1 drop-down-list-component-black drop-down-list-component-font-size-14">
                            {{ getDisplayText(selectedItem) }}
                        </span>
                    </template>
                    
                    <template v-else-if="displayType === 'profile'">
                        <div v-if="item.startsWith('tId_')">
                            <span 
                                class="status_square ml-1 team-assign_round" 
                                :style="{color: items?.find(e => e[props.matchField] === item)?.teamColor?.color, backgroundColor: items?.find(e => e[props.matchField] === item)?.teamColor?.bgColor}"
                            >
                                {{ items?.find(e => e[props.matchField] === item)?.Employee_Name.charAt(0) }}
                            </span>
                        </div>
                        <UserProfile 
                            v-else
                            :showDot="false" 
                            :isBorder="false" 
                            :data="{ 
                                image: items?.find(e => e[props.matchField] === item)?.Employee_profileImageURL, 
                                title: items?.find(e => e[props.matchField] === item)?.Employee_Name
                            }" 
                            width="18px" 
                            height="18px" 
                            :thumbnail="'20x20'" 
                        />
                    </template>
                    
                    <template v-else-if="displayType === 'color'">
                        <span 
                            class="status_square" 
                            :style="{backgroundColor: items?.find(e => e?.key === selectedItem)?.textColor}"
                        ></span>
                        <span class="ml-1 drop-down-list-component-black drop-down-list-component-font-size-14">
                            {{ getDisplayText(selectedItem) }}
                        </span>
                    </template>
                </div>
                
                <div v-else :class="{'w-65': clientWidth > 480}">
                    <div 
                        class="custom-field-input" 
                        :class="{'border-red':props.error}"
                    >
                        {{ $t(`dashboardCard.select`) }}
                    </div>
                    <div v-if="props.error" class="">
                        <ToolTip :isImage="true" :text="props.error" />
                    </div>
                </div>
            </div>
        </template>
        
        <template #search>
            <div class="d-flex align-items-center justify-content-between pb-15px">
                <div :class="{isMultiSelect:'input-wrapper'}" class="w-100">
                    <InputText
                        v-model="search"
                        :place-holder="$t('PlaceHolder.search')"
                        type="text"
                        :isOutline="false"
                        @keyup="handleSearch"
                    />
                </div>
                <div v-if="isMultiSelect && filteredItems.length && props?.field?.label === 'location'" class="assigned-to-me">
                    <span
                        class="d-block cursor-pointer"
                        @click="assignedToMe"
                    >
                        {{$t('Projects.Assigned_to')}} {{$t('Projects.me')}}
                    </span>
                </div>
                <div v-if="isMultiSelect && filteredItems.length" class="no-result">
                    <span
                        class="d-block cursor-pointer"
                        @click="toggleSelectAll"
                    >
                        {{ items.length === selectedItems.length
                            ? $t('Filters.unselect_all')
                            : $t('Filters.select_all')
                        }}
                    </span>
                </div>
            </div>
        </template>

        <template #options>
            <div>
                <template v-if="filteredItems.length">
                    <DropDownOption 
                        v-for="(item, i) in filteredItems" 
                        :key="`item-${i}`"
                        :selected="isSelected(item)"
                        @click="handleItemSelect(item),!isMultiSelect? $refs[props.id].click() : null"
                    >
                        <div 
                            class="user-content d-flex align-items-center"
                            :class="{'activeClass': isSelected(item)}"
                        >
                            <template v-if="displayType === 'profile'">
                                <div v-if="item._id.startsWith('tId_')">
                                    <span 
                                        class="status_square ml-0 team-assign_round1" 
                                        :style="{border: '2px solid ' + (items?.find(e => e[props.matchField] === item[props.matchField])?.teamColor?.bgColor || 'transparent') , color: items?.find(e => e[props.matchField] === item[props.matchField])?.teamColor?.color, backgroundColor: items?.find(e => e[props.matchField] === item[props.matchField])?.teamColor?.bgColor}"
                                    >
                                        {{ items?.find(e => e[props.matchField] === item[props.matchField])?.Employee_Name.charAt(0) }}
                                    </span>
                                </div>
                                <UserProfile decorative 
                                    v-else
                                    :showDot="false" 
                                    :isBorder="false" 
                                    :data="{ 
                                        image: items?.find(e => e[props.matchField] === item[props.matchField])?.Employee_profileImageURL, 
                                        title: items?.find(e => e[props.matchField] === item[props.matchField])?.Employee_Name
                                    }" 
                                    width="26px" 
                                    height="25px" 
                                    :thumbnail="'30x30'" 
                                />
                                <span class="employee-name ml-1">
                                    {{ items?.find(e => e[props.matchField] === item[props.matchField])?.Employee_Name}} {{items?.find(e => e[props.matchField] === item[props.matchField])?.teamColor ? ` (Team)` : ""}}
                                </span>
                            </template>
                            
                            <template v-else-if="displayType === 'color'">
                                <div class="project-custom-checkbox d-flex align-items-center justify-content-between w-100" :class="{'h-20': clientWidth > 767}">
                                    <div class="d-flex align-items-center">
                                        <span 
                                            class="status_square" 
                                            :style="{backgroundColor:items?.find(e => e?.key === item.key)?.textColor}"
                                        ></span>
                                        <span class="ml-1">
                                            {{ getDisplayTextOption(item) }}
                                        </span>
                                    </div>
                                    <input 
                                        v-if="isMultiSelect" 
                                        type="checkbox" 
                                        :checked="isSelected(item)" 
                                    />
                                    <span class="project-checkbox-mark"></span>
                                </div>
                            </template>

                            <template v-else-if="displayType === 'project'">
                                <div class="d-flex align-items-center justify-content-between w-100 project-custom-checkbox" :class="{'h-20': clientWidth > 767}">
                                    <span class="d-flex align-items-center">
                                        <span v-if="item.projectIcon && item.projectIcon.type === 'color'" class="d-flex align-items-center justify-content-center drop-down-list-component-font-weight-400 inital-box" :style="[{'background-color': item.projectIcon.data}]">
                                            {{ item.ProjectName.charAt(0).toUpperCase()}}
                                        </span>
                                        <WasabiImage v-if="item.projectIcon && item.projectIcon.type === 'image'" :data="{ url: item.projectIcon.data }" class="inital-box" />
                                        <span class="ml-5-px">{{ getDisplayTextOption(item) }}</span>
                                    </span>
                                    <input type="checkbox" :checked="selectedItems.includes(item._id)" />
                                    <span class="project-checkbox-mark"></span>
                                </div>
                            </template>
                            <template v-else>
                                <div v-if="props.isCheckBox" class="d-flex align-items-center justify-content-between w-100 project-custom-checkbox" :class="{'h-20': clientWidth > 767}">
                                    <span class="ml-1">
                                        {{ getDisplayTextOption(item) }}
                                    </span>
                                    <input type="checkbox" :checked="selectedItems.includes(item.id)" />
                                    <span class="project-checkbox-mark"></span>
                                </div>
                                <div v-else> 
                                    <span class="ml-1">
                                        {{ getDisplayTextOption(item) }}
                                    </span>
                                </div>
                            </template>
                        </div>
                    </DropDownOption>
                </template>
                
                <template v-else>
                    <DropDownOption>
                        <div class="drop-down-list-component-font-size-13 p0x-15px drop-down-list-component-gray81">
                            {{$t('UserTimesheet.no_records_found')}}
                        </div>
                    </DropDownOption>
                </template>
            </div>
        </template>
    </DropDown>
</template>

<script setup>
import { ref, computed, inject } from 'vue';
import { useI18n } from "vue-i18n";

import InputText from "@/components/atom/InputText/InputText.vue";
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import ToolTip from '@/components/molecules/ToolTip/ToolTip.vue';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
const userId = inject('$userId');

const { t } = useI18n();

const props = defineProps({
    id: {
        type: String,
        required: true
    },
    items: {
        type: Array,
        required: true
    },
    selectedItem: {
        type: [Object, Number, String],
        default: null
    },
    selectedItems: {
        type: [Array, Number],
        default: () => []
    },
    field: {
        type: Object,
        required: true
    },
    isMultiSelect: {
        type: Boolean,
        default: false
    },
    isMultiLanguage: {
        type: Boolean,
        default: false
    },
    isCheckBox: {
        type: Boolean,
        default: false
    },
    displayType: {
        type: String,
        default: 'text',
        validator: (value) => ['text', 'profile', 'color', 'project'].includes(value)
    },
    error: {
        type: String,
        default: ''
    },
    searchKey: {
        type: String,
        default: 'name'
    },
    matchField: {
        type: String,
        default: '_id'
    },
    getDisplayText: {
        type: Function,
        default: (item) => item?.name || item
    },
    getDisplayTextOption: {
        type: Function,
        default: (item) => item?.name || item
    }
});

const emit = defineEmits(['update:selected']);
const clientWidth = inject("$clientWidth");
const search = ref('');
const filteredItems = computed(() => {
    if (!search.value.trim()) return props.items;
    return props.items.filter(item => 
        props.isMultiLanguage ? t(`dashboardCard.${item?.[props.searchKey]}`)?.toLowerCase().includes(search.value.toLowerCase()) : item?.[props.searchKey]?.toLowerCase().includes(search.value.toLowerCase())
    );
});

const handleClose = () => {
    search.value = '';
};

const handleSearch = () => {};

const handleItemSelect = (item) => {
    
    if (props.isMultiSelect) {
        const currentSelection = [...props.selectedItems];
        const index = currentSelection.findIndex(selected => 
            JSON.stringify(selected) === JSON.stringify(item[props.matchField])
        );

        if (index === -1) {
            currentSelection.push(item[props.matchField]);
        } else {
            currentSelection.splice(index, 1);
        }

        emit('update:selected', currentSelection,props.field);
    } else {
        emit('update:selected', item,props.field);
    }
};

const isSelected = (item) => {
    if (props.isMultiSelect) {
        return props.selectedItems.some(selected => 
            JSON.stringify(selected) === JSON.stringify(item[props.matchField])
        );
    }
    return props.selectedItem === item;
};

const toggleSelectAll = () => {
    if (props.isMultiSelect) {
        const allSelected = props.items.length === props.selectedItems.length;
        emit('update:selected', allSelected ? [] : [...props.items.map(e => e[props.matchField])],props.field);
    }
};

const assignedToMe = () => {
    if (props.isMultiSelect) {
        const publicProject = props.items.filter((x) => !x.isPrivateSpace) || [];
        const assignedToMeProject = props.items.filter((x) => x.isPrivateSpace && x.AssigneeUserId.indexOf(userId) !== -1) || [];
        const finalProject = [...publicProject, ...assignedToMeProject];
        emit('update:selected', [...finalProject.map(e => e[props.matchField])],props.field);
    }
};
</script>

<style scoped src="../../../components/molecules/CardFieldComponent/style.css"></style>

<style scoped>
.drop-down-list-component-black {
    color: var(--ink);
}
.drop-down-list-component-font-size-14 {
    font-size: 14px;
}
.drop-down-list-component-font-weight-400 {
    font-weight: 400 !important;
}
.drop-down-list-component-font-size-13 {
    font-size: 13px;
}
.drop-down-list-component-gray81 {
    color: var(--ink-2);
}
</style>
