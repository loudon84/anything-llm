const { EventEmitter } = require("events");
const {
  attachMeetingRuntime,
} = require("../../modules/meetings/serverLifecycle");

describe("meeting runtime follows the HTTP server lifecycle", () => {
  test.each(["http", "https"])("starts and stops with %s listener", (mode) => {
    const server = new EventEmitter();
    const runtime = { start: jest.fn(), stop: jest.fn() };

    expect(attachMeetingRuntime(server, runtime)).toBe(true);
    server.emit("listening");
    server.emit("close");

    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    expect(mode).toMatch(/http/);
  });

  test("does not bind lifecycle hooks when no listener was returned", () => {
    const runtime = { start: jest.fn(), stop: jest.fn() };
    expect(attachMeetingRuntime(null, runtime)).toBe(false);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.stop).not.toHaveBeenCalled();
  });
});
