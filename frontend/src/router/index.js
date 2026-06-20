import { createRouter, createWebHashHistory } from 'vue-router'
import auth from './auth'
import projects from './projects'
import chat from './chat'
import settings from './settings'
import timesheet from './timesheet'
import milestonesheet from './milestonesheet'
import reports from './reports';
import portfolio from './portfolio';
import customReports from './customReports';
import varianceReport from './varianceReport';
import capacityPlanning from './capacityPlanning';
import integrations from './integrations';

import { useCustomComposable } from '@/composable'
import dashboard from "../plugins/dashboard/router";
import { apiRequestWithoutCompnay } from '@/services'
import * as env from '@/config/env';
import Cookies from 'js-cookie'


const routes = [
	...auth,

	// PROJECT ROUTES
	...projects,

	// PROJECT ROUTES
	...chat,

	// SETTINGS ROUTES
	...settings,
	
	// TIMESHEET ROUTES
	...timesheet,

	//MILESTONE ROUTES
	...milestonesheet,


	// DASHBOARD ROUTES
	...dashboard.dashboardRouter,

	// REPORTS ROUTE
	...reports,

	// PORTFOLIO ROUTE (REP-01)
	...portfolio,

	// CUSTOM REPORTS ROUTE (REP-02)
	...customReports,

	// VARIANCE REPORT ROUTE (REP-04)
	...varianceReport,

	// CAPACITY PLANNING ROUTE (REP-06)
	...capacityPlanning,

	// INTEGRATIONS & AUTOMATION HUB (AUTO-01..07)
	...integrations,

	// CHANGELOG / WHAT'S NEW ROUTE
	{
		path: '/:cid/whats-new',
		name: 'Changelog',
		meta: {
			title: "What's New",
			requiresAuth: true
		},
		component: () => import(/* webpackChunkName: "changelog" */ '@/views/Changelog/Changelog.vue')
	},
	{
		path: "/:catchAll(.*)",
		name: "404",
		component: () => import(/* webpackChunkName: "404" */ '@/views/NotFound'),
		meta: {
			title: '404'
		}
	}
]

const router = createRouter({
	history: createWebHashHistory(process.env.BASE_URL),
	routes
})

// const authInst = getAuth();
const jsonData = require('../../../brandSettings.json');
const {setTitle} = useCustomComposable()
router.beforeEach(async(to, _, next) => {
	let query = to.query;
	let fullPath = to.fullPath;
	if (to.path == '/business' && to.query.code) {
		Cookies.set('refferCode', to.query.code, { expires: 365 });
		let coded = to.query;
		delete coded.code;
		query = coded;
		fullPath = removeCodeParam(to.fullPath);
	}
	const localUserId = localStorage.getItem("userId");
	const app = localUserId ? await apiRequestWithoutCompnay('get',`${env.USER_UPATE}/${localUserId}`) : null;
	let user = app && app?.status === 200 ? app?.data || null : null;
	
	// onAuthStateChanged(authInst, (user) => {
		// CHECK META FOR AUTH REQUIRED
		// const requiresAuth = to.matched.some(record => record.meta.requiresAuth);
		const requiresAuth = to.meta.requiresAuth;
		const token = Cookies.get('accessToken') || '';
		// SET PAGE TITLE
		setTitle({title: to.meta.title, prefix: jsonData?.productName ? `${jsonData.productName} | ` : ''});

		if(user === null && requiresAuth === true) {
			// IF USER IS NOT LOGGED IN AND REQUESTS AUTH REQUIRED PAGE
			next({name: 'Log-in', query: {redirect_url: fullPath}});
			return;
		} else if(user !== null && requiresAuth === false) {
			// IF USER IS LOGGED IN AND REQUESTS NO AUTH REQUIRED PAGE
			if(to.meta.title === 'Support'){
				next();
			}else if(token && !user?.AssignCompany?.length){
				next({name: "Create_Company", query: query});
			}else{
				next({name: "Home", params: {
					cid: localStorage.getItem('selectedCompany') ? localStorage.getItem('selectedCompany') : '',
				}, query: query});
			}
			return;
		} else {
			next();
			return;
		}
	// })
})

function removeCodeParam(url) {
    const [path, queryString] = url.split("?");
    if (!queryString) return url;

    const params = new URLSearchParams(queryString);
    params.delete("code");

    return params.toString() ? `${path}?${params.toString()}` : path;
}

export default router;
