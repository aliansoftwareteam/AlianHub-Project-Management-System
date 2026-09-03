<template>
    <div class="d-flex align-items-center header_main_navigation_menu_main">
        <template v-for="(item, index) in menu.filter((xt) => xt.show === true)">
            <router-link
                :key="'item'+index+item.name"
                v-if="item.submenu && !item.submenu.length"
                :to="item.to"
                :class="{'is-active': isLinkActive(item)}"
                class="cursor-pointer kiln-link h-100"
            >
                {{ $t(`Header.${item.name}`) }}
            </router-link>

            <div :key="'nested-item-'+index+item.name" v-else class="kiln-link link-dropdown-menu" :class="{'is-active': isDropdownActive(item)}">
                <DropDown :id="'nav_menu2'+index+item.name" :title="item.name">
                    <template #button>
                        <div class="cursor-pointer dropdown_wrapper h-100" :id="item.id ? item.id : ''">
                            <span class="list-dropdown-item" :id="`list_dropdown_header${item.name}${index}`" ref="timesheet"> {{ $t(`Header.${item.name}`) }}</span>
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
import { defineComponent, defineProps } from "vue";
import { useRoute} from 'vue-router';
const route = useRoute();
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

const isLinkActive = (item) => {
    if (item.name === 'Pages') return route.name === 'Pages';
    if (item.name === 'Projects') return String(route.name || '').includes('Project');
    return false;
};

const isDropdownActive = (item) => (item.submenu || []).some(
    (s) => s && s.to && s.to.path && route.path.startsWith(s.to.path)
);

</script>

<style scoped>
.list-dropdown-item{
    padding: 0;
}
.dropdown_wrapper{
    padding-right: 18px;
}
.kiln-shell .dropdown_wrapper::after {
    content: "";
    display: inline-block;
    width: 0;
    height: 0;
    margin-left: 8px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid var(--kiln-ink-soft);
    vertical-align: middle;
}
@media(max-width:1199px){
    .list-dropdown-item {padding: 15px 17px 15px 8px;}
    .upgrade-now {padding: 5px 8px;margin-right: 10px;}
    .kiln-link {margin-right: 0px;}
}
</style>
