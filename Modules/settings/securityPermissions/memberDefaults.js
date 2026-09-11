// Safe to hardcode here and nowhere else: importCompanyRoles in utils/data.js is what creates role
// key 3 as "Member", so at seed time the number and the role are the same thing. Runtime code must
// never assume it — a company can rename or add roles afterwards.
const MEMBER_ROLE_TYPE = 3;

// What a brand-new company gives the Member role. Before this existed the rules were seeded with
// empty role lists, so an invited teammate saw a product with almost everything hidden and the
// owner had to set ~100 switches by hand before anyone could work.
//
// These are not invented. Two established companies were read and compared: where both owners had
// independently made the same choice, that choice is the default; where they differed, the more
// restrictive of the two is used, never below Read if both allowed at least Read. Keys absent from
// this map get nothing, so anything unlisted or newly added fails closed.
//
// false = Read, true = Read & Write, a number = the "Own (1) / Everyone (2)" selection fields.
const MEMBER_DEFAULT_PERMISSIONS = Object.freeze({
    // Sections. `settings` and `artificial_intelligence` are deliberately absent.
    project: false,
    task: true,
    chat: true,
    sheet_settings: false,

    // Projects: members work inside them, they do not administer them.
    project_list: false,
    public_projects: false,
    private_projects: 1,
    project_details: false,

    // Tasks: the day-to-day job, so this group is open.
    task_list: true,
    task_create: true,
    sub_task_create: true,
    task_name_edit: true,
    task_total_estimate: true,
    task_status: true,
    task_assignee: true,
    task_priority: true,
    task_due_date: true,
    task_start_date: true,
    task_description: true,
    task_checklist: true,
    task_checklist_assign_remove: true,
    task_attachments: true,
    task_tag: true,
    task_type: true,
    task_comment: true,
    task_details: true,
    task_duplicate: true,
    task_move: true,
    task_merge: true,
    task_archive: true,
    task_delete: true,
    task_convert_to_list: true,
    task_convert_to_subtask: true,
    convert_to_task: true,
    task_activity_log: false,
    task_estimated_hours: 1,
    show_tasks: 1,
    queue_list: true,
    list_view_column: true,
    advance_search: true,

    // Chat.
    one_to_one_chat: true,
    chat_category: true,
    chat_channel: true,

    // Timesheets: their own only.
    user_timesheet: 1,
});

module.exports = { MEMBER_ROLE_TYPE, MEMBER_DEFAULT_PERMISSIONS };
