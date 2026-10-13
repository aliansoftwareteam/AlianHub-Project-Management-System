const savedFilters = require("../../AdvancedGlobalFilter/helpers/savedFilters");

exports.getFilter = savedFilters.listFilters(() => ({ filter: 'taskFilter', typeFilter: 'projectTask' }));
exports.saveFilter = savedFilters.saveFilter;
exports.updateFilter = savedFilters.updateFilter;
exports.deleteFilter = savedFilters.deleteFilter;
