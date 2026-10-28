const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

describe("meetings.contentVersion schema default", () => {
  let prisma;
  let databaseDirectory;

  beforeAll(async () => {
    databaseDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "meeting-content-version-")
    );
    const isolatedDatabase = path.join(databaseDirectory, "meetings.db");
    fs.copyFileSync(
      path.join(__dirname, "../../storage/anythingllm.db"),
      isolatedDatabase
    );
    const migration = fs.readFileSync(
      path.join(
        __dirname,
        "../../prisma/migrations/20261028100000_meeting_summary_local_todos/migration.sql"
      ),
      "utf8"
    );
    prisma = new PrismaClient({
      datasources: {
        db: { url: `file:${isolatedDatabase.replace(/\\/g, "/")}` },
      },
    });
    for (const statement of migration
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch (error) {
        // Source anythingllm.db may already include this migration.
        const message = String(error?.message || error);
        if (
          /duplicate column name|already exists|UNIQUE constraint failed/i.test(
            message
          )
        ) {
          continue;
        }
        throw error;
      }
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (databaseDirectory)
      fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  test("defaults contentVersion to 0 when creating a meeting via prisma", async () => {
    const connection = await prisma.meeting_connections.create({
      data: { name: "contentVersion test", config: "{}" },
    });
    const meeting = await prisma.meetings.create({
      data: {
        connectionId: connection.id,
        externalId: "content-version-default",
        activeKey: `${connection.id}:content-version-default`,
        title: "Content version default",
        startTime: new Date("2026-10-28T02:00:00.000Z"),
        quarter: "2026-Q4",
        reviewStatus: "DRAFT",
        retrievalStatus: "WAITING_CONTENT",
        coverage: "{}",
      },
    });

    expect(meeting.contentVersion).toBe(0);
    await expect(
      prisma.meetings.findUnique({ where: { id: meeting.id } })
    ).resolves.toMatchObject({ contentVersion: 0 });
  });
});
