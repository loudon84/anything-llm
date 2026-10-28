import LiveSyncToggle from "./Features/LiveSync/toggle";
import MeetingLocalTasksToggle from "./Features/MeetingLocalTasks/toggle";

export const configurableFeatures = {
  experimental_live_file_sync: {
    title: "Live Document Sync",
    component: LiveSyncToggle,
    key: "experimental_live_file_sync",
  },
  meeting_local_tasks: {
    title: "Meeting Local Tasks",
    component: MeetingLocalTasksToggle,
    key: "meeting_local_tasks",
  },
};
