class MeetingError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "MeetingError";
    this.code = code;
    this.status = status;
  }
}

module.exports = { MeetingError };
