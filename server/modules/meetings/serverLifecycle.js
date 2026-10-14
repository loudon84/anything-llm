function attachMeetingRuntime(server, runtime) {
  if (!server || !runtime) return false;
  server.once("listening", () => runtime.start());
  server.once("close", () => runtime.stop());
  return true;
}

module.exports = { attachMeetingRuntime };
