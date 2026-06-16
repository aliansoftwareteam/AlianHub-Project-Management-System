import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store'
import '@/config/firebaseInit';
import ToastPlugin from 'vue-toast-notification';
import 'vue-toast-notification/dist/theme-sugar.css';
import '@formkit/themes/genesis'
import '@formkit/pro/genesis'
import { plugin, defaultConfig } from '@formkit/vue'
import { createProPlugin, inputs } from '@formkit/pro'
import { DatePicker } from 'v-calendar';
import 'v-calendar/style.css';
import {i18n } from '@/locales/main';
import VueApexCharts from "vue3-apexcharts";
import DemoBanner from "@/components/atom/DemoBanner/DemoBanner.vue";
// Plugins Path
import registerPlugin from './plugins/register/registerPlugin';
import createcompanyinsidePlugin from './plugins/createcompanyinside/createcompanyinsidePlugin';
import chargebeePlugin from './plugins/chargebee/chargebeePlugin';
import paddlePlugin from './plugins/paddle/paddlePlugin';
import customfieldPlugin from './plugins/customFieldView/customFieldPlugin';
import dashboardPlugin from './plugins/dashboard/dashboardPlugin';
import importTasksPlugin from './plugins/importTasks/importTasksPlugin';
import exportTasksPlugin from './plugins/exportTasksPlugin/exportTasksPlugin';
import tasklistDashboardPlugin from './plugins/tasklistDashboard/tasklistDashboardPlugin';
import importUsersPlugin from './plugins/importUsers/importUsersPlugin';
import oAuthPlugin from './plugins/oauth/oAuthPlugin';


/**
 * CSS files
 */

import "@/assets/css/index.css";
import "@/assets/css/driver.css";
import { GridLayout, GridItem } from 'grid-layout-plus'


const pro = createProPlugin('fk-12603cbaaf0', inputs)

const app = createApp(App).use(store).use(router)

// Plugin Setup
const pluginArray = [
  registerPlugin,
  createcompanyinsidePlugin,
  chargebeePlugin,
  paddlePlugin,
  customfieldPlugin,
  dashboardPlugin,
  importTasksPlugin,
  exportTasksPlugin,
  tasklistDashboardPlugin,
  importUsersPlugin,
  oAuthPlugin
];
for (let index = 0; index < pluginArray.length; index++) {
  app.use(pluginArray[index]);
}

app.use(ToastPlugin,{position: 'top-right'});
app.use(plugin, defaultConfig({ plugins: [pro]}))
app.use(i18n);
// Registered before mount so the root App.vue template can resolve it.
app.component('DemoBanner', DemoBanner);
app.mount('#app');
// Use plugin defaults (optional)
app.component('ApexChart', VueApexCharts); // Register the apexchart component globally
app.component('VDatePicker', DatePicker)
app.component('GridLayout', GridLayout)
app.component('GridItem', GridItem)


// SIDEBAR
let element = document.createElement('div');
element.id="my-sidebar"
document.getElementById("app")?.appendChild(element)
// MODAL
element = document.createElement('div');
element.id="my-modal"
document.getElementById("app")?.appendChild(element)
// DROP DOWN
element = document.createElement('div');
element.id="my-dropdown"
document.getElementById("app")?.appendChild(element)
// DROP DOWN
element = document.createElement('div');
element.id="my-image-slider"
document.getElementById("app")?.appendChild(element)

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/firebase-messaging-sw.js')
    .then(() => {
      console.info('Service worker registered:');
    })
    .catch((error) => {
      console.info('Service worker registration failed:', error);
    });
}