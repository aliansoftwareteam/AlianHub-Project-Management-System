<template>
    <div class="fieldTable">
        <div class="mb-010 custom-filters-table" :id="`num-${index}`" v-for="(item, index) in inputs" :key="index" >
            <div class="custom-filters-detailwrapper">
                <div class="custom-filters-col" v-if="index == 0">
                    <span class="where-title d-flex align-items-center justify-content-between">
                        <span class="where-title-family black">
                            {{$t('Filters.where')}}
                        </span>
                        <span class="cursor-pointer custom-filters-col font-size-14 font-weight-400 gray81" :class="[{'font-size-16':clientWidth <= 768}]" v-if="inputs.length > 1" @click="$emit('delete', { item, index })">
                            {{$t('Templates.remove')}} 
                        </span>
                    </span>
                </div>
                <div class="custom-filters-col" v-if="index == 1">
                    <div class="custom-radio custom-radio-button-wrapper d-flex align-items-center justify-content-between">
                        <span>
                            <input type="radio" :id="'condition'+index" :value="item.condition === '&&' ? '||' : '&&'" v-model="item.condition" :disabled="index !== 1" @change="setAllOptions(item),$emit('apply', {item: $event, type: 'custom'})"/>
                            <label :for="'condition'+index" class="where-title-family black"
                                >{{ item.condition === '&&' ? 'And' : 'Or' }}
                                <img src="@/assets/images/svg/toggle_arrow.svg" alt="" width="9" class="up-downarrow" />
                            </label>
                        </span>
                        <span class="cursor-pointer font-size-14 font-weight-400 gray81" :class="[{'font-size-16':clientWidth <= 768}]" v-if="inputs.length > 1" @click="$emit('delete', { item, index })"> {{$t('Templates.remove')}} </span>               
                    </div>
                </div>
                <div class="custom-filters-col" v-if="index > 1">
                    <span class="where-title d-flex align-items-center justify-content-between"> 
                        <span class="where-title-family black">
                            {{ item.condition === '&&' ? 'And' : 'Or' }}
                        </span>
                        <span class="cursor-pointer font-size-14 font-weight-400 gray81" v-if="inputs.length > 1" @click="$emit('delete', { item, index })" :class="[{'font-size-16':clientWidth <= 768}]"> {{$t('Templates.remove')}} </span>
                    </span>
                </div>
                <div class="advancefilter-body-padding">
                    <div class="d-flex justify-content-between advance_padding_bottom_body">
                        <div class="custom-filters-col filter-status-fieldwrapper">
                            <CustomDropDown :className="`padding_wrapper_advance_filter advanceSearchFilter`" :zindexCustomDrop="props.zindexCustomDrop" :maxWidth="clientWidth > 767 ? '150px' : '100%'" :bodyClass="{'filter-status-dropdpown' : true}">
                                <template #head v-if="clientWidth <= 767">
                                    <div class="d-flex align-items-center justify-content-between cancel-title-donewrapper">
                                        <a href="#" class="mr-10px blue"  @click.stop.prevent="$refs.keyRefs[index].click(), inputName='', isInvalid=false"> {{$t('Projects.cancel')}}</a>
                                        <h3 class="filter-dropdownmobile-title">{{ $t('Filters.filtering_field') }}</h3>
                                        <span class="done" @click="$refs.keyRefs[index].click()">{{$t('Home.Done')}}</span>
                                    </div>
                                </template>
                                <template #button>
                                    <div ref="keyRefs" class="font-size-14 font-weight-400 select_wrrapper_family light_gray_color select_wrapper_option" :title="Object.keys(item.name).length > 0 ? `${$t(`Projects.${item.name.name}`)}` : $t('PlaceHolder.Select')">{{ Object.keys(item.name).length > 0 ? `${$t(`Projects.${item.name.name}`)}` : $t('PlaceHolder.Select')}}</div>
                                </template>
                                <template #options>
                                    <div v-if="mainOptions.length > 0">
                                        <div v-for="(option, i) in mainOptions" :key="i" class="cursor-pointer filter-status-field" @click="$refs.keyRefs[index].click(), resetFields(item), handleSelected('keys', item, option, index)">
                                            <span class="font-size-14 font-weight-400 gray4b">{{ `${$t(`Projects.${option.name}`)}` }}</span>
                                        </div>
                                    </div>
                                    <div v-else class="font-size-13 gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                </template>
                            </CustomDropDown>
                        </div>
                        <div class="custom-filters-col filter-operator" v-if="Object.keys(item.name).length > 0">
                            <CustomDropDown :className="`padding_wrapper_advance_filter advanceSearchFilter`" :zindexCustomDrop="props.zindexCustomDrop" :maxWidth="clientWidth <= 767 ? '100%' : '101px'" :bodyClass="{'filter-operation-dropdown' : true}">
                                <template #head v-if="clientWidth <= 767" >
                                    <div class="d-flex align-items-center justify-content-between cancel-title-donewrapper">
                                        <span class="cancel" @click="$refs.compRef[index].click()">  {{$t('Projects.cancel')}} </span>
                                        <h3 class="filter-dropdownmobile-title">{{$t('Filters.filter_operator')}}</h3>
                                        <span class="done" @click="$refs.compRef[index].click()">{{$t('Home.Done')}}</span>
                                    </div>
                                </template>
                                <template #button>
                                    <span ref="compRef" class="text-ellipsis font-weight-400 light_gray_color line-height-slect-option font-size-14 select_wrapper_option d-block select-compRef" :title="Object.keys(item.name).length > 0 ? `${$t(`Filters.${item.name.name}`)}` : $t('PlaceHolder.Select')">{{ Object.keys(item.comparison).length > 0 ? `${$t(`Filters.${item.comparison.name}`)}` : $t('PlaceHolder.Select')}}</span>
                                </template>
                                <template #options>
                                    <div v-for="(option, i) in item.comparisonsData" :key="i" class="cursor-pointer filter-status-field" @click="$refs.compRef[index].click(), handleSelected('comparison', item, option)">
                                        <span class="font-weight-400">{{ `${$t(`Filters.${option.name}`)}` }}</span>
                                    </div>
                                </template>
                            </CustomDropDown>
                        </div>
                    </div>
                    <div class="custom-filters-col">
                        <CustomDropDown :className="'advanceSearchFilter'" :zindexCustomDrop="props.zindexCustomDrop" v-if="arrayKeys.includes(item?.name.value)" :style="{marginBottom : clientWidth <= 767 ? '20px !important' : '0' }"  :maxWidth="clientWidth > 767 ? '370px' : '100%'"  :bodyClass="{'filter-selectall-options' : true}">
                            <template #head v-if="clientWidth <= 767">
                                <div class="d-flex align-items-center justify-content-between cancel-title-donewrapper">
                                    <span class="cancel" @click="$refs.fieldOptionsRef[index].click()">  {{$t('Projects.cancel')}} </span>
                                        <span v-if="item.name.value === 'statusKey'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('ProjectDetails.status')}}</span>
                                        <span v-if="item.name.value === 'Task_Priority'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Filters.priorities')}}</span>
                                        <span v-if="item.name.value === 'TaskTypeKey'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Projects.task_type')}}</span>
                                        <span v-if="item.name.value === 'Task_Leader'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('ProjectDetails.reporter')}}</span>
                                        <span v-if="item.name.value === 'ProjectID'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Projects.project')}}</span>
                                        <span v-if="item.name.value === 'AssigneeUserId'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('ProjectDetails.assignee')}}</span>
                                        <span v-if="item.name.value === 'tagsArray'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Projects.tags')}}</span>
                                        <span v-if="item.name.value === 'ProjectType'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Projects.project')}} {{$t('conformationmsg.type')}}</span>
                                        <span v-if="item.name.value === 'MilestoneType'" class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Filters.milestone_types')}}</span>
                                        <span v-if="item.name.value === 'ProjectCurrency'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('ProjectDetails.currency')}}</span>
                                        <span v-if="item.name.value === 'status'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Templates.project_status')}}</span>
                                        <span v-if="item.name.value === 'type'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Filters.comment_type')}}</span>
                                    <span class="done" @click="$refs.fieldOptionsRef[index].click()">{{$t('Home.Done')}}</span>
                                </div>
                            </template>
                            <template #button>
                                <div ref="fieldOptionsRef" class="selected-options filter-option-field">
                                    <div v-if="item.values.length === 0" class="w-100">
                                        <div @click="search = '',handleArrayOption(item)"> 
                                            <span class="font-size-14 light_gray_color font-weight-400 d-block selectOption-dropdown select_wrapper_option">{{$t('PlaceHolder.Select')}} {{$t('Filters.options')}}</span>
                                        </div>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'statusKey'"  @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <span v-if="i == 1" class="mr-3-px">{{i == 1 ? `,` : ""}}</span>
                                                <span class="status_square m0px-6px" :title="option.name" :style="{'background-color': option.textColor}" ></span>
                                                <span class="text-ellipse d-block mr-5-px" :class="[{'selected_option_1':item.displayData.length === 1,'selected_option_2':item.displayData.length > 1}]">{{ option.name }}</span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'Task_Priority'"  @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <span v-if="i == 1" class="mr-3-px">{{i == 1 ? `,` : ""}}</span>
                                                <WasabiImage
                                                    class="selected_image mr-5-px" 
                                                    v-if="!option.statusImage.includes('http')"
                                                    :data="{
                                                        url: option?.statusImage,
                                                        filename: option?.statusImage?.split('/')?.pop(),
                                                        extension: option?.statusImage?.split('/')?.pop()?.split('.')?.pop()
                                                    }"
                                                />
                                                <img v-else class="selected_image mr-5-px" :src="option.statusImage" alt=""/>
                                                <span class="text-ellipse d-block mr-5-px" :class="[{'selected_option_1':item.displayData.length === 1,'selected_option_2':item.displayData.length > 1}]">{{ option.name }}</span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'TaskTypeKey'">
                                        <span v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <TaskTypeIcon v-if="option.taskImage" :taskType="option" :style="{ height: '13px', width: '13px' }" />
                                                <span class="font-size-12 mr-5-px">{{ option.name }}</span>
                                            </span>
                                        </span>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'Task_Leader'"  @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <WasabiImage
                                                    v-if="!option?.image?.includes('http')"
                                                    class="task__leader-img" 
                                                    :data="{
                                                        url: option?.image,
                                                        filename: option?.image?.split('/')?.pop(), 
                                                        extension: option?.image?.split('/')?.pop()?.split('.')?.pop()
                                                    }"
                                                    :userImage="true"
                                                    :thumbnail="'20x20'"
                                                />
                                                <img v-else-if="option?.image?.includes('http')" class="task__leader-img" :src="option?.image" alt=""/>
                                                <img v-else class="task__leader-img" :src="defaultUserAvatar" />
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'ProjectID'"  @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="pl-5px">
                                                <span class="text-ellipse d-block" :class="[{'selected_option_1':item.displayData.length === 1,'selected_option_2':item.displayData.length > 1}]" :title="option.name">{{i == 1 ? `,` : ""}} {{option.name}} </span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px ml-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'AssigneeUserId'"  @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <WasabiImage
                                                    v-if="!option?.image?.includes('http')"
                                                    class="task__leader-img" 
                                                    :data="{
                                                        url: option?.image,
                                                        filename: option?.image?.split('/')?.pop(),
                                                        extension: option?.image?.split('/')?.pop()?.split('.')?.pop()
                                                    }"
                                                    :userImage="true"
                                                    :thumbnail="'20x20'"
                                                />
                                                <img v-else-if="option?.image?.includes('http')" class="task__leader-img" :src="option?.image" alt=""/>
                                                <img v-else class="task__leader-img" :src="defaultUserAvatar" />
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'tagsArray'">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <span class="ml-5-px border-radius-12-px font-size-12 tags__array" :style="{'background-color': option.tagBgColor, 'color': option.tagColor }">{{ option.name }}</span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 ml-5-px mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'ProjectType'"  @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <span :title="option.name">{{i == 1 ? `,` : ""}} {{option.name}} </span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'MilestoneType'" @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <span class="font-size-14 font-weight-400 d-block" :title="option.name">{{i == 1 ? `,` : ""}} {{option.name}}</span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 ml-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'ProjectCurrency'" @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <span class="text-ellipse d-block mr-5-px" :class="[{'selected_option_1':item.displayData.length === 1,'selected_option_2':item.displayData.length > 1}]"  :title="option.name">{{i == 1 ? `,` : ""}} {{option.name}} </span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 ml-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'status'" @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <span v-if="i == 1" class="mr-3-px">{{i == 1 ? `,` : ""}}</span>
                                                <span class="status_square m0px-6px" :style="{'background-color': option.textColor}" ></span>
                                                <span class="text-ellipse d-block mr-5-px" :class="[{'selected_option_1':item.displayData.length === 1,'selected_option_2':item.displayData.length > 1}]" :title="option.name">{{option.name}} </span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                    <div class="d-flex align-items-center w-100" :class="[{'selectOption-dropdown select_wrapper_option':(item.values.length > 0)}]" v-if="item.name.value === 'type'"  @click="search = '',handleArrayOption(item)">
                                        <template v-for="(option, i) in item.displayData" :key="i">
                                            <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                                <span :title="option.name">{{i == 1 ? `,` : ""}} {{option.name}}</span>
                                            </span>
                                        </template>
                                        <span v-if="item.displayData.length > numberOfItem" class="font-size-12 ml-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                    </div>
                                </div>
                            </template>
                            <template #options>
                                <div class="tasks-statustags-wrapper">
                                    <div v-if="item.name.value === 'statusKey'">
                                        <div>
                                            <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span class="ml-5-px font-size-12 font-weight-400 blue" @click="allSelect(item)" v-if="searchArray.length">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'status'+i" class="cursor-pointer d-flex align-items-baseline lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'status'+i" :value="option.key" v-model="item.values" @change="handleChecked(item)" classes="filer-checkbox"/>
                                                        <span class="status_square" :style="{'background-color': option.textColor,'margin': '0px 5px'}" :title="option.name"></span>
                                                        <span class="font-family-dropdown-span">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 gray81 p0x-15px">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'Task_Priority'">
                                        <div>
                                            <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span v-if="searchArray.length" class="ml-5-px font-size-12 font-weight-400 blue" @click="allSelect(item)">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'proority'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'proority'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)" classes="filer-checkbox"/>
                                                        <WasabiImage class="selected_image ml-5-px mr-5-px" v-if="!option.statusImage.includes('http')" :data="{url: option.statusImage, filename: option.statusImage.split('/').pop(), extension: option.statusImage.split('/').pop().split('.').pop()}"/>
                                                        <img v-else class="selected_image ml-5-px mr-5-px" :src="option.statusImage" alt=""/>
                                                        <span class="font-family-dropdown-span">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'TaskTypeKey' && taskTypeArray.length">
                                        <div v-if="taskTypeArray.length">
                                            <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'selectAll'+index" v-model="item.isAllChecked" :value="item.isAllChecked" @click="allSelect(item)"/>
                                                    <span  class="ml-5-px font-size-12 font-weight-400 blue">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll">
                                                <div v-for="(option, i) in taskTypeArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'tasktype'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'tasktype'+i" :value="option.key" v-model="item.values" @change="handleChecked(item)"/>
                                                        <TaskTypeIcon class="task-type-image" v-if="option.taskImage" :taskType="option" :style="{ height: '14px', width: '14px' }" />
                                                        <span class="font-family-dropdown-span">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                    </div>
                                    <div v-if="item.name.value === 'Task_Leader'">
                                        <div>
                                            <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span @click="allSelect(item)" v-if="searchArray.length" class="ml-5-px font-size-12 font-weight-400 blue">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'createdby'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'createdby'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                        <WasabiImage
                                                            v-if="!option?.image?.includes('http')"
                                                            class="user-icon user__option-imgg" 
                                                            :data="{
                                                                url: option?.image,
                                                                filename: option?.image?.split('/')?.pop(), 
                                                                extension: option?.image?.split('/')?.pop()?.split('.')?.pop()
                                                            }"
                                                            :userImage="true"
                                                            :thumbnail="'20x20'"
                                                        />
                                                        <img v-else-if="option?.image?.includes('http')" class="user-icon user__option-imgg" :src="option?.image" alt=""/>
                                                        <img v-else class="user-icon user__option-imgg" :src="defaultUserAvatar" />
                                                        <span class="font-family-dropdown-span">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'AssigneeUserId'">
                                        <div>
                                            <label :for="'selectAllAssignee'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span v-if="searchArray.length" class="ml-5-px font-size-12 font-weight-400 blue" @click="allSelect(item)">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'Assignee'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'Assignee'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                        <WasabiImage
                                                            v-if="!option?.image?.includes('http')"
                                                            class="user-icon user__option-imgg"
                                                            :data="{
                                                                url: option?.image,
                                                                filename: option?.image?.split('/')?.pop(),
                                                                extension: option?.image?.split('/')?.pop()?.split('.')?.pop()
                                                            }"
                                                            :userImage="true"
                                                            :thumbnail="'20x20'"
                                                        />
                                                        <img v-else-if="option?.image?.includes('http')" class="user-icon user__option-imgg" :src="option?.image" alt="" />
                                                        <img v-else :src="deafulatUserImg" class="user-icon user__option-imgg" />
                                                        <span class="font-family-dropdown-span">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'ProjectID'">
                                        <div>
                                            <label :for="'selectAllProject'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span v-if="searchArray.length" class="ml-5-px font-size-12 font-weight-400 blue" @click="allSelect(item)">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'projectName'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'projectName'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                        <span v-if="option.projectIcon && option.projectIcon?.type === 'color'" class="d-flex align-items-center justify-content-center inital-box-filter ml-8px" :style="[{'background-color': option.projectIcon.data}]">{{ option.ProjectName.charAt(0).toUpperCase()}}</span>
                                                        <div v-if="option.projectIcon && option.projectIcon?.type === 'image'" class="ml-8px option__project-icon">
                                                            <WasabiImage class="profile-sm-square" :style="{minWidth:'20px !important'}" v-if="!option.projectIcon.data.includes('http')" :data="{url: option.projectIcon.data, filename: option.projectIcon.data.split('/').pop(), extension: option.projectIcon.data.split('/').pop().split('.').pop()}" thumbnail="20x20"/>
                                                            <img v-else class="profile-sm-square" :src="option.projectIcon.data" alt=""/>
                                                        </div>
                                                        <span class="font-family-dropdown-span m0px-5px">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'tagsArray'">
                                        <div v-if="tagsArray.length"> 
                                            <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'selectAll'+index" v-model="item.isAllChecked" :value="item.isAllChecked" @click="allSelect(item)"/>
                                                    <span  class="ml-5-px font-size-12 font-weight-400 blue">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div v-for="(option, i) in tagsArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                <label :for="'tags'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                    <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'tags'+i" :value="option.uid" v-model="item.values" @change="handleChecked(item)"/>
                                                    <span class="ml-5-px border-radius-12-px font-family-dropdown-span p2x-10px" :style="{'background-color': option.tagBgColor, 'color': option.tagColor}"
                                                    >{{ option.name }}</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                    </div>
                                    <div v-if="item.name.value === 'ProjectType'">
                                        <div>
                                            <label :for="'selectAllProject'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper" :class="[{'pointer-event-none':isLoading}]">
                                                    <span @click="allSelect(item)" class="ml-5-px font-size-12 font-weight-400 blue">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length" :class="[{'pointer-event-none':isLoading}]">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'projectName'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'projectName'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                        <span class="font-family-dropdown-span m0px-5px">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'MilestoneType'">
                                        <div>
                                            <label :for="'selectAllProject'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span @click="allSelect(item)" class="ml-5-px font-size-12 font-weight-400 blue">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'projectName'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'projectName'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                        <span class="font-family-dropdown-span m0px-5px">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'ProjectCurrency'">
                                        <div>
                                            <label :for="'selectAllProject'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span @click="allSelect(item)" class="ml-5-px font-size-12 font-weight-400 blue">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'projectName'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'projectName'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                        <span class="font-family-dropdown-span m0px-5px">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'status'">
                                        <div>
                                            <label :for="'selectAllProject'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span @click="allSelect(item)" class="ml-5-px font-size-12 font-weight-400 blue">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'projectName'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'projectName'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                        <span class="status_square" :style="{'background-color': option.textColor,'margin': '0px 2px'}" :title="option.name"></span>
                                                        <span class="font-family-dropdown-span m0px-5px">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                    <div v-if="item.name.value === 'type'">
                                        <div>
                                            <label :for="'selectAllProject'+index" class="cursor-pointer d-flex align-items-center label-all">
                                                <div class="search__all-inputtext">
                                                    <InputText
                                                        v-model="search"
                                                        :place-holder="$t('PlaceHolder.search')"
                                                        type="text"
                                                        :isOutline="false"
                                                        @input="searchFunction(item)"
                                                    />
                                                </div>
                                                <div class="d-flex align-items-center check__component-wrapper">
                                                    <span @click="allSelect(item)" class="ml-5-px font-size-12 font-weight-400 blue">{{item?.isAllChecked === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                                </div>
                                            </label>
                                            <div class="checkbox-dropdown-wrapper style-scroll" v-if="searchArray.length">
                                                <div v-for="(option, i) in searchArray" :key="i" class="dropdown-item checkbox-dropdown">
                                                    <label :for="'projectName'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                        <CheckboxComponent :class="`advance_setting_warpper_check`" :id="'projectName'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                        <span class="font-family-dropdown-span m0px-5px">{{ option.name }}</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div v-else class="font-size-13 p0x-15px gray81">{{$t('UserTimesheet.no_records_found')}}</div>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </CustomDropDown>
                        <div ref="fieldOptionsRef" class="DueDate_wrapper"  v-if="item?.name.value === 'DueDate'">
                            <CalenderCompo v-if="item?.name.value === 'DueDate'"
                                class="font-size-14 filter_calendar"
                                v-model:model-value="item.date"
                                :isShowDateAndicon="true"
                                :hideClearButton="true"
                                @update:model-value="($event) => updateDate($event)"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
// Packages
import { defineProps, defineEmits, ref, inject, watch } from 'vue';

// Component
import InputText from "@/components/atom/InputText/InputText.vue"
import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
import CustomDropDown from '@/components/molecules/DropDown/CustomDropDown.vue';
import CheckboxComponent from '@/components/atom/Checkbox/CheckboxComponent.vue';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import "@/components/molecules/TaskFilterAdvance/styleFilter.css"
// Emites
const emit = defineEmits(["delete","apply","empty"])

// IMAGES
// const selectArrowMobile = require('@/assets/images/svg/drop_down_mobile.svg');

// Props
const props = defineProps({
    inputs: {
        type: Array,
        default: () => []
    },
    mainOptions: {
        type: Array,
        default: () => []
    },
    statusArray: {
        type: Array,
        default: () => []
    },
    taskTypeArray: {
        type: Array,
        default: () => []
    },
    priorities: {
        type: Array,
        default: () => []
    },
    tagsArray: {
        type: Array,
        default: () => []
    },
    users: {
        type: Array,
        default: () => []
    },
    zindexCustomDrop: {
        type: Number,
        default: 7
    },
    allProjectsFilter : {
        type: Array,
        default:() => []
    },
    projectType: {
        type:Array,
        default:() => []
    },
    milestoneType: {
        type:Array,
        default:() => []
    },
    allCurrency: {
        type:Array,
        default:() => []
    },
    allProjectStatus: {
        type:Array,
        default:() => []
    },
    commentType: {
        type:Array,
        default:() => []
    },
    loading:{
        type:Boolean,
        default:false
    }
});
watch(() => props.loading, (newValue) => {
    if(newValue === true){
        isLoading.value = newValue;
    }else{
        setTimeout(()=>{
            isLoading.value = newValue;
        },1000)
    }
})
// inject
const clientWidth = inject("$clientWidth");
const defaultUserAvatar = inject("$defaultUserAvatar")

// Variables
const arrayKeys = ref(["statusKey", "Task_Priority", "Task_Leader", "tagsArray", "TaskTypeKey","AssigneeUserId","ProjectID","ProjectType","MilestoneType","ProjectCurrency","status","type"]);
const numberOfItem = ref(2);
const search = ref('');
const searchArray = ref([]);
const deafulatUserImg = require("@/assets/images/default_user.png");
const isLoading = ref(props.loading)

// This function is used for toggle "And" and "Or" condition value for all the rows based on first condition
const setAllOptions = (item) => {
    props.inputs.forEach((x) =>  x.condition = item.condition);
}

// This is a callback function which is used to manage mulitple array based on type. It return data based on used
const manageArray = (type) => {
    let arrayData = [];

    if(type === "statusKey") {
        arrayData = props.statusArray;
    } else if (type === "Task_Priority") {
        arrayData = props.priorities;
    } else if (type === "TaskTypeKey") {
        arrayData = props.taskTypeArray;
    } else if (type === "Task_Leader") {
        arrayData = props.users;
    } else if (type === "tagsArray") {
        arrayData = props.tagsArray;
    } else if (type === 'AssigneeUserId') {
        arrayData = props.users;
    } else if(type === 'ProjectID'){
        arrayData = props.allProjectsFilter;
    } else if(type === 'ProjectType'){
        arrayData = props.projectType;
    } else if(type === 'MilestoneType'){
        arrayData = props.milestoneType;
    } else if(type === 'ProjectCurrency'){
        arrayData = props.allCurrency;
    } else if(type === 'status'){
        arrayData = props.allProjectStatus;
    } else if(type === 'type'){
        arrayData = props.commentType;
    }

    return arrayData;
}

// This function is used to checked or unchecked event for chackboxes based on data
const handleChecked = (item) => {
    let arrayData = manageArray(item.name.value);
    const result = arrayData.filter(i => item.values.includes(i.finalValue));
    item.displayData = result;
    item.isAllChecked = arrayData.length === item.values.length ? true : false;
    emit('apply', {type: 'custom'})
}

// This function is used to all checked or unchecked event for chackboxes based on data
const allSelect = (item) => {
    item.isAllChecked = !item.isAllChecked;

    // Manage values array
    let arrayData = manageArray(item.name.value);
    if (item.isAllChecked) {
        item.values = arrayData.map(x => x.finalValue);
    } else {
        item.values = [];
    }

    // Manage display array
    const result = arrayData.filter(i => item.values.includes(i.finalValue));
    item.displayData = result;
    emit('apply', {type: 'custom'});
}

const updateDate = () => {
    emit('apply', {type: 'custom'});
}

// This function is used to reset all the sub fields in row on table based on parent option
const resetFields = (item) => {
    item.isAllChecked = false;
    item.values = [];
    item.displayData = [];
    item.comparison = {};
    item.date = "";
    const arraykeys = ["Task_Priority", "Task_Leader", "TaskTypeKey", "tagsArray",'AssigneeUserId','ProjectID','ProjectType','MilestoneType','ProjectCurrency','type'];
    const dateKeys = ["DueDate"];
    const statusKeys = ["statusKey","status"];

    setTimeout(() => {
        if(arraykeys.includes(item.name.value)) {
            item.comparisonsData = [
                { value: ':', name: "Is" }
            ]
            item.comparison = { value: ':', name: "Is" };
        } else if(dateKeys.includes(item.name.value)) {
            item.comparisonsData = [
                { value: ':>', name: "Greater_Than" },
                { value: ':<', name: "Less_Than" },
                { value: ':=', name: "Equal_To" }
            ]
            item.comparison = { value: ':>', name: "Greater_Than" };
        }
        else if(statusKeys.includes(item.name.value)) {
            item.comparisonsData = [
                { value: ':', name: "Is" },
                { value: ':!=', name: "Not_Equals_To" },
            ]
            item.comparison = { value: ':', name: "Is" };
        }
    }, 200);
}

// This function is used to handel seleted options for the key and comparison field
const handleSelected = (field, item, option) => {
    if(field === 'comparison') {
        item.comparison = option;
        emit('apply', {type: 'custom'})
    }
    if(field === 'keys') {
        item.name = option;
        // if(props.inputs && props.inputs.length){
        //     if(props.inputs[0].displayData.length === 0){
        //         emit('apply', {type: 'custom'})
        //     }   
        // }
    }
};
const handleArrayOption = (data) => {
    if(data.name.value === "AssigneeUserId" || data.name.value === "Task_Leader"){
        searchArray.value = props.users;
    } else if(data.name.value === "ProjectID"){
        searchArray.value = props.allProjectsFilter;
    } else if(data.name.value === 'statusKey') {
        searchArray.value = props.statusArray;
    } else if(data.name.value === 'Task_Priority'){
        searchArray.value = props.priorities;
    } else if(data.name.value === 'ProjectType'){
        searchArray.value = props.projectType;
    } else if(data.name.value  === 'MilestoneType'){
        searchArray.value = props.milestoneType;
    } else if(data.name.value === 'ProjectCurrency'){
        searchArray.value = props.allCurrency;
    } else if(data.name.value === 'status'){
        searchArray.value  = props.allProjectStatus;
    }  else if(data.name.value === 'type'){
        searchArray.value  = props.commentType;
    }
};
const searchFunction = (data) => {
    if(data.name.value === "AssigneeUserId" || data.name.value === "Task_Leader"){
        searchArray.value = props.users
    } else if(data.name.value === "ProjectID"){
        searchArray.value = props.allProjectsFilter
    } else if(data.name.value === 'statusKey') {
        searchArray.value = props.statusArray;
    } else if(data.name.value === 'Task_Priority'){
        searchArray.value = props.priorities;
    } else if(data.name.value === 'ProjectType'){
        searchArray.value = props.projectType;
    } else if(data.name.value  === 'MilestoneType'){
        searchArray.value = props.milestoneType;
    } else if(data.name.value === 'ProjectCurrency'){
        searchArray.value = props.allCurrency;
    } else if(data.name.value === 'status'){
        searchArray.value  = props.allProjectStatus;
    } else if(data.name.value === 'type'){
        searchArray.value  = props.commentType;
    }
    if(search.value.trim().length > 0) {
        searchArray.value = searchArray.value.filter(item => item.name.toLowerCase().includes(search.value.toLowerCase()));
    }
}
</script>
<style scoped src="./style.css"></style>