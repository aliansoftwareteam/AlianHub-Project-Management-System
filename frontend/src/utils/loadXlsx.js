// The spreadsheet reader is a third of a megabyte and only needed once a file has been picked.
export const loadXlsx = () => import(/* webpackChunkName: "xlsx" */ 'xlsx');
