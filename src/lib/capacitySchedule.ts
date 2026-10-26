import sharedCapacitySchedule from "../../capacity_schedule.json";

export const CAPACITY_SCHEDULE: number[] = sharedCapacitySchedule.capacity_schedule_pct;
export const SEVEN_YEAR_CAPACITY_SCHEDULE = [60, 75, 80, 85, 90, 95, 100] as const;

const LEGACY_CAPACITY_SCHEDULE = [50, 60, 70, 75, 80] as const;
const CAPACITY_FIELDS = [
  "capacity_y1_pct",
  "capacity_y2_pct",
  "capacity_y3_pct",
  "capacity_y4_pct",
  "capacity_y5_pct",
] as const;

type CapacityFields = Partial<Record<(typeof CAPACITY_FIELDS)[number], number>> & {
  capacity_schedule_pct?: number[];
};

export function getDefaultCapacitySchedule(durationYears: number): number[] {
  const duration = Math.max(1, Math.min(Math.floor(durationYears), 20));
  if (duration === 7) return [...SEVEN_YEAR_CAPACITY_SCHEDULE];
  return Array.from(
    { length: duration },
    (_, index) => CAPACITY_SCHEDULE[index] ?? 100,
  );
}

export function isValidCapacitySchedule(schedule: unknown): schedule is number[] {
  return Array.isArray(schedule) &&
    schedule.length > 0 &&
    schedule.every((capacity) =>
      typeof capacity === "number" && Number.isFinite(capacity) && capacity >= 0 && capacity <= 100,
    );
}

export function normalizeSavedCapacitySchedule<T extends CapacityFields>(
  dpr: T,
  durationYears = 5,
): T {
  const duration = Math.max(1, Math.min(Math.floor(durationYears), 20));
  const defaults = getDefaultCapacitySchedule(duration);
  const submittedSchedule = dpr.capacity_schedule_pct;
  if (submittedSchedule?.length === duration && isValidCapacitySchedule(submittedSchedule)) {
    return {
      ...dpr,
      capacity_y1_pct: submittedSchedule[0],
      capacity_y2_pct: submittedSchedule[1] ?? 0,
      capacity_y3_pct: submittedSchedule[2] ?? 0,
      capacity_y4_pct: submittedSchedule[3] ?? 0,
      capacity_y5_pct: submittedSchedule[4] ?? 0,
    };
  }
  if (isValidCapacitySchedule(submittedSchedule)) {
    const isFiveYearDefault = submittedSchedule.length === CAPACITY_SCHEDULE.length &&
      submittedSchedule.every((capacity, index) => capacity === CAPACITY_SCHEDULE[index]);
    const schedule = duration === 7 && isFiveYearDefault
      ? defaults
      : Array.from(
          { length: duration },
          (_, index) => submittedSchedule[index] ?? defaults[index] ?? 100,
        );
    return {
      ...dpr,
      capacity_y1_pct: schedule[0],
      capacity_y2_pct: schedule[1] ?? 0,
      capacity_y3_pct: schedule[2] ?? 0,
      capacity_y4_pct: schedule[3] ?? 0,
      capacity_y5_pct: schedule[4] ?? 0,
      capacity_schedule_pct: schedule,
    };
  }

  const legacySchedule = CAPACITY_FIELDS.map((field) => Number(dpr[field]));
  const hasLegacySchedule = legacySchedule.every(Number.isFinite);
  const isLegacyDefault = hasLegacySchedule &&
    legacySchedule.every((capacity, index) => capacity === LEGACY_CAPACITY_SCHEDULE[index]);
  const isFiveYearDefault = hasLegacySchedule &&
    legacySchedule.every((capacity, index) => capacity === CAPACITY_SCHEDULE[index]);

  let schedule = defaults;
  if (duration !== 5 && isFiveYearDefault) {
    schedule = defaults;
  } else if (hasLegacySchedule && !isLegacyDefault) {
    schedule = Array.from(
      { length: duration },
      (_, index) => legacySchedule[index] ?? defaults[index] ?? 100,
    );
  } else if (duration === 5 && isLegacyDefault) {
    schedule = [...CAPACITY_SCHEDULE];
  }

  return {
    ...dpr,
    capacity_y1_pct: schedule[0],
    capacity_y2_pct: schedule[1] ?? 0,
    capacity_y3_pct: schedule[2] ?? 0,
    capacity_y4_pct: schedule[3] ?? 0,
    capacity_y5_pct: schedule[4] ?? 0,
    capacity_schedule_pct: schedule,
  };
}
