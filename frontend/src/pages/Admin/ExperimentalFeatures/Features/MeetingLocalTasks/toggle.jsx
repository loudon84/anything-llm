import Admin from "@/models/admin";
import showToast from "@/utils/toast";
import { useState } from "react";
import Toggle from "@/components/lib/Toggle";

export default function MeetingLocalTasksToggle({ enabled = false, onToggle }) {
  const [status, setStatus] = useState(Boolean(enabled));
  const [busy, setBusy] = useState(false);

  async function toggleFeatureFlag() {
    if (busy) return false;
    setBusy(true);
    const next = !status;
    const result = await Admin.updateSystemPreferences({
      meeting_local_tasks: next ? "enabled" : "disabled",
    });
    setBusy(false);
    if (!result?.success) {
      showToast("Failed to update meeting local tasks flag.", "error", {
        clear: true,
      });
      return false;
    }

    setStatus(next);
    showToast(
      `Meeting local tasks have been ${next ? "enabled" : "disabled"}.`,
      "success",
      { clear: true }
    );
    onToggle?.();
    return true;
  }

  return (
    <div className="p-4">
      <div className="flex flex-col gap-y-6 max-w-[500px]">
        <div className="flex items-center justify-between">
          <h2 className="text-theme-text-primary text-md font-bold">
            Meeting Local Tasks
          </h2>
          <Toggle size="lg" enabled={status} onChange={toggleFeatureFlag} />
        </div>
        <div className="flex flex-col space-y-4">
          <p className="text-theme-text-secondary text-sm">
            Enable OA people search and local task creation from meeting action
            items. When disabled, create and OA proxy endpoints return
            FEATURE_DISABLED.
          </p>
          <p className="text-theme-text-secondary text-xs italic">
            Requires MEETING_OA_PEOPLE_BASE_URL for people search. Tasks stay
            local to AnythingLLM and are not written back to OA.
          </p>
        </div>
      </div>
    </div>
  );
}
