<template>
    <div class="d-flex align-items-center header_main_navigation_menu_main">
        <template v-for="(item, index) in menu.filter((xt) => xt.show === true)">
            <!-- DIRECT LINK -->
                <router-link :key="'item'+index+item.name" v-if="item.submenu && !item.submenu.length" :to="item.to" :class="{'active': route.name.includes('Project')}" class="cursor-pointer link-item white h-100">
                    {{ $t(`Header.${item.name}`) }}
                </router-link>

            <!-- FOR SUB MENU -->
            <div :key="'nested-item-'+index+item.name" v-else class="link-item link-dropdown-menu" :class="{'active': isDropdownActive(item)}">
                <DropDown :id="'nav_menu2'+index+item.name" :title="item.name">
                    <template #button>
                        <div class="cursor-pointer dropdown_wrapper h-100" :id="item.id ? item.id : ''">
                            <span  class="list-dropdown-item" :id="`list_dropdown_header${item.name}${index}`" ref="timesheet"> {{ $t(`Header.${item.name}`) }}</span>
                        </div>
                    </template>
                    <template #options>
                        <DropDownRouterOption
                            :id="subItem.id ? subItem.id : ''"
                            class="text-capitalize"
                            v-for="(subItem, subIndex) in item.submenu.filter((xt) => xt.show === true)"
                            :key="subIndex"
                            :style="`${subIndex === item.submenu.length - 1 ? 'margin-bottom:0px !important' : ''}`"
                            @click="handleItemClick(item.name,index)"
                            :item="{label: $t(`Header.${subItem.name}`), to: subItem.to}"
                        />
                    </template>
                </DropDown>
            </div>
        </template>
    </div>
</template>

<script setup>
// PACKAGES
import { defineComponent, defineProps } from "vue";
import { useRoute} from 'vue-router';
const route = useRoute();
// COMPONENTS
import DropDown from "@/components/molecules/DropDown/DropDown.vue";
import DropDownRouterOption from "@/components/molecules/DropDownRouterOption/DropDownRouterOption.vue";
defineComponent({
    name: "NavLinks",

    components: {
        DropDown,
        DropDownRouterOption
    }
})

defineProps({
    menu: {
        type: Array,
        required: true
    }
})
const handleItemClick = (value,idex)  =>{
    document.getElementById(`list_dropdown_header${value}${idex}`).click()
}

// A dropdown is active when the current route matches any of its submenu paths.
// Generalizes the old hardcoded Time_Sheet/Reports check so the Workspace menu
// (Portfolio / Capacity / Integrations) highlights correctly too.
const isDropdownActive = (item) => (item.submenu || []).some(
    (s) => s && s.to && s.to.path && route.path.startsWith(s.to.path)
);

</script>

<style>
.link-item {
    font-weight: 500;
    font-size: 13px;
    line-height: 19px;
    margin-right: 2px;
    padding: 13px 15.44px;
    cursor: pointer;
}
.link-dropdown-menu
{
    padding: 13px 0;
}
.active.link-item {
    background: #3845B3;
}
.link-item:last-child {
    margin-left: 13px;
}
.list-dropdown-item{
    padding: 13px 17px 13px 15px;

}
.dropdown_wrapper{
    background-image: url('../../../assets/images/png/white_arrow_dd.png');
    background-repeat: no-repeat;
    background-position: 98% 50%;
}
@media(max-width:1199px){
    .list-dropdown-item {padding: 15px 17px 15px 8px;}
    .upgrade-now {padding: 5px 8px;margin-right: 10px;}
    .link-item {margin-right: 0px;}
}
</style>