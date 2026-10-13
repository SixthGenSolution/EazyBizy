import sharedCapacitySchedule from "../../capacity_schedule.json";

export const CAPACITY_SCHEDULE = sharedCapacitySchedule.capacity_schedule_pct;

const LEGACY_CAPACITY_SCHEDULE = [50, 60, 70, 75, 80] as const;

const CAPACITY_FIELDS = [
  "capacity_y1_pct",
  "capacity_y2_pct",
  "capacity_y3_pct",
  "capacity_y4_pct",
  "capacity_y5_pct",
] as const;

type CapacityFields = Partial<Record<(typeof CAPACITY_FIELDS)[number], number>>;

export function normalizeSavedCapacitySchedule<T extends CapacityFields>(dpr: T): T {
  const savedSchedule = CAPACITY_FIELDS.map((field) => Number(dpr[field]));
  const isLegacyDefault = savedSchedule.every(
    (capacity, index) => capacity === LEGACY_CAPACITY_SCHEDULE[index],
  );

  if (!isLegacyDefault) return dpr;

  return {
    ...dpr,
    capacity_y1_pct: CAPACITY_SCHEDULE[0],
    capacity_y2_pct: CAPACITY_SCHEDULE[1],
    capacity_y3_pct: CAPACITY_SCHEDULE[2],
    capacity_y4_pct: CAPACITY_SCHEDULE[3],
    capacity_y5_pct: CAPACITY_SCHEDULE[4],
  } as T;
}