import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import SmartLearningCalendar, { type LearningCalendarTask } from "./SmartLearningCalendar";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

describe("SmartLearningCalendar local task normalization", () => {
  const storageScope = "normalizes-persisted-title";
  const storageKey = `eazybizy-learning-calendar:${storageScope}`;
  const storedValues = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return storedValues.size;
    },
    clear: () => storedValues.clear(),
    getItem: (key) => storedValues.get(key) ?? null,
    key: (index) => Array.from(storedValues.keys())[index] ?? null,
    removeItem: (key) => storedValues.delete(key),
    setItem: (key, value) => storedValues.set(key, String(value)),
  };
  let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    storedValues.clear();
    originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
  });

  afterEach(() => {
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(window, "localStorage", originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, "localStorage");
    }
  });

  it("preserves a persisted task title when loading from local storage", async () => {
    const title = "Review loan eligibility";
    const task = {
      aiGenerated: false,
      category: "Courses",
      completedAt: null,
      course: "Banking",
      createdAt: "2026-11-25T00:00:00.000Z",
      date: "2026-11-25",
      durationMinutes: 45,
      id: "persisted-task",
      missedAt: null,
      notes: "",
      reminderLog: [],
      reminderMinutes: 15,
      startTime: "19:00",
      status: "scheduled",
      title,
      timezone: "Asia/Kolkata",
      updatedAt: "2026-11-25T00:00:00.000Z",
    } satisfies LearningCalendarTask;
    const onTasksChange = vi.fn();

    window.localStorage.setItem(storageKey, JSON.stringify([task]));
    render(
      <SmartLearningCalendar
        focusLabel="Banking"
        onTasksChange={onTasksChange}
        storageScope={storageScope}
      />,
    );

    await waitFor(() => {
      expect(onTasksChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ title }),
      ]);
    });
  });
});
