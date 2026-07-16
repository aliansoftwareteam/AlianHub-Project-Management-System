exports.planObj = {
    "_id": {
      "$oid": "657c05b38896ebdb3901da36"
    },
    "planName": "enterPrise",
    "commentsView": true,
    "workloadTimesheet": true,
    "timeTrackingProjectApp": true,
    "sprint": null,
    "project": null,
    "guestUser": null,
    "maxPrivateProject": null,
    "maxPrivateChannels": null,
    "listView": true,
    "tagProjectApp": true,
    "timeEstimateProjectApp": true,
    "timeTrackerUser": null,
    "maxPublicProject": null,
    "actitvityView": true,
    "embadeVIew": true,
    "boardView": true,
    "tableView": true,
    "maxPublicChannels": null,
    "projectProjectApp": true,
    "users": null,
    "projectDetailsView": true,
    "projectTimesheet": true,
    "calenderView": true,
    "workloadView": true,
    "folder": null,
    "task": null,
    "userTimesheet": true,
    "chat": true,
    "multipleAssigneeProjectApp": true,
    "milstoneReport": true,
    "trackerTimesheet": true,
    "taskCheckList": true,
    "proejctCheckList": true,
    "projectWisePermisson": true,
    "createdAt": {
      "$date": "2023-12-15T07:52:19.227Z"
    },
    "updatedAt": {
      "$date": "2023-12-15T07:52:19.227Z"
    },
    "__v": 0,
    "userRoles": true,
    "userDesignation": true,
    "team": true,
    "sprintPerProject": null,
    "maxPrivateSprintPerProject": null,
    "maxPublicSprintPerProject": null,
    "folderPerProject": null,
    "maxTaskPerProject": null,
    "maxTaskPerSprint": null,
    "advanceFilterCtrlK": true,
    "oneToOneChat": true,
    "chanels": true,
    "milestone": true,
    "globalPermison": true,
    "customFields": true,
    "pushNotification": true,
    "emailNotification": true,
    "bucketStorage": null,
    "maxFileSize": null,
    "aiPermission": true,
    "aiRequest": null
  }
  
  exports.createCompanyObj = {
      "email": "owner@example.com",
      "password": "Abc@1234",
      "firstName": "Company",
      "lastName": "Owner",
      "companyName": "AlianHub Demo",
      "phoneNumber": "1234567890",
      "country": "India",
      "city": "Anand",
      "state": "Gujarat",
      "countryCodeObj": {
          "name": "India (भारत)",
          "iso2": "IN",
          "dialCode": "91"
      }
  };
  
  exports.adminUserObj = {
    "email": "admin@example.com",
    "password": "Abc@1234",
    "firstName": "Company",
    "lastName": "Admin"
  };
  
  exports.memberUserObj = {
    "email": "member@example.com",
    "password": "Abc@1234",
    "firstName": "Company",
    "lastName": "Member"
  };
  
  exports.projectArray = [{
      projectIcon: {
        "type": "color",
        "data": "#92CF44"
      },
      ProjectCategory: "Fixed Price",
      ProjectCode: "DP",
      ProjectName: "Development Project",
      CompanyId: "",
      isTemplate: false,
      TemplateId: "65f8452375b493b510d0021f",
      useTemplateProj: "category",
      statusType: "active",
      ProjectType: "Fix",
      projectCreatedBy: "",
      ProjectRequiredDefaultComponent: "ProjectListView",
      ProjectCurrency: {},
      customFiedlsValue: []
  }]