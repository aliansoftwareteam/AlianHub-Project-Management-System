# Custom fields

A custom field is an extra box you add to your tasks. Your team may need a budget, a customer name, a due-by-customer date or a risk rating. AlianHub has no such box built in. So you make one.

You make a field once. Then every task it applies to gets a place to hold its own value. The field is shared. The values belong to each task.

This page is for someone who has never used them. Read it top to bottom the first time.

If a button is missing on your screen, your role may not allow it. Ask the person who owns your workspace. On a plan that does not include custom fields, the screen shows **Upgrade Your Plan** instead. A project can also switch the Custom Fields app off. Then its tasks show no fields.

## Where you make and manage them

There are three places. Each one makes a different kind of field.

| Place | How to open it | What you make |
|---|---|---|
| The manager | **More**, then **Settings**. Under Workspace, choose **Custom Field Manager**. | Fields for every project, or for the projects you choose. The only place that offers every type, and the only place to archive, delete or choose projects. |
| A task | Open a task. In its **Custom Field** section, choose **+ Custom Field**. | A task field for this project only. |
| Project details | Open the project, then its details. In the **Custom Field** section, choose **+ Custom Field**. | A project field for this project only. |

A field is either a task field or a project field.

- A **task field** holds one value on each task. It shows in the task, and in List, Table and Board.
- A **project field** holds one value on a project. It shows only in project details. It does not show in List, Table or Board. It cannot be filtered or grouped. Only the nine simple types (Text, Long text, Number, Money, Date, Dropdown, Checkbox, Email, Phone) show in project details.

You choose task or project in the **Type** menu when you make a simple field in the manager. It offers **Project** and **Task**. Every other type is a task field.

A field made in the manager starts out for every project. A field made from a task or from project details starts out for that one project. You can change this later with **Choose projects**.

To change a field that shows in every project, your role must allow workspace custom fields. To change a field of one project, your role must allow custom fields in that project.

## Make your first field

1. Open **Settings**, then **Custom Field Manager**. The page is called "Custom fields". The list shows the Field, its Type, where it is "Shown in" and "Required".
2. Under "Pick a type", choose a type. Or choose **Field** at the top right, which starts a Text field.
3. Type a name in "Field label". It must not be empty. No other field may use the same name. If it does you see "Another field already uses this label."
4. Set what the type asks for. See the next part.
5. Choose **Save field**. To make several in a row, choose **Save and add another**. Choose **Cancel** to stop.

Text, Long text, Number, Money, Date, Dropdown, Checkbox, Email and Phone open a side panel called "Create Custom Field" instead. It has tabs. Its buttons are **Cancel**, **Save and add another** and **Save**. In a task, the same panel starts with a list of types. **Back** returns you to that list.

A field you save cannot change its type. To get another type, make a new field.

Some fields also have "Show for task types". See [Show a field on some task types only](#show-a-field-on-some-task-types-only).

## The field types

The manager offers 19 types.

| Type | Use it for | Notes |
|---|---|---|
| **Text** | A short label on one line | Can limit how much text |
| **Long text** | Notes with no formatting | Can limit how much text |
| **Number** | Units, decimals | Can limit the smallest and largest value |
| **Money** | An amount of money | You choose the currency |
| **Date** | A date, and if you want a time | Choose the format and which days can be picked |
| **Dropdown** | A choice from your own list | One choice per task. Each option has a colour |
| **Checkbox** | Yes or no | |
| **Email** | An email address | Must look like an email address |
| **Phone** | A phone number | Has a country code |
| **People** | One or several workspace members | |
| **Link** | A web address | Opens in a new tab |
| **Rating** | Stars | |
| **Progress** | A bar from 0 to 100% | |
| **Files** | Files kept on the task | |
| **Relationship** | Links to other tasks | |
| **Voting** | One vote per person, counted | |
| **Formula** | A number worked out from other fields | Read only |
| **Rollup** | A number added up from subtasks | Read only |
| **AI field** | A value AI writes from the task | See [AI field](#ai-field) |

In a task, the list uses longer names for some types, such as "Text Area (Long Text)" and "Phone Number". It does not offer **AI field**. It is the same set otherwise.

### The simple types

These open the "Create Custom Field" panel. Every one has a General tab with "Field Label", "Placeholder" (not for Date) and "Description". The description shows as a tip next to the field name. The other tabs are below.

**Text and Long text.** Options tab. Tick the box to limit the amount of text. The help line reads "Limit the minimum or maximum amount of text allowed in this field". Then enter a minimum and a maximum. The minimum must be lower than the maximum. If you tick the box, fill in at least one.

**Number.** Options tab. Tick the box to limit the value. The help line reads "Limit the minimum or maximum value allowed for this field". Then enter a minimum and a maximum.

**Money.** Options tab, "Currency". Until you choose one, the currency is Indian Rupee. The symbol shows with the amount.

**Date.**
- General tab: "Separator" (a dash, a slash or a dot).
- Options tab: "Date Format". It offers month first, day first or year first, with the separator you chose.
- Time tab: tick the box to "Allow users to specify a time with date." Then choose "Time Format": 24 Hour or AM/PM.
- Limits tab: "Past & Future" lets you allow dates in the past, in the future, or both. "Days of the week" lets you untick a day so it cannot be picked.

**Dropdown.**
- Options tab: write your options. A colour sits beside each. Choose "Add another item" for more. Press Enter for the next option. Press Enter on an empty option to save. Paste several lines to make one option per line. Under "Predefined Options" you can start from a ready-made list: Gender, Days, Months, Time Zone or Country.
- Advanced tab: "Selected By Default". Tick one option. Tasks with no choice show it.
- A person picks one option per task.

**Checkbox.** General tab only.

**Email.** General tab only.

**Phone.** Options tab. Tick the country code box to let people change the country code. Then "Select the Default Country". Changing these settings later does not change values that are already there.

### The newer types

These open a short form in the manager. It has "Field label", the type's own settings, and "Show for task types".

**People.** Setting: "Allow several people". Untick to hold one person at a time. You can name only people who may open the project. A field holds at most 50 people.

**Link.** No settings. Only a web address that starts with http or https is accepted. If someone types an address with no scheme, AlianHub adds https://. Anything else is kept as plain text, with the note "This is not an http or https link, so it is not shown as one."

**Rating.** Setting: "Highest rating", a whole number from 3 to 10. The default is 5. A rating is a whole number from 1 up to that highest value. Choose "Clear the rating" to remove it.

**Progress.** No settings. A whole number from 0 to 100.

**Files.** Settings: "Most files", a whole number from 1 to 20 (the default is 10), and "Allowed files": **Any file**, **Images** or **Documents**. Images are png, jpg, jpeg, gif, webp and bmp. Documents are pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, md, rtf, odt, ods and odp. Choose **Add file** on the task. Removing a file asks "Remove this file?" with **Remove** and **Keep**. A file belongs to one task.

**Relationship.** Settings: "Most linked tasks", a whole number from 1 to 20 (the default is 10), and "Tasks come from": "Any project you can open", "One project" or "One list of a project". For the last two you also choose "Project" and, for a list, "List". People see only the linked tasks they can open.

**Voting.** Setting: "Show who voted". Untick to show only the number. Each person gets one vote and can withdraw it. Nobody can type a number in. Only people vote.

A Relationship or Voting field cannot be changed into another type, and no other type can become one.

## Formula

A formula field is read only. You write a sum, and AlianHub works it out for each task. You cannot type into it on a task.

Make one in the manager. Choose the **Formula** type. The panel has "Field label", "Formula" and "Show as". Below the formula box are buttons for every field you can use, and buttons for the functions. Click one to put it in the formula.

### What you can write

- Numbers, like `2` or `0.5`.
- Field names in curly brackets, like `{Billable rate}`.
- The four signs `+`, `-`, `*` and `/`, and round brackets.
- Comparisons: `>`, `<`, `>=`, `<=`, `=`, `==`, `!=` and `<>`. A comparison gives 1 when true and 0 when false.
- These functions, in capitals or small letters:

| Function | What it does |
|---|---|
| `SUM(a, b, ...)` | Adds the values |
| `AVG(a, b, ...)` | The average |
| `MIN(a, b, ...)` | The smallest |
| `MAX(a, b, ...)` | The largest |
| `COUNT(a, b, ...)` | How many values |
| `ROUND(x, places)` | Rounds. Places is optional and goes from 0 to 10 |
| `IF(test, then, else)` | Gives `then` when the test is not 0, otherwise `else` |

Nothing else works. A formula cannot use text, dates, `AND`, `OR` or any other word. It can be at most 1000 characters.

### Which names you can use

- A field's name, written exactly as the field is called, such as `{Billable rate}`. Its lowercase form with underscores also works, such as `{billable_rate}`.
- Four built-in names for the task itself: `{subtask_count}`, `{estimate}`, `{remaining_hours}` and `{logged_hours}`. `subtask_count` counts the task's direct subtasks. Despite the names, `estimate`, `remaining_hours` and `logged_hours` are in minutes, because task estimates are kept in minutes. `logged_hours` is the estimate minus what is remaining, never below 0.
- Other formula fields and rollup fields.

Fields to use: Number, Money, Rating, Progress, Formula and Rollup. A field whose value cannot be read as a number gives an error.

Examples:

- `{logged_hours} * {Billable rate}`
- `ROUND({Hours} * {Rate}, 2)`
- `IF({estimate} > 0, {logged_hours} / {estimate} * 100, 0)`

### Test and save

- **Test** tries the formula with made-up numbers (1, 2, 3 and so on). You see "Preview:" and a number. The preview shows that the formula works. It is not a real task's value.
- **Save field** refuses a formula it cannot read. It refuses a formula that points back at itself, or that two formulas share in a loop. It does not check that your field names exist. If you misspell one, every task shows a dash. Use **Test**. It shows "{name} has no value on this task." for a name it does not know.
- If you rename a field, a formula that uses the old name stops finding it. Edit the formula.

### What a task shows

The number is worked out on the server and stored on the task. The server works it out again when something the formula reads changes. That means the task's estimate, remaining time, subtasks, task type, project, or the value of a field.

A task shows a dash when the formula cannot give a number. This happens when:

- a name in it has no value on that task,
- it divides by zero,
- the result is not a number.

The formula does not treat an empty field as 0. There is no message on the task. A number is rounded to 6 decimal places.

After you change a formula, a task gets the new number the next time something it reads changes.

"Show as" has three buttons: **Money**, **Number** and **Text**. It does not change how the value looks. It only decides whether a group total is added. **Text** leaves the field out of totals.

## Rollup

A rollup field is read only. It adds up a number from the subtasks under a task.

Make one in the manager. Choose the **Rollup** type. The panel has "Roll up which field", "Aggregate" and "Show as".

- **Roll up which field**: "Number of subtasks", or one Number, Money, Rating, Progress, Formula or Rollup field. A rollup cannot read itself.
- **Aggregate**: **SUM**, **AVG**, **COUNT**, **MIN** or **MAX**.

What it counts:

- Every subtask under the task, on every level, once each. Subtasks nest three levels deep at most. Deleted subtasks are not counted. Their status does not matter.
- On a subtask, it counts the subtasks under that one.
- With a source field, only subtasks of a task type the field is for.
- A blank, or text that is not a number, is skipped by SUM, AVG, MIN and MAX.
- COUNT with a source field counts the subtasks that hold a value. COUNT with "Number of subtasks" counts all of them.

When there is nothing to count: SUM and COUNT give 0. AVG, MIN and MAX show a dash.

A rollup is worked out again on the server each time a subtask under the task changes. When you make or change a rollup, AlianHub fills in tasks that already have values. It does this for up to 500 subtasks that hold a value. Past that, the rest fill in as their subtasks change.

A rollup goes down, from a task to its subtasks. It does not roll up the tasks in a list or a project, and it does not follow Relationship links.

## AI field

An AI field is a Long text, Dropdown, Number, Rating or Date field that AI fills from the task. Make it in the manager. Choose **AI field**. The panel has these parts.

- "Output": **Long text**, **Dropdown**, **Labels**, **Number**, **Rating** or **Date**.
- "What AI fills in": for Long text, **Summary**, **Progress update**, **Translation**, **Action items** or **Custom**. For Dropdown, **Category** or **Custom**. For Labels, **Labels** or **Custom**. For Number, Rating and Date, **Custom** only.
- "Reads from the task": **Title**, **Description**, **Comments**, **Subtasks**. Pick at least one.
- "Refill when the task changes". It is off by default.

On the task, choose **Fill with AI**. You see a preview and must choose **Apply** before anything is written. In a column, the menu "{field}: AI options" offers a fill for many tasks. Each task is one AI call and counts in the workspace's AI spend. AI fills stop when AI is off, when the daily limit is reached or when the monthly budget is reached. An archived AI field is not filled.

## Show a field on some task types only

"Show for task types" appears in every field's form. Tick the task types the field is for. Leave every type unticked to show the field on all tasks.

On a task of another type:

- the field does not show,
- a value already saved is kept,
- filters, groups and sorting read the task as having no value,
- a rollup skips it.

## Choose projects

In the manager, open a field's menu. Choose **Choose projects**. The box "Where {field} shows" opens.

- **Every project**
- **Only the projects I choose**, then tick the projects. You must choose at least one ("Choose at least one project."). Personal projects are not listed.

Choose **Save**, or **Cancel** to stop. Taking a project off a field does not remove the values. They stay on the tasks and come back if you add the project again.

## Archive and delete

Open the menu of a field in the manager. It is the button with three dots, called "Actions for {field}". It has **Choose projects**, **Archive** (or **Restore**) and **Delete**.

### Archive

Archive hides a field and keeps everything.

- The field is gone from the task section, from List, Table and Board columns, from filters, and from Group by. The row in the manager shows an **Archived** chip.
- Every value saved on every task stays exactly as it is. Nothing is removed. For a Voting or Relationship field, the votes and the links stay too.
- The screen says "{field} is archived. Its values are kept."
- An archived formula or rollup keeps being worked out, and other fields can still read an archived field.
- An archived AI field is not filled.

### Restore

**Restore** puts the field back. The screen says "{field} is back on its tasks." Every value comes back, because none was ever removed.

Saving a change to an archived Text, Long text, Number, Money, Date, Dropdown, Checkbox, Email or Phone field also restores it. It does so without a message.

### Delete

Delete removes the field and its values for good. Nothing brings them back.

1. Choose **Delete**. The box "Delete {field}?" opens. It first says "Counting the tasks that hold a value…"
2. It then tells you how many tasks hold a value, such as "3 tasks hold a value for this field. The field and those values are removed for good."
3. It adds "To hide the field and keep its values, archive it instead."
4. Choose **Delete**. Or choose **Archive instead**. Or choose **Cancel**.

What delete does:

- It removes the field.
- It removes the saved value from every task that holds one, in every project. This includes tasks you cannot open. The count in the box covers only tasks you can open, and the box says so: "Only the tasks you can open are counted. The value goes from every task that holds one."
- It removes all votes and links of a Voting or Relationship field.
- It does not count as an edit to the tasks. Their "last updated" time does not change.
- The delete is written in the audit log.

Delete is not offered while another field reads this one. If a rollup adds this field up, or a formula uses its name, the box says "{fields} reads this field. Change or delete that field first." and has only **Close**. If the reader sits in a project you cannot open, you see "A field of a project you cannot open reads this field. Ask an owner or an admin to change or delete that field first."

## Where fields show

| Where | What you see |
|---|---|
| The task | The **Custom Field** section lists the fields of this project, and the fields for every project. Only fields for this task's type show. A formula or rollup shows a dash when there is no number. A person who may not edit sees the values and cannot change them. The pencil beside a name opens "Edit Custom Field". |
| List | A column for each field. They are off at first. Choose the **Columns** button, then tick the field. A "Field" tag marks fields in that list. **Reset to default** undoes your choice. |
| Table | A column for each field. They are on at first. The **Columns** button works the same way. |
| Board | Choose the **Card fields** button, then tick the fields to show on each card. |
| Calendar and Gantt | No fields show. |

You can edit most fields right in a List or Table cell. A formula or rollup cannot be edited.

### Filter, group, sort and totals

| What | Which types |
|---|---|
| **Filter** | Dropdown, Checkbox, Date, People, Number, Money, Rating, Progress, Text, Long text, Email, Phone, Link, Files, Relationship, Voting. **Not** Formula or Rollup. |
| **Group by** | Dropdown, Checkbox, Date, People, Rating, Number, Money, Progress, Voting, Relationship. **Not** Text, Long text, Email, Phone, Link, Files, Formula or Rollup. |
| **Sort** | Every type **except** Files and Relationship. |
| Totals | Number, Money, Formula and Rollup (unless the formula or rollup is shown as Text). |

**Filter.** Choose **Filter**, then **Add Filter**, then pick the field. The choices depend on the type. Text types offer Contains, Is, Is set and Is empty. Number types offer Equal To, Is Not, Greater Than, Less Than, Is set and Is empty. Date offers Is on, Is after, Is before, Is set and Is empty. Dropdown and People offer Is, Is Not, Is set and Is empty. Checkbox offers Is. Files offer Is set and Is empty. Relationship offers Contains task, Is set and Is empty. Voting offers I voted, Equal To, Greater Than and Less Than.

**Group by.** Choose **Group by**. Every field you can group by is in the menu, below the built-in ones. Number, Money, Progress and Voting fields group into ranges, with a "No value" group. Date fields group into date ranges, with "Past" and "No value". Relationship fields group into "Has a value" and "No value". Dropdown, People, Rating and Checkbox fields group by each value. If you drag a task into a group of one of those four, the task takes that value. A range group takes no drops.

**Sort.** In List and Board, choose **Sort**. In "Sort tasks by" the fields are listed by name. Then pick "Ascending" or "Descending". In Table, choose a column title. A Files column and a Relationship column have no sort.

**Totals.** A group in List or Table can show a row of totals under its tasks. It adds up each shown Number, Money, Formula or Rollup column. It counts a blank as 0. Money totals carry the field's currency symbol. Formula and rollup totals carry none.

## What it cannot do

- It cannot make a field required. No screen sets it. The "Required" column in the manager shows a dash.
- It cannot change a field's type after you save it.
- It cannot filter or group by a Formula or Rollup field.
- It cannot show a field in Calendar or Gantt.
- It cannot put a formula or rollup on a project. A project field is one of the nine simple types.
- It cannot rearrange fields in the task section or in the manager list.
- A formula cannot read text or dates, and cannot read another task. A rollup cannot read across a list or a project.
- It cannot bring back a deleted field.

Next: [The views](first-hour/04-views.md), or [Lists, folders and tasks](first-hour/03-lists-folders-tasks.md).
