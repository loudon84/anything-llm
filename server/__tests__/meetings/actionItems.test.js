const crypto = require("crypto");
const {
  extractActionItems,
  normalizeExcerpt,
} = require("../../modules/meetings/actionItems");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("normalizeExcerpt", () => {
  test("trims and collapses whitespace for stable identity", () => {
    expect(normalizeExcerpt("  hello\r\n\tworld  ")).toBe("hello\nworld");
    expect(normalizeExcerpt("a  \t  b")).toBe("a b");
  });
});

describe("extractActionItems", () => {
  test("extracts from Chinese whitelist headings with list items", () => {
    const originKey = "gateway:file:meeting_summary:0";
    const items = extractActionItems([
      {
        originKey,
        contentText: [
          "# 会议纪要",
          "",
          "## 待办事项",
          "- 完成方案评审",
          "- 提交预算",
          "",
          "## 其他",
          "- 忽略此项",
        ].join("\n"),
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "完成方案评审",
      description: "",
      originKey,
    });
    expect(items[1].title).toBe("提交预算");
    expect(items[0].candidateId).toBe(
      sha256(`${originKey}\n${normalizeExcerpt(items[0].sourceExcerpt)}`)
    );
    expect(items[0].sourceFingerprint).toBe(
      sha256(normalizeExcerpt(items[0].sourceExcerpt))
    );
  });

  test("matches English whitelist headings case-insensitively with trailing colon", () => {
    const originKey = "gateway:file:ai_smart_minutes:1";
    const items = extractActionItems([
      {
        originKey,
        contentText: [
          "ACTION ITEMS:",
          "* Ship the patch",
          "1. Write release notes",
          "",
          "Notes",
          "Not an action",
        ].join("\n"),
      },
    ]);

    expect(items.map((item) => item.title)).toEqual([
      "Ship the patch",
      "Write release notes",
    ]);
  });

  test("accepts To-Do and Action Item heading variants", () => {
    const a = extractActionItems([
      {
        originKey: "a",
        contentText: "## To-Do\n- First",
      },
    ]);
    const b = extractActionItems([
      {
        originKey: "b",
        contentText: "Action Item:\n- Second",
      },
    ]);
    expect(a[0].title).toBe("First");
    expect(b[0].title).toBe("Second");
  });

  test("merges nested list children into parent description", () => {
    const items = extractActionItems([
      {
        originKey: "nested",
        contentText: [
          "## 行动项",
          "- Parent task",
          "  - child detail",
          "  - another child",
          "- Solo task",
        ].join("\n"),
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Parent task");
    expect(items[0].description).toBe("child detail\nanother child");
    expect(items[0].sourceExcerpt).toContain("Parent task");
    expect(items[0].sourceExcerpt).toContain("child detail");
    expect(items[1]).toMatchObject({
      title: "Solo task",
      description: "",
    });
  });

  test("falls back to non-empty lines when section has no list items", () => {
    const items = extractActionItems([
      {
        originKey: "lines",
        contentText: ["TODO", "Follow up with vendor", "", "Send agenda"].join(
          "\n"
        ),
      },
    ]);

    expect(items.map((item) => item.title)).toEqual([
      "Follow up with vendor",
      "Send agenda",
    ]);
  });

  test("ignores non-whitelist headings and stops at the next markdown heading", () => {
    const items = extractActionItems([
      {
        originKey: "stop",
        contentText: [
          "## Action Items",
          "- Keep me",
          "## Summary",
          "- Drop me",
          "下一步",
          "- Also drop",
        ].join("\n"),
      },
    ]);

    expect(items.map((item) => item.title)).toEqual(["Keep me"]);
  });

  test("dedupes sources by originKey keeping the first", () => {
    const items = extractActionItems([
      {
        originKey: "same",
        contentText: "## 待办事项\n- First copy",
      },
      {
        originKey: "same",
        contentText: "## 待办事项\n- Second copy",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("First copy");
  });

  test("caps candidates at 50 by default", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `- Item ${i + 1}`);
    const items = extractActionItems([
      {
        originKey: "cap",
        contentText: ["## TODO", ...lines].join("\n"),
      },
    ]);

    expect(items).toHaveLength(50);
    expect(items[0].title).toBe("Item 1");
    expect(items[49].title).toBe("Item 50");
  });

  test("respects custom maxItems", () => {
    const items = extractActionItems(
      [
        {
          originKey: "custom-cap",
          contentText: "## TODO\n- a\n- b\n- c",
        },
      ],
      { maxItems: 2 }
    );
    expect(items).toHaveLength(2);
  });

  test("returns empty array when no whitelist section exists", () => {
    expect(
      extractActionItems([
        {
          originKey: "none",
          contentText: "## Summary\n- Not an action heading",
        },
      ])
    ).toEqual([]);
  });
});
