<template>
    <div class="fieldTable">
        <div class="mb-010 custom-filters-table" :id="`num-${index}`" v-for="(item, index) in inputs" :key="index" >
            <div class="d-flex align-items-center custom-filters-detailwrapper flex-wrap" :class="{'row-gap-filter' : clientWidth > 767}">
                <div class="mr-010 custom-filters-col" v-if="index == 0">
                    <span class="where-title" :class="{'font-size-13 text-center' : clientWidth > 767 , 'font-size-18 text-left' : clientWidth <= 767}" :style="{color : clientWidth > 767 ? '#959595' : '#000000' }">
                        {{ $t('Filters.where') }}
                    </span>
                </div>
                <div class="mr-010 custom-filters-col" v-if="index == 1">
                    <div class="custom-radio position-re" :class="{'d-flex' : clientWidth <= 767}">
                        <input type="radio" :id="'condition'+index" :value="item.condition === '&&' ? '||' : '&&'" v-model="item.condition" :disabled="index !== 1" @change="setAllOptions(item)"/>
                        <label :for="'condition'+index"  :class="{'font-size-13 text-center' : clientWidth > 767 , 'font-size-18 text-left' : clientWidth <= 767}"
                            :style="{color : clientWidth > 767 ? '#959595' : '#000000' }"
                            >{{ item.condition === '&&' ? 'And' : 'Or' }}
                            <img class="mobile_icon_dropdown" src="@/assets/images/svg/drop_down_mobile.svg" alt="dropdown" v-if="clientWidth <= 767">
                        </label>
                        <img src="@/assets/images/svg/toggle_arrow.svg" alt="" width="9" class="up-downarrow position-ab" v-if="clientWidth > 767"/>
                        <span class="remove_icon"  v-if="inputs.length > 1 && clientWidth <= 767" @click="$emit('delete', { item, index })" :class="{'d-flex align-items-center cursor-pointer font-size-16' : clientWidth <= 767 }"> {{$t('Templates.remove')}} </span>               
                    </div>
                </div>
                <div class="mr-010 custom-filters-col" v-if="index > 1">
                    <span class="where-title"  :class="{'font-size-13 text-center' : clientWidth > 767 , 'font-size-18 text-left' : clientWidth <= 767}" :style="{color : clientWidth > 767 ? '#959595' : '#000000' }"> 
                        {{ item.condition === '&&' ? 'And' : 'Or' }}
                        <span class="remove_icon"  v-if="inputs.length > 1 && clientWidth <= 767" @click="$emit('delete', { item, index })" :class="{'d-flex align-items-center cursor-pointer font-size-16' : clientWidth <= 767 }"> {{$t('Templates.remove')}} </span>
                    </span>
                </div>
                <div class="mr-010 custom-filters-col filter-status-fieldwrapper" :class= "{'date_range_bottom': clientWidth < 767 && item?.name.value === 'DueDate'  && dateOption === 'Date range' }">
                    <CustomDropDown :maxWidth="clientWidth > 767 ? '150px' : '100%'" :zindexCustomDrop="99" :bodyClass="{'filter-status-dropdpown' : true}">
                        <template #head v-if="clientWidth <= 767">
                            <div class="d-flex align-items-center justify-content-between cancel-title-donewrapper">
                                <a href="#" class="mr-10px"  @click.stop.prevent="$refs.keyRefs[index].click(), inputName='', isInvalid=false" :class="{'font-size-16' : clientWidth <= 767 }" :style="{color : clientWidth <= 767 ? '#646464' : '#2F3990'}">{{$t('Projects.cancel')}}</a>
                                <h3 class="filter-dropdownmobile-title m-0" :class="{'font-size-20 font-weight-500' : clientWidth <= 767 }" :style="{color : clientWidth <= 767 ? '#090A0A' : ''}">{{ $t('Filters.filtering_field') }}</h3>
                                <span class="done" @click="$refs.keyRefs[index].click()">{{$t('Home.Done')}}</span>
                            </div>
                        </template>
                        <template #button>
                            <div ref="keyRefs" :class="{'font-size-13' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767}" :style="{color : clientWidth > 767 ? '#818181' : '#B3B3B3' }" :title="Object.keys(item.name).length > 0 ? `${$t(`Projects.${item.name.name}`)}` : `${$t('PlaceHolder.Select')}`">{{ Object.keys(item.name).length > 0 ? `${$t(`Projects.${item.name.name}`)}` : `${$t('PlaceHolder.Select')}`}}</div>
                        </template>
                        <template #options>
                            <div v-if="mainOptions.length > 0">
                                <div v-for="(option, i) in mainOptions" :key="i" class="cursor-pointer filter-status-field" @click="$refs.keyRefs[index].click(), resetFields(item), handleSelected('keys', item, option, index)">
                                    <span class="font-size-14 font-weight-400">{{ `${$t(`Projects.${option.name}`)}` }}</span>
                                </div>
                            </div>
                            <div v-else class="font-size-13 gray81">{{$t('Filters.no_data_found')}}</div>
                        </template>
                    </CustomDropDown>
                </div>
                <div class="mr-010 custom-filters-col filter-operator" :class= "{'date_range_bottom': clientWidth < 767 && item?.name.value === 'DueDate'  && dateOption === 'Date range' }" v-if="Object.keys(item.name).length > 0">
                    <CustomDropDown :maxWidth="clientWidth <= 767 ? '100%' : '101px'" :zindexCustomDrop="99" :bodyClass="{'filter-operation-dropdown' : true}">
                        <template #head v-if="clientWidth <= 767" >
                            <div class="d-flex align-items-center justify-content-between cancel-title-donewrapper">
                                <span class="cancel" @click="$refs.compRef[index].click()"> {{$t('Projects.cancel')}} </span>
                                <h3 class="filter-dropdownmobile-title">{{$t('Filters.filter_operator')}}</h3>
                                <span class="done" @click="$refs.compRef[index].click()">{{$t('Home.Done')}}</span>
                            </div>
                        </template>
                        <template #button>
                            <span ref="compRef" class="text-ellipsis d-block select-compRef" :class="{'font-size-13' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767}" :style="{color : clientWidth > 767 ? '#818181' : '#B3B3B3' }" :title="Object.keys(item.name).length > 0 ? `${$t(`Filters.${item.name.name}`)}` : `${$t('PlaceHolder.Select')}`">{{ Object.keys(item.comparison).length > 0 ? `${$t(`Filters.${item.comparison.name}`)}` : `${$t('PlaceHolder.Select')}`}}</span>
                        </template>
                        <template #options>
                            <div v-for="(option, i) in item.comparisonsData" :key="i" class="cursor-pointer filter-status-field" @click="$refs.compRef[index].click(), handleSelected('comparison', item, option)">
                                <span class="font-weight-400" :class="{'font-size-14' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767}">{{ `${$t(`Filters.${option.name}`)}` }}</span>
                            </div>
                        </template>
                    </CustomDropDown>
                </div>
                <div class="mr-010 custom-filters-col d-flex align-items-center" :class= "{'date_range_calendar': clientWidth < 767 && item?.name.value === 'DueDate'  && dateOption === 'Date range' }">
                    <CustomDropDown v-if="arrayKeys.includes(item?.name.value)" @isVisible="(isOpen) => resetSearchValue(isOpen)" :zindexCustomDrop="99" :style="{marginBottom : clientWidth <= 767 ? item?.name.value === 'DueDate'  && dateOption === 'Date range' ? '0px' : '20px !important' : '0' }"  :maxWidth="clientWidth > 767 ? '211px' : '100%'"  :bodyClass="{'filter-selectall-options' : true}">
                        <template #head v-if="clientWidth <= 767">
                            <div class="d-flex align-items-center justify-content-between cancel-title-donewrapper">
                                <span class="cancel" @click="$refs.fieldOptionsRef[index].click()"> {{$t('Projects.cancel')}} </span>
                                    <span v-if="item.name.value === 'statusKey'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('ProjectDetails.status')}}</span>
                                    <span v-if="item.name.value === 'Task_Priority'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Filters.priorities')}}</span>
                                    <span v-if="item.name.value === 'TaskTypeKey'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Projects.task_type')}}</span>
                                    <span v-if="item.name.value === 'Task_Leader'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('ProjectDetails.reporter')}}</span>
                                    <span v-if="item.name.value === 'tagsArray'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Projects.tags')}}</span>
                                    <span v-if="item.name.value === 'AssigneeUserId'"  class="filter-dropdownmobile-title">{{$t('PlaceHolder.Select')}} {{$t('Projects.Assignee')}}</span>
                                <span class="done" @click="$refs.fieldOptionsRef[index].click()">{{$t('Home.Done')}}</span>
                            </div>
                        </template>
                        <template #button>
                            <div ref="fieldOptionsRef" class="selected-options d-flex align-items-center">
                                <span class="ml-010" :class="{'font-size-13' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767 }"  :style="{color : clientWidth > 767 ? '#818181' : '#B3B3B3' }" v-if="item.values.length === 0" > {{$t('PlaceHolder.Select')}} {{$t('Filters.options')}}</span>

                                <div class="d-flex align-items-center" v-if="item.name.value === 'statusKey'">
                                    <span v-for="(option, i) in item.displayData" :key="i">
                                        <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                            <span class="status_square m0px-6px" :title="option.name" :style="{'background-color': option.textColor}"></span>
                                            <span class="mr-5-px" :class="{'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767 }">{{ option.name }}</span>
                                        </span>
                                    </span>
                                    <span v-if="item.displayData.length > numberOfItem" class="mr-5-px span-count" :class="{'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767 }">+{{ item.displayData.length - numberOfItem}}</span>
                                </div>
                                <div class="d-flex align-items-center" v-if="item.name.value === 'Task_Priority'">
                                    <span v-for="(option, i) in item.displayData" :key="i">
                                        <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                            <WasabiIamgeCompp v-if="option.statusImage" :data="{url: option.statusImage}" :style="{ margin:  clientWidth > 767 ? '0px 5px' : '0px 8px 0 13px', maxWidth: '14px'}" />
                                            <span class="mr-5-px" :class="{'ml-5-px': !option.statusImage, 'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767 }">{{ option.name }}</span>
                                        </span>
                                    </span>
                                    <span v-if="item.displayData.length > numberOfItem" class="mr-5-px span-count" :class="{'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767 }">+{{ item.displayData.length - numberOfItem}}</span>
                                </div>
                                <div class="d-flex align-items-center" v-if="item.name.value === 'TaskTypeKey'">
                                    <span v-for="(option, i) in item.displayData" :key="i">
                                        <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                            <WasabiIamgeCompp v-if="option.taskImage" :data="{url: option.taskImage}" :style="{ margin:  clientWidth > 767 ? '0px 5px' : '0px 8px 0 13px', maxWidth: '14px'}" />
                                            <span class="font-size-12 mr-5-px" :class="{'ml-5-px': !option.taskImage, 'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767}">{{ option.name }}</span>
                                        </span>
                                    </span>
                                    <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                </div>
                                <div class="d-flex align-items-center" v-if="item.name.value === 'Task_Leader'">
                                    <span v-for="(option, i) in item.displayData" :key="i">
                                        <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                            <!-- <img v-if="option.image" :src="option.image" alt="" :title="option.name"   class="task__leader-img"/> -->
                                            <WasabiIamgeCompp class="task__leader-img" :data="{url: option.image}" :userImage="true" v-if="option.image" :title="option.name"/>
                                        </span>
                                    </span>
                                    <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                </div>
                                <div class="d-flex align-items-center" v-if="item.name.value === 'tagsArray'">
                                    <span v-for="(option, i) in item.displayData" :key="i">
                                        <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                            <span class="ml-5-px border-radius-12-px font-size-12 tags__array" :style="{'background-color': option.tagBgColor, 'color': option.tagColor }">{{ option.name }}</span>
                                        </span>
                                    </span>
                                    <span v-if="item.displayData.length > numberOfItem" class="font-size-12 ml-5-px mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                </div>
                                <div class="d-flex align-items-center" v-if="item.name.value === 'AssigneeUserId'">
                                   <span v-for="(option, i) in item.displayData" :key="i">
                                        <span v-if="i < numberOfItem" class="d-flex align-items-center">
                                            <span v-if="!option.teamColor">
                                                <WasabiIamgeCompp class="task__leader-img" :data="{url: option.image}" :userImage="true" v-if="option.image && option?.value !== '$meMode'" :title="option.name"/>
                                                <WasabiIamgeCompp class="task__leader-img" :data="{url: userDetails?.Employee_profileImageURL}" :userImage="true" v-else-if="option?.value === '$meMode' && Object.keys(userDetails)?.length" :title="userDetails?.Employee_Name"/>
                                            </span>
                                            <span v-else>
                                                <div class="team-default-color1" :style="{'background-color': option.teamColor.bgColor}"> <span :style="{'color': option.teamColor.color}">{{ option.name.charAt(0) }}</span></div>
                                            </span>
                                        </span>
                                    </span>
                                    <span v-if="item.displayData.length > numberOfItem" class="font-size-12 mr-5-px span-count">+{{ item.displayData.length - numberOfItem}}</span>
                                </div>
                                <div class="d-flex align-items-center" v-if="item.name.value === 'DueDate'">
                                   <span v-for="(option, i) in item.displayData" :key="i">
                                        <span class="mr-5-px" :class="{'font-size-12' : clientWidth > 767 , 'font-size-14' : clientWidth <= 767 }">{{ $t(`dashboardCard.${option.key}`) }}</span>
                                    </span>
                                </div>
                                <img :src="clientWidth > 767 ? selectArrow : selectArrowMobile" alt="dropdown" width="13" class="position-ab select__arrow">
                            </div>
                        </template>
                        <template #options>
                            <div class="tasks-statustags-wrapper">
                                <div v-if="item.name.value === 'statusKey' && statusArray.length" :class="{'width-211-px': clientWidth > 767, 'w-100' : clientWidth <= 767}">
                                    <div v-if="statusArray.length">
                                        <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all" v-if="statusArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length">
                                            <div class="d-flex align-items-center check__component-wrapper">
                                                <CheckboxComponent :id="'selectAll'+index" v-model="item.isAllChecked" :value="item.isAllChecked" @click="allSelect(item)" customClasses=""/>
                                                <span class="ml-5-px" :class="{'font-size-12 blue' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767 }" >{{$t('Filters.select_all')}}</span>
                                            </div>
                                            <!-- <img src="@/assets/images/svg/help_icon.svg" alt="" height="14" width="14" @click.stop.prevent=""/> -->
                                        </label>
                                        <div class="p-10px pb-0px w-100">
                                            <InputText v-model="search" :place-holder="$t('PlaceHolder.search')" type="text" :isOutline="false" />
                                        </div>
                                        <div class="checkbox-dropdown-wrapper">
                                            <div v-for="(option, i) in statusArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)" :key="i" class="dropdown-item checkbox-dropdown" :class="{'border-radius-6-px' : clientWidth > 767 , 'border-radius-8-px' : clientWidth <= 767}">
                                                <label :for="'status'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                    <CheckboxComponent :id="'status'+i" :value="option.key" v-model="item.values" @change="handleChecked(item)" classes="filer-checkbox"/>
                                                    <span class="status_square" :title="option.name" :style="{'background-color': option.textColor , margin:  clientWidth > 767 ? '0px 6px' : '0px 8px 0 13px'}"></span>
                                                    <span :class="{'font-size-14' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767 }"   :style="{color : clientWidth > 767 ? '#535358' : '#3B3B3B' }">{{ option.name }}</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div v-if="!statusArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length" class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                    </div>
                                    <div v-else class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                </div>
                                <div v-if="item.name.value === 'Task_Priority' && priorities.length" :class="{'width-211-px': clientWidth > 767, 'w-100' : clientWidth <= 767}">
                                    <div v-if="priorities.length">
                                        <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all" v-if="priorities.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length">
                                            <div class="d-flex align-items-center check__component-wrapper">
                                                <CheckboxComponent :id="'selectAll'+index" v-model="item.isAllChecked" :value="item.isAllChecked" @click="allSelect(item)"/>
                                                <span  class="ml-5-px" :class="{'font-size-12 blue' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767 }">{{$t('Filters.select_all')}}</span>
                                            </div>
                                            <!-- <img src="@/assets/images/svg/help_icon.svg" alt="" height="14" width="14" @click.stop.prevent=""/> -->
                                        </label>
                                        <div class="p-10px pb-0px w-100">
                                            <InputText v-model="search" :place-holder="$t('PlaceHolder.search')" type="text" :isOutline="false" />
                                        </div>
                                        <div class="checkbox-dropdown-wrapper">
                                            <div v-for="(option, i) in priorities.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)" :key="i" class="dropdown-item checkbox-dropdown" :class="{'border-radius-6-px' : clientWidth > 767 , 'border-radius-8-px' : clientWidth <= 767}">
                                                <label :for="'proority'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                    <CheckboxComponent :id="'proority'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)" classes="filer-checkbox"/>
                                                    <WasabiIamgeCompp v-if="option.statusImage" :data="{url: option.statusImage}" :style="{ margin:  clientWidth > 767 ? '0px 5px' : '0px 8px 0 13px', maxWidth: '14px'}" />
                                                    <span :class="{'ml-5-px': !option.statusImage, 'font-size-14' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767}"
                                                        :style="{color : clientWidth > 767 ? '#535358' : '#3B3B3B' }"
                                                    >{{ option.name }}</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div v-if="!priorities.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length" class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                    </div>
                                    <div v-else class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                </div>
                                <div v-if="item.name.value === 'TaskTypeKey' && taskTypeArray.length" :class="{'width-211-px': clientWidth > 767, 'w-100' : clientWidth <= 767}">
                                    <div v-if="taskTypeArray.length">
                                        <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all" v-if="taskTypeArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length">
                                            <div class="d-flex align-items-center check__component-wrapper">
                                                <CheckboxComponent :id="'selectAll'+index" v-model="item.isAllChecked" :value="item.isAllChecked" @click="allSelect(item)"/>
                                                <span  class="ml-5-px" :class="{'font-size-12 blue' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767 }">{{$t('Filters.select_all')}}</span>
                                            </div>
                                            <!-- <img src="@/assets/images/svg/help_icon.svg" alt="" height="14" width="14" @click.stop.prevent=""/> -->
                                        </label>
                                        <div class="p-10px pb-0px w-100">
                                            <InputText v-model="search" :place-holder="$t('PlaceHolder.search')" type="text" :isOutline="false" />
                                        </div>
                                        <div class="checkbox-dropdown-wrapper">
                                            <div v-for="(option, i) in taskTypeArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)" :key="i" class="dropdown-item checkbox-dropdown" :class="{'border-radius-6-px' : clientWidth > 767 , 'border-radius-8-px' : clientWidth <= 767}">
                                                <label :for="'tasktype'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                    <CheckboxComponent :id="'tasktype'+i" :value="option.key" v-model="item.values" @change="handleChecked(item)"/>
                                                    <WasabiIamgeCompp v-if="option.taskImage" :data="{url: option.taskImage}" :style="{ margin:  clientWidth > 767 ? '0px 5px' : '0px 8px 0 13px', maxWidth: '14px'}" />
                                                    <span :class="{'ml-5-px': !option.taskImage, 'font-size-14' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767}">{{ option.name }}</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div v-if="!taskTypeArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length" class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                    </div>
                                    <div v-else class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                </div>
                                <div v-if="item.name.value === 'Task_Leader' && users.length" :class="{'width-211-px': clientWidth > 767, 'w-100' : clientWidth <= 767}">
                                    <div v-if="users.length">
                                        <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all" v-if="users.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length">
                                            <div class="d-flex align-items-center check__component-wrapper">
                                                <CheckboxComponent :id="'selectAll'+index" v-model="item.isAllChecked" :value="item.isAllChecked" @click="allSelect(item)"/>
                                                <span  class="ml-5-px font-size-12 blue">{{$t('Filters.select_all')}}</span>
                                            </div>
                                        </label>
                                        <div class="p-10px pb-0px w-100 pt-15px">
                                            <InputText v-model="search" :place-holder="$t('PlaceHolder.search')" type="text" :isOutline="false" />
                                        </div>
                                        <div class="checkbox-dropdown-wrapper">
                                            <div v-for="(option, i) in users.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)" :key="i" class="dropdown-item checkbox-dropdown" :class="{'border-radius-6-px' : clientWidth > 767 , 'border-radius-8-px' : clientWidth <= 767}">
                                                <label :for="'createdby'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                    <CheckboxComponent :id="'createdby'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                    <!-- <img class="user-icon user__option-img" :src="option.image" alt="" /> -->
                                                    <WasabiIamgeCompp v-if="option.image && option?.value !== '$meMode'" class="user-icon user__option-img" :data="{url: option.image}" :userImage="true" :thumbnail="'25x25'"/>
                                                    <WasabiIamgeCompp v-else-if="option?.value === '$meMode' && Object.keys(userDetails)?.length" class="user-icon user__option-img" :thumbnail="'25x25'" :data="{url: userDetails?.Employee_profileImageURL}" :userImage="true" :title="userDetails?.Employee_Name"/>
                                                    <span  :class="{'font-size-14' : clientWidth > 767 , 'fsize-16' : clientWidth <= 767 }"   :style="{color : clientWidth > 767 ? '#535358' : '#3B3B3B' }">{{ option?.finalValue == '$meMode' ? $t(`dashboardCard.${option.name}`) : option.name }}</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div v-if="!users.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length" class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                    </div>
                                    <div v-else class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                </div>
                                <div v-if="item.name.value === 'tagsArray'" :class="{'width-250-px': clientWidth > 767, 'w-100' : clientWidth <= 767}">
                                    <div v-if="tagsArray.length"> 
                                        <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all" v-if="tagsArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length">
                                            <div class="d-flex align-items-center check__component-wrapper">
                                                <CheckboxComponent :id="'selectAll'+index" v-model="item.isAllChecked" :value="item.isAllChecked" @click="allSelect(item)"/>
                                                <span  class="ml-5-px" :class="{'font-size-12 blue' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767 }">{{$t('Filters.select_all')}}</span>
                                            </div>
                                            <!-- <img src="@/assets/images/svg/help_icon.svg" alt="" height="14" width="14" @click.stop.prevent=""/> -->
                                        </label>
                                        <div class="p-10px pb-0px w-100">
                                            <InputText v-model="search" :place-holder="$t('PlaceHolder.search')" type="text" :isOutline="false" />
                                        </div>
                                        <div v-for="(option, i) in tagsArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)" :key="i" class="dropdown-item checkbox-dropdown" :class="{'border-radius-6-px' : clientWidth > 767 , 'border-radius-8-px' : clientWidth <= 767}">
                                            <label :for="'tags'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14">
                                                <CheckboxComponent :id="'tags'+i" :value="option.uid" v-model="item.values" @change="handleChecked(item)"/>
                                                <span class="ml-5-px border-radius-5-px p1px-15px text-ellipse tag_filter" :style="{'background-color': option.tagBgColor, 'color': option.tagColor}"
                                                :class="{'font-size-14' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767 }" 
                                                >{{ option.name }}</span>
                                            </label>
                                        </div>
                                        <div v-if="!tagsArray.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length" class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                    </div>
                                    <div v-else class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                </div>
                                <div v-if="item.name.value === 'AssigneeUserId' && users.length" :class="{'width-211-px': clientWidth > 767, 'w-100' : clientWidth <= 767}">
                                    <div v-if="users.length">
                                        <label :for="'selectAll'+index" class="cursor-pointer d-flex align-items-center label-all" v-if="users.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length">
                                            <div class="d-flex align-items-center check__component-wrapper">
                                                <CheckboxComponent :id="'selectAll'+index" v-model="item.isAllChecked" :value="item.isAllChecked" @click="allSelect(item)"/>
                                                <span  class="ml-5-px font-size-12 blue">{{$t('Filters.select_all')}}</span>
                                            </div>
                                        </label>
                                        <div class="p-10px pb-0px w-100 pt-15px">
                                            <InputText v-model="search" :place-holder="$t('PlaceHolder.search')" type="text" :isOutline="false" />
                                        </div>
                                        <div class="pt-10px pl-0px pr-0px pb-0px w-100" v-if="teams && teams.length">
                                            <div class="pl-10px"><b>{{ $t('Filters.teams') }}</b></div>
                                            <div v-for="(option, i) in teams.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)" :key="i" class="dropdown-item checkbox-dropdown" :class="{'border-radius-6-px' : clientWidth > 767 , 'border-radius-8-px' : clientWidth <= 767}">
                                                <label :for="'createdbyteam'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                    <CheckboxComponent :id="'createdbyteam'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                    <div class="team-default-color" :style="{'background-color': option.teamColor.bgColor}"> <span :style="{'color': option.teamColor.color}">{{ option.name.charAt(0) }}</span></div>
                                                    <span  :class="{'font-size-14' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767 }"   :style="{color : clientWidth > 767 ? '#535358' : '#3B3B3B' }">{{ option.finalValue == '$meMode' ? $t(`dashboardCard.${option.name}`) : option.name }}</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div class="checkbox-dropdown-wrapper">
                                            <div v-for="(option, i) in users.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1)" :key="i" class="dropdown-item checkbox-dropdown" :class="{'border-radius-6-px' : clientWidth > 767 , 'border-radius-8-px' : clientWidth <= 767}">
                                                <label :for="'createdby'+i" class="cursor-pointer d-flex align-items-center lebel-items font-size-14 GunPowder">
                                                    <CheckboxComponent :id="'createdby'+i" :value="option.value" v-model="item.values" @change="handleChecked(item)"/>
                                                    <WasabiIamgeCompp class="user-icon user__option-img" :data="{url: option.image}" :userImage="true" :thumbnail="'25x25'"/>
                                                    <span  :class="{'font-size-14' : clientWidth > 767 , 'font-size-16' : clientWidth <= 767 }"   :style="{color : clientWidth > 767 ? '#535358' : '#3B3B3B' }">{{ option.finalValue == '$meMode' ? $t(`dashboardCard.${option.name}`) : option.name }}</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div v-if="!users.filter((x) => x.name.toLowerCase().indexOf(search.toLowerCase()) !== -1).length" class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                    </div>
                                    <div v-else class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                </div>
                                <div v-if="item.name.value === 'DueDate'" :class="{'width-211-px': clientWidth > 767, 'w-100' : clientWidth <= 767}">
                                    <div v-if="dueDateOptions.length">
                                        <div>
                                            <DropDownOption v-for="(option, i) in getFilteredOptions(item.comparison.value)" :key="i" @click="item.values = [option.finalValue],handleChecked(item),dateOption = option.finalValue,$refs.fieldOptionsRef[index].click()">
                                                <div class="d-flex align-items-center">
                                                    <span class="ml-5px font-size-14">{{option.name}}</span>
                                                </div>
                                            </DropDownOption>
                                        </div>
                                    </div>
                                    <div v-else class="font-size-13 gray81 p-10px">{{$t('Filters.no_data_found')}}</div>
                                </div>
                            </div>
                        </template>
                    </CustomDropDown>
                </div>
                <CalenderCompo v-if="item?.name.value === 'DueDate'  && dateOption === 'Date range'"
                    class="font-size-14 calender-comp-filter"
                    :range="comparison.value === ':=' || comparison.value === ':<' || comparison.value === ':>' ? true : false"
                    v-model:model-value="item.date"
                    :isShowDateAndicon="true"
                    :preSelectable="false"
                    :hideClearButton="true"
                    :style="{marginBottom : clientWidth <= 767 ? '20px !important' : '0' }"
                    :class= "{'border-radius-4-px ml-date_range': clientWidth > 767, 'border-radius-8-px' : clientWidth <= 767,'date_range_calendar_responive': clientWidth < 767 && dateOption === 'Date range' }"
                />
                <div class="cursor-pointer custom-filters-col" v-if="inputs.length > 1 && clientWidth > 767">
                    <img class="delete-icon ml-7px" src="@/assets/images/svg/filter_delete_svg.svg" alt="" @click="$emit('delete', { item, index })"/>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
// Packages
import { defineProps, defineEmits, ref, inject, onMounted } from 'vue';

// Component
import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
import CustomDropDown from '@/components/molecules/DropDown/CustomDropDown.vue';
import CheckboxComponent from '@/components/atom/Checkbox/CheckboxComponent.vue';
import WasabiIamgeCompp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import InputText from "@/components/atom/InputText/InputText.vue";
// import { useI18n } from "vue-i18n";
import { useGetterFunctions } from "@/composable";

// Emites
defineEmits(["delete"])

// IMAGES
const selectArrow = require('@/assets/images/svg/filter_select_dropdown.svg');
const selectArrowMobile = require('@/assets/images/svg/drop_down_mobile.svg');
const { getUser } = useGetterFunctions();
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
    teams: {
        type: Array,
        default: () => []
    },
    dueDateOptions: {
        type: Array,
        default: () => []
    },
});

// Variables
const clientWidth = inject("$clientWidth");
const dateOption = ref('')
const comparison = ref({})
const search = ref('');
// const { t } = useI18n();

onMounted(() => {
    let checkDueDateOption = props.inputs.find((x) => x.name.value === "DueDate");
    if(checkDueDateOption) {
        if(checkDueDateOption.values.includes('Date range')){
            dateOption.value = 'Date range';
            comparison.value = checkDueDateOption.comparison;
        }
    }
})

const userId = inject('$userId');
const arrayKeys = ref(["statusKey", "Task_Priority", "Task_Leader", "tagsArray", "TaskTypeKey","AssigneeUserId","DueDate"]);
const numberOfItem = ref(2);
const userDetails = ref(getUser(userId.value) ?? {});

// This function is used for toggle "And" and "Or" condition value for all the rows based on first condition
const setAllOptions = (item) => {
    props.inputs.forEach((x) => x.condition = item.condition);
}

const resetSearchValue = (val) => {
    if (!val) {
        search.value = "";
    }
}

// This is a callback function which is used to manage mulitple array based on type. It return data based on used
const manageArray = (type) => {
    let arrayData = [];

    if (type === "statusKey") {
        arrayData = props.statusArray;
    } else if (type === "Task_Priority") {
        arrayData = props.priorities;
    } else if (type === "TaskTypeKey") {
        arrayData = props.taskTypeArray;
    } else if (type === "Task_Leader") {
        arrayData = props.users;
    } else if (type === "tagsArray") {
        arrayData = props.tagsArray;
    }
    else if (type === "AssigneeUserId") {
        // arrayData = props.users;
        arrayData = [...props.users, ...props.teams];
    }
    else if(type === "DueDate") {
        arrayData = props.dueDateOptions
    }

    return arrayData;
}

// This function is used to checked or unchecked event for chackboxes based on data
const handleChecked = (item) => {
    if(item.name.filterOn === "DueDate"){
        item.date = "";
    }
    let arrayData = manageArray(item.name.value);
    const result = arrayData.filter(i => item.values.includes(i.finalValue));
    item.displayData = result;
    item.isAllChecked = arrayData.length === item.values.length ? true : false;
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
}

// This function is used to reset all the sub fields in row on table based on parent option
const resetFields = (item) => {
    item.isAllChecked = false;
    item.values = [];
    item.displayData = [];
    item.comparison = {};
    item.date = "";
    dateOption.value = "";
    const arraykeys = ["Task_Priority", "Task_Leader", "TaskTypeKey", "tagsArray","AssigneeUserId"];
    const dateKeys = ["DueDate"];
    const statusKeys = ["statusKey"];

    setTimeout(() => {
        if (arraykeys.includes(item.name.value)) {
            item.comparisonsData = [
                { value: ':', name: "Is" },
                { value: ':!=', name: "Not_Equals_To" }
            ]
            item.comparison = { value: ':', name: "Is" };
        } else if (dateKeys.includes(item.name.value)) {
            item.comparisonsData = [
                { value: ':>', name: "Greater_Than" },
                { value: ':<', name: "Less_Than" },
                { value: ':=', name: "Is" }
            ]
            item.comparison = { value: ':=', name: "Is" };
            comparison.value = { value: ':=', name: "Is" };
        } else if (statusKeys.includes(item.name.value)) {
            item.comparisonsData = [
                { value: ':=', name: "Is" },
                { value: ':!=', name: "Not_Equals_To" },
            ]
            item.comparison = { value: ':=', name: "Is" };
            comparison.value = { value: ':=', name: "Is" };
        }
    }, 200);
}

// This function is used to handel seleted options for the key and comparison field
const handleSelected = (field, item, option) => {
    if (field === 'comparison') {
        item.comparison = option;
        comparison.value = option;
        item.values = [];
        item.displayData = [];
    }
    if (field === 'keys') {
        item.name = option;
    }
    let checkDueDateOption = props.inputs.find((x) => x.name.value === "DueDate");
    if(checkDueDateOption) {
        if(checkDueDateOption.values.includes('Date range')){
            dateOption.value = 'Date range';
        } else {
            dateOption.value = '';
        }
    } else {
        dateOption.value = '';
    }
}

function getFilteredOptions (comparison){
    const allowKeys = ["Today","Yesterday","Tomorrow","Date_range"]
    if(comparison === ':=' || comparison === ':<' || comparison === ':>') {
        return props.dueDateOptions;
    }
    else{
        return props.dueDateOptions.filter((x) => allowKeys.includes(x.key))
    }
}
</script>

<style scoped>
.up-downarrow{
   right: 9px; 
   top: 9px;
}
.select-compRef{
    max-width: 76%;
}
.task__leader-img{
    margin: 1px 5px 0 3px; 
    border-radius: 50%; 
    width: 25px; 
    height: 25px; 
    object-fit: cover;
}
.tags__array{
    padding: 2px 5px;
}
.select__arrow{
   right: 10px;
}
.check__component-wrapper{
    line-height:12px;
}
.user__option-img{
    border-radius: 50%; 
    margin: 0px 5px; 
    width:25px; 
    height: 25px;
}
.tag_filter {
    max-width: 165px;
}
.team-default-color {
    width: 25px;
    height: 25px;
    border-radius: 50%;
    margin: 0px 5px;
}
.team-default-color span {
    padding: 5px 0 0 9px;
    display: block;
}
.team-default-color1 {
    width: 25px;
    height: 25px;
    border-radius: 50%;
}
.team-default-color1 span {
    padding: 4px 0 0 6px;
    display: block;
}
</style>