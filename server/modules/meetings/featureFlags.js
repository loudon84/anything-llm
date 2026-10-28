const { SystemSettings } = require("../../models/systemSettings");
const { MeetingError } = require("./errors");

const MEETING_LOCAL_TASKS_FLAG = "meeting_local_tasks";

async function isMeetingLocalTasksEnabled({
  getSetting = (clause) => SystemSettings.get(clause),
} = {}) {
  const row = await getSetting({ label: MEETING_LOCAL_TASKS_FLAG });
  return row?.value === "enabled";
}

async function assertMeetingLocalTasksEnabled(options) {
  if (await isMeetingLocalTasksEnabled(options)) return true;
  throw new MeetingError(
    "Meeting local tasks feature is disabled",
    "FEATURE_DISABLED",
    403
  );
}

module.exports = {
  MEETING_LOCAL_TASKS_FLAG,
  isMeetingLocalTasksEnabled,
  assertMeetingLocalTasksEnabled,
};
