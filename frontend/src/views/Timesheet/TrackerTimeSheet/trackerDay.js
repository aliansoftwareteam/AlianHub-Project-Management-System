/* The Tracker timesheet shows a day by its hours. The day is read from the server once, and the hours a log reaches
   and the screenshots of each hour are worked out here; the screen used to ask once an hour, twenty-four times. */

const HOURS = 24;
const seconds = (ms) => Math.floor(ms / 1000);
const shotTime = (shot) => (shot?.screenShotTime ? Number(shot.screenShotTime) : Date.now());

export function hourSlots(date) {
    return Array.from({ length: HOURS }, (_, hour) => ({
        time: hour,
        inRange: false,
        start: new Date(date).setHours(hour, 0, 0, 0),
        end: new Date(date).setHours(hour + 1, 0, 0, 0),
        trackShot: []
    }));
}

export function dayRange(date) {
    const slots = hourSlots(date);
    return { start: seconds(slots[0].start), end: seconds(slots[HOURS - 1].end) };
}

/* The logs of the answer, one list for everyone, without those of a project this person does not see. */
export function logsOf(timesheet, projects) {
    const seen = new Set((projects || []).map((project) => String(project._id)));
    return (Array.isArray(timesheet) ? timesheet : [])
        .flatMap((row) => (Array.isArray(row?.data) ? row.data : []))
        .filter((log) => seen.has(String(log.ProjectId)));
}

const inSlot = (shot, slot) => shotTime(shot) >= slot.start && shotTime(shot) <= slot.end;

/* The same test the server made for one hour: the log ends at or after the hour's start and starts at or before its
   end. A server that does not yet say when a log ran is read by its screenshots. */
const reaches = (log, slot) => (log.LogStartTime === undefined || log.LogEndTime === undefined
    ? (log.trackShots || []).some((shot) => inSlot(shot, slot))
    : Number(log.LogEndTime) >= seconds(slot.start) && Number(log.LogStartTime) <= seconds(slot.end));

export const hoursWithLogs = (logs, slots) => slots.filter((slot) => logs.some((log) => reaches(log, slot))).map((slot) => slot.time);

export function shotsIn(logs, slot, { projects, userOf, companyId }) {
    const shots = [];
    logs.forEach((log) => {
        const project = (projects || []).find((entry) => String(entry._id) === String(log.ProjectId));
        (log.trackShots || []).filter((shot) => inSlot(shot, slot)).forEach((shot) => {
            const user = userOf(log.Loggeduser);
            shots.push({
                time: shotTime(shot),
                image: shot.image,
                trackShots: shot,
                userId: log.Loggeduser,
                memoName: log.LogDescription,
                projectName: project ? project.ProjectName : '',
                projectKey: project ? project.ProjectCode : '',
                userProfile: user?.Employee_profileImageURL,
                userName: user?.Employee_Name,
                taskId: log.TicketID,
                companyId,
                projectId: log.ProjectId
            });
        });
    });
    return shots.sort((a, b) => a.time - b.time);
}
