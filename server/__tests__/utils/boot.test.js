jest.mock("../../models/telemetry", () => ({ Telemetry: { send: jest.fn() } }));
jest.mock("../../utils/BackgroundWorkers", () => ({
  BackgroundService: class {
    boot() {}
  },
}));
jest.mock("../../utils/EncryptionManager", () => ({
  EncryptionManager: class {},
}));
jest.mock("../../utils/comKey", () => ({ CommunicationKey: class {} }));
jest.mock("../../utils/telemetry", () => jest.fn());
jest.mock("../../utils/boot/eagerLoadContextWindows", () => jest.fn());
jest.mock("../../utils/boot/markOnboarded", () => jest.fn());
jest.mock("../../utils/boot/migrateWebBrowsingToDefault", () => jest.fn());
jest.mock("../../utils/PushNotifications", () => ({
  PushNotifications: { setupPushNotificationService: jest.fn() },
}));
jest.mock("../../utils/telegramBot", () => ({
  TelegramBotService: { bootIfActive: jest.fn() },
}));

const { bootHTTP } = require("../../utils/boot");

describe("HTTP server boot lifecycle", () => {
  test("returns the listener so API runtimes can start and stop with the server", () => {
    const listener = { on: jest.fn() };
    listener.on.mockReturnValue(listener);
    const app = { listen: jest.fn(() => listener) };

    const booted = bootHTTP(app, 0);

    expect(app.listen).toHaveBeenCalledWith(0, expect.any(Function));
    expect(booted).toEqual({ app, server: listener });
    expect(listener.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
