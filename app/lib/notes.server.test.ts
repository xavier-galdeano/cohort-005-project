import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { getNote, listNotes, saveNote } from "./notes.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfter(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

describe("saving a Note", () => {
  it("creates a Note with the body trimmed", () => {
    saveNote(db, base.user.id, lessonIds[0], "  Rewatch at 3:20  ", NOW);

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Rewatch at 3:20",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Second", minutesAfter(5));

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Second",
      createdAt: NOW.toISOString(),
      updatedAt: minutesAfter(5).toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("keeps characters like # and * as typed", () => {
    saveNote(db, base.user.id, lessonIds[0], "# not a heading\n*not bold*", NOW);

    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(
      "# not a heading\n*not bold*"
    );
  });

  it("deletes the Note when saved empty", () => {
    saveNote(db, base.user.id, lessonIds[0], "First", NOW);
    saveNote(db, base.user.id, lessonIds[0], "   ", NOW);

    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it.each([
    [2000, true],
    [2001, false],
  ])("a Note of %i characters is accepted: %s", (length, accepted) => {
    const result = saveNote(db, base.user.id, lessonIds[0], "a".repeat(length), NOW);

    expect(result.ok).toBe(accepted);
    expect(!!getNote(db, base.user.id, lessonIds[0])).toBe(accepted);
  });

  it("tells the Student the limit when a Note is too long", () => {
    expect(
      saveNote(db, base.user.id, lessonIds[0], "a".repeat(2001), NOW)
    ).toEqual({ ok: false, error: "A note can be at most 2,000 characters." });
  });
});

describe("listing Notes", () => {
  it("lists only the Student's own, last edited first, with Lesson and Course", () => {
    const other = db
      .insert(schema.users)
      .values({ name: "Other", email: "other@example.com", role: UserRole.Student })
      .returning()
      .get();
    saveNote(db, base.user.id, lessonIds[0], "Older", NOW);
    saveNote(db, base.user.id, lessonIds[1], "Newer", minutesAfter(5));
    saveNote(db, other.id, lessonIds[0], "Not mine", minutesAfter(10));

    expect(listNotes(db, base.user.id)).toEqual([
      expect.objectContaining({
        body: "Newer",
        lessonId: lessonIds[1],
        lessonTitle: "Lesson 2",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      }),
      expect.objectContaining({ body: "Older", lessonId: lessonIds[0] }),
    ]);
  });
});
