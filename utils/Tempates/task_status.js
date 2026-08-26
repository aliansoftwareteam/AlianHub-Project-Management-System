
/**
 * Task status template
 * @returns 
 */
exports.TemplateData = () => {
    const data = [
        {
            default:true,
            ActiveStatusList: [
                {
                    bgColor: "#6473e835",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 3,
                    type: "active",
                    name: "In Progress",
                    textColor: "#6473e8",
                    value: "in_progress"
                },
                {
                    bgColor: "#9759c035",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 4,
                    type: "active",
                    name: "In Review",
                    textColor: "#9759c0",
                    value: "in_review"
                },
                {
                    bgColor: "#ec414135",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 5,
                    type: "active",
                    name: "Backlog",
                    textColor: "#ec4141",
                    value: "backlog"
                },
                {
                    bgColor: "#24c11035",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 6,
                    type: "active",
                    name: "Done",
                    textColor: "#24c110",
                    value: "done"
                }
            ],
            Created_At: new Date(),
            DoneStatusList: [],
            TemplateName: "Development",
            defaultActive: {
                bgColor: "#ff960035",
                isEditable: false,
                key: 1,
                name: "To Do",
                textColor: "#ff9600",
                value: "to_do",
                type: "default_active",
            },
            defaultComplete: {
                bgColor: "#6BC95035",
                isEditable: false,
                key: 2,
                name: "Complete",
                textColor: "#6BC950",
                value: "complete",
                type: "close",
            },
            taskActiveStatus: [1,3,4,5,6],
            taskDoneStatus: [],
            taskcloseStatus: 2
        },
        {
            default:false,
            ActiveStatusList: [
                {
                    bgColor: "#6473e835",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 3,
                    type: "active",
                    name: "In Progress",
                    textColor: "#6473e8",
                    value: "in_progress"
                },
                {
                    bgColor: "#9759c035",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 4,
                    type: "active",
                    name: "In Review",
                    textColor: "#9759c0",
                    value: "in_review"
                },
                {
                    bgColor: "#cedb1f35",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 7,
                    type: "active",
                    name: "On Hold",
                    textColor: "#cedb1f",
                    value: "on_hold"
                }
            ],
            Created_At: new Date(),
            DoneStatusList: [],
            TemplateName: "UI/UX",
            defaultActive: {
                bgColor: "#ff960035",
                isEditable: false,
                key: 1,
                name: "To Do",
                textColor: "#ff9600",
                value: "to_do",
                type: "default_active",
            },
            defaultComplete: {
                bgColor: "#6BC95035",
                isEditable: false,
                key: 2,
                name: "Complete",
                textColor: "#6BC950",
                value: "complete",
                type: "close",
            },
            taskActiveStatus: [1,3,4,7],
            taskDoneStatus: [],
            taskcloseStatus: 2
        },
        {
            default:false,
            ActiveStatusList: [
                {
                    bgColor: "#6473e835",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 3,
                    type: "active",
                    name: "In Progress",
                    textColor: "#6473e8",
                    value: "in_progress"
                },
                {
                    bgColor: "#9759c035",
                    isAddNewStatus: false,
                    isEditable: false,
                    key: 4,
                    type: "active",
                    name: "In Review",
                    textColor: "#9759c0",
                    value: "in_review"
                },
            ],
            Created_At: new Date(),
            DoneStatusList: [],
            TemplateName: "Marketing",
            defaultActive: {
                bgColor: "#ff960035",
                isEditable: false,
                key: 1,
                name: "To Do",
                textColor: "#ff9600",
                value: "to_do",
                type: "default_active",
            },
            defaultComplete: {
                bgColor: "#6BC95035",
                isEditable: false,
                key: 2,
                name: "Complete",
                textColor: "#6BC950",
                value: "complete",
                type: "close",
            },
            taskActiveStatus: [1,3,4],
            taskDoneStatus: [],
            taskcloseStatus: 2
        }
    ]

    return data;
}