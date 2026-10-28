const {
  searchPeople,
  mapPerson,
  MIN_QUERY_LENGTH,
} = require("../../modules/meetings/oaPeople");
const { MeetingError } = require("../../modules/meetings/errors");

describe("oaPeople.searchPeople", () => {
  test("rejects short queries", async () => {
    await expect(
      searchPeople({
        query: "a",
        baseUrl: "https://oa.example/oa/person",
        fetchImpl: jest.fn(),
      })
    ).rejects.toMatchObject({
      code: "INVALID_OA_QUERY",
      status: 400,
    });
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  test("rejects missing base URL without leaking secrets", async () => {
    await expect(
      searchPeople({
        query: "张三",
        baseUrl: "",
        env: {},
        fetchImpl: jest.fn(),
      })
    ).rejects.toMatchObject({
      code: "OA_NOT_CONFIGURED",
      status: 503,
    });
  });

  test("maps OA rows and encodes fd_name", async () => {
    const fetchImpl = jest.fn(async (url) => {
      expect(String(url)).toContain("fd_name=");
      expect(decodeURIComponent(String(url))).toContain("张三");
      return {
        ok: true,
        json: async () => [
          {
            fd_no: "E001",
            fd_name: "张三",
            fd_department: "研发",
          },
          { fd_no: "E002" },
        ],
      };
    });

    const people = await searchPeople({
      query: "张三",
      baseUrl: "https://oa.example/oa/person",
      fetchImpl,
    });

    expect(people).toEqual([
      { fd_no: "E001", fd_name: "张三", fd_department: "研发" },
    ]);
    expect(mapPerson({ fdNo: "1", fdName: "Li", department: "HR" })).toEqual({
      fd_no: "1",
      fd_name: "Li",
      fd_department: "HR",
    });
  });

  test("wraps upstream failures as OA_UNAVAILABLE without credential text", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("connect ECONNREFUSED secret=abc");
    });
    await expect(
      searchPeople({
        query: "wang",
        baseUrl: "https://user:pass@oa.example/oa/person",
        fetchImpl,
      })
    ).rejects.toMatchObject({
      code: "OA_UNAVAILABLE",
      status: 502,
    });
    try {
      await searchPeople({
        query: "wang",
        baseUrl: "https://oa.example/oa/person",
        fetchImpl,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(MeetingError);
      expect(String(error.message)).not.toMatch(/secret|user:pass/i);
    }
  });
});
