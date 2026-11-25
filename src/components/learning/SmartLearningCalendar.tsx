import { memo, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlarmClock,
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Plus,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type CalendarView = "month" | "week" | "day";
type TaskCategory = "Courses" | "Practice" | "Revision" | "Exams";
type TaskStatus = "scheduled" | "completed" | "missed";

export type LearningCalendarTask = {
  aiGenerated?: boolean;
  category: TaskCategory;
  completedAt?: string | null;
  course: string;
  createdAt: string;
  date: string;
  durationMinutes: number;
  id: string;
  missedAt?: string | null;
  notes: string;
  reminderLog: string[];
  reminderMinutes: number;
  startTime: string;
  status: TaskStatus;
  title: string;
  timezone: string;
  updatedAt: string;
};

type LearningTaskForm = {
  category: TaskCategory;
  course: string;
  customReminderMinutes: string;
  date: string;
  durationMinutes: string;
  notes: string;
  reminderMode: "0" | "15" | "60" | "custom";
  startTime: string;
  title: string;
};

type SmartLearningCalendarProps = {
  allowBrowserNotifications?: boolean;
  focusLabel: string;
  onBrowserNotificationsChange?: (enabled: boolean) => void;
  onSummaryChange?: (summary: string) => void;
  onTasksChange?: (tasks: LearningCalendarTask[]) => void;
  savedCourses?: string[];
  storageScope: string;
  userId?: string;
};

type HolidayInfo = {
  kind: "national" | "banking" | "regional";
  name: string;
};

const categoryStyles: Record<
  TaskCategory,
  {
    chip: string;
    dot: string;
    soft: string;
    text: string;
  }
> = {
  Courses: {
    chip: "border border-[#3654a7] bg-[#132659] text-[#d9e5ff]",
    dot: "bg-[#7ea2ff]",
    soft: "bg-[#132659]",
    text: "text-[#d9e5ff]",
  },
  Practice: {
    chip: "border border-[#0f7289] bg-[#072733] text-[#b6f2ff]",
    dot: "bg-[#22d3ee]",
    soft: "bg-[#072733]",
    text: "text-[#b6f2ff]",
  },
  Revision: {
    chip: "border border-[#2f4ca0] bg-[#101f49] text-[#d7e4ff]",
    dot: "bg-[#60a5fa]",
    soft: "bg-[#101f49]",
    text: "text-[#d7e4ff]",
  },
  Exams: {
    chip: "border border-[#905024] bg-[#2f1607] text-[#ffd5b5]",
    dot: "bg-[#fb923c]",
    soft: "bg-[#2f1607]",
    text: "text-[#ffd5b5]",
  },
};

const statusStyles: Record<TaskStatus, { label: string; className: string; iconClassName: string }> = {
  completed: {
    className: "border-emerald-500/35 bg-emerald-500/15 text-emerald-100",
    iconClassName: "text-emerald-300",
    label: "Completed",
  },
  missed: {
    className: "border-rose-500/35 bg-rose-500/15 text-rose-100",
    iconClassName: "text-rose-300",
    label: "Missed",
  },
  scheduled: {
    className: "border-blue-400/35 bg-blue-500/15 text-blue-100",
    iconClassName: "text-blue-200",
    label: "Scheduled",
  },
};

const viewModes: CalendarView[] = ["month", "week", "day"];
const taskCategories: TaskCategory[] = ["Courses", "Practice", "Revision", "Exams"];
const weekDayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const fixedIndianHolidays: Record<string, HolidayInfo> = {
  "01-01": { kind: "regional", name: "New Year learning reset" },
  "01-26": { kind: "national", name: "Republic Day" },
  "04-14": { kind: "national", name: "Ambedkar Jayanti" },
  "05-01": { kind: "regional", name: "Labour Day / Maharashtra Day" },
  "08-15": { kind: "national", name: "Independence Day" },
  "10-02": { kind: "national", name: "Gandhi Jayanti" },
  "12-25": { kind: "national", name: "Christmas" },
};

const aiPlanLibrary = {
  banking: [
    "Understand core banking products",
    "Practice KYC and account opening basics",
    "Review credit assessment signals",
    "Revise banking compliance checkpoints",
    "Complete the banking readiness quiz",
    "Practice a customer finance case",
    "Review certificate notes",
  ],
  loans: [
    "Complete Loan Basics module",
    "Practice EMI and eligibility examples",
    "Review collateral and document checklist",
    "Study Mudra and MSME loan use cases",
    "Complete loan documentation quiz",
    "Practice a repayment risk scenario",
    "Revise lender communication notes",
  ],
  msme: [
    "Map your MSME learning goal",
    "Study registration and Udyam basics",
    "Review working capital planning",
    "Practice scheme eligibility examples",
    "Complete MSME funding checklist",
    "Revise cash flow warning signs",
    "Take the MSME readiness quiz",
  ],
  default: [
    "Complete today's finance lesson",
    "Practice one real business example",
    "Revise key notes from the module",
    "Attempt a short knowledge check",
    "Review mistakes and reschedule gaps",
    "Finish the next learning milestone",
    "Prepare your weekly summary",
  ],
};

const learningTaskOptions = [
  "Complete Module 1",
  "Complete Module 2",
  "Complete Module 3",
  "Complete Module 4",
  "Complete Module 5",
];

const cloudTable = "learning_calendar_tasks";

const getDefaultCalendarView = (): CalendarView => {
  if (typeof window === "undefined") return "month";
  return window.innerWidth < 640 ? "week" : "month";
};

const pad = (value: number) => value.toString().padStart(2, "0");

const getLocalTimezone = () => {
  if (typeof Intl === "undefined") return "Local time";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
};

const toDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const dateFromKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addMinutes = (date: Date, minutes: number) => {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
};

const startOfWeek = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
};

const endOfWeek = (date: Date) => addDays(startOfWeek(date), 7);

const isSameDay = (first: Date, second: Date) => toDateKey(first) === toDateKey(second);

const formatMonthTitle = (date: Date) => `${monthNames[date.getMonth()]} ${date.getFullYear()}`;

const formatDayTitle = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(date);

const formatFullDate = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(date);

const buildTaskDateTime = (task: LearningCalendarTask) => {
  const date = dateFromKey(task.date);
  const [hours, minutes] = task.startTime.split(":").map(Number);
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return date;
};

const getTaskEndTime = (task: LearningCalendarTask) => addMinutes(buildTaskDateTime(task), task.durationMinutes);

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getDefaultForm = (selectedDate: Date, defaultCourse = ""): LearningTaskForm => ({
  category: "Courses",
  course: defaultCourse,
  customReminderMinutes: "30",
  date: toDateKey(selectedDate),
  durationMinutes: "45",
  notes: "",
  reminderMode: "15",
  startTime: "19:00",
  title: "",
});

const normalizeCategory = (value: unknown): TaskCategory =>
  taskCategories.includes(value as TaskCategory) ? (value as TaskCategory) : "Courses";

const normalizeStatus = (value: unknown): TaskStatus =>
  value === "completed" || value === "missed" || value === "scheduled" ? value : "scheduled";

const normalizeTask = (value: unknown): LearningCalendarTask | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<LearningCalendarTask>;
  if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.date !== "string") return null;

  return {
    aiGenerated: item.aiGenerated === true,
    category: normalizeCategory(item.category),
    completedAt: typeof item.completedAt === "string" ? item.completedAt : null,
    course: typeof item.course === "string" ? item.course : "Banking",
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    date: item.date,
    durationMinutes: typeof item.durationMinutes === "number" ? item.durationMinutes : 45,
    id: item.id,
    missedAt: typeof item.missedAt === "string" ? item.missedAt : null,
    notes: typeof item.notes === "string" ? item.notes : "",
    reminderLog: Array.isArray(item.reminderLog) ? item.reminderLog.filter((entry) => typeof entry === "string") : [],
    reminderMinutes: typeof item.reminderMinutes === "number" ? item.reminderMinutes : 15,
    startTime: typeof item.startTime === "string" ? item.startTime : "19:00",
    status: normalizeStatus(item.status),
    title: item.title,
    timezone: typeof item.timezone === "string" ? item.timezone : getLocalTimezone(),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
  };
};

const readStoredTasks = (storageKey: string) => {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown[];
    return Array.isArray(parsed) ? parsed.map(normalizeTask).filter(Boolean) as LearningCalendarTask[] : [];
  } catch {
    return [];
  }
};

const getIndianHoliday = (date: Date): HolidayInfo | null => {
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (fixedIndianHolidays[monthDay]) return fixedIndianHolidays[monthDay];

  const isSaturday = date.getDay() === 6;
  const saturdayNumber = Math.ceil(date.getDate() / 7);
  if (isSaturday && (saturdayNumber === 2 || saturdayNumber === 4)) {
    return { kind: "banking", name: "Banking holiday" };
  }

  return null;
};

const getMonthGrid = (date: Date) => {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(firstOfMonth);
  start.setDate(1 - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
};

const getPlanTemplate = (goal: string) => {
  const normalizedGoal = goal.toLowerCase();
  if (normalizedGoal.includes("loan")) return aiPlanLibrary.loans;
  if (normalizedGoal.includes("msme")) return aiPlanLibrary.msme;
  if (normalizedGoal.includes("bank")) return aiPlanLibrary.banking;
  return aiPlanLibrary.default;
};

const mapTaskToCloudRow = (task: LearningCalendarTask, userId: string) => ({
  ai_generated: task.aiGenerated ?? false,
  category: task.category,
  completed_at: task.completedAt ?? null,
  course: task.course,
  created_at: task.createdAt,
  duration_minutes: task.durationMinutes,
  id: task.id,
  missed_at: task.missedAt ?? null,
  notes: task.notes,
  reminder_log: task.reminderLog,
  reminder_minutes: task.reminderMinutes,
  session_date: task.date,
  start_time: task.startTime,
  status: task.status,
  timezone: task.timezone,
  title: task.title,
  updated_at: task.updatedAt,
  user_id: userId,
});

const mapCloudRowToTask = (row: Record<string, unknown>): LearningCalendarTask | null =>
  normalizeTask({
    aiGenerated: row.ai_generated,
    category: row.category,
    completedAt: row.completed_at,
    course: row.course,
    createdAt: row.created_at,
    date: row.session_date,
    durationMinutes: row.duration_minutes,
    id: row.id,
    missedAt: row.missed_at,
    notes: row.notes,
    reminderLog: row.reminder_log,
    reminderMinutes: row.reminder_minutes,
    startTime: row.start_time,
    status: row.status,
    timezone: row.timezone,
    title: row.title,
    updatedAt: row.updated_at,
  });

const learningTasksEqual = (left: LearningCalendarTask[], right: LearningCalendarTask[]) =>
  left.length === right.length && JSON.stringify(left) === JSON.stringify(right);

const SmartLearningCalendar = ({
  allowBrowserNotifications = true,
  focusLabel,
  onBrowserNotificationsChange,
  onSummaryChange,
  onTasksChange,
  savedCourses = [],
  storageScope,
  userId,
}: SmartLearningCalendarProps) => {
  const { toast } = useToast();
  const storageKey = `eazybizy-learning-calendar:${storageScope}`;
  const [tasks, setTasks] = useState<LearningCalendarTask[]>(() => readStoredTasks(storageKey));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [isCompactViewport, setIsCompactViewport] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 640,
  );
  const [view, setView] = useState<CalendarView>(getDefaultCalendarView);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [titleSearchOpen, setTitleSearchOpen] = useState(false);
  const [courseSearchOpen, setCourseSearchOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<LearningTaskForm>(() => getDefaultForm(new Date()));
  const [plannerGoal, setPlannerGoal] = useState(focusLabel || "Banking");
  const [plannerDays, setPlannerDays] = useState("5");
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () =>
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted" &&
      allowBrowserNotifications,
  );
  const [syncStatus, setSyncStatus] = useState<"local" | "syncing" | "synced">("local");

  const inputClassName =
    "h-12 rounded-2xl border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 placeholder:opacity-100 focus-visible:border-[#1d4ed8] focus-visible:ring-4 focus-visible:ring-[#bfdbfe]/45 focus-visible:ring-offset-0";
  const pickerInputClassName = `${inputClassName} [color-scheme:light]`;
  const selectClassName =
    "h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-medium text-slate-900 outline-none transition focus:border-[#1d4ed8] focus:ring-4 focus:ring-[#bfdbfe]/45";
  const textareaClassName =
    "min-h-[112px] rounded-2xl border-slate-200 bg-slate-50 text-base leading-6 text-slate-900 placeholder:text-slate-400 placeholder:opacity-100 focus-visible:border-[#1d4ed8] focus-visible:ring-4 focus-visible:ring-[#bfdbfe]/45 focus-visible:ring-offset-0";

  const todayKey = toDateKey(new Date());
  const selectedDateKey = toDateKey(selectedDate);
  const selectedHoliday = getIndianHoliday(selectedDate);
  const timezoneLabel = getLocalTimezone();

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((first, second) => {
        const firstTime = buildTaskDateTime(first).getTime();
        const secondTime = buildTaskDateTime(second).getTime();
        return firstTime - secondTime;
      }),
    [tasks],
  );

  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, LearningCalendarTask[]>();
    sortedTasks.forEach((task) => {
      const current = grouped.get(task.date) ?? [];
      current.push(task);
      grouped.set(task.date, current);
    });
    return grouped;
  }, [sortedTasks]);

  const selectedTasks = tasksByDate.get(selectedDateKey) ?? [];
  const todayTasks = tasksByDate.get(todayKey) ?? [];
  const nextTask = sortedTasks.find((task) => task.status === "scheduled" && buildTaskDateTime(task).getTime() >= Date.now());
  const missedTasks = tasks.filter((task) => task.status === "missed");
  const completedTasks = tasks.filter((task) => task.status === "completed");

  const weekStart = startOfWeek(selectedDate);
  const weekEnd = endOfWeek(selectedDate);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekTasks = tasks.filter((task) => {
    const taskDate = dateFromKey(task.date);
    return taskDate >= weekStart && taskDate < weekEnd;
  });

  const savedCourseOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];

    const addOption = (value: string) => {
      const normalized = value.trim();
      if (!normalized) return;

      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      options.push(normalized);
    };

    savedCourses.forEach(addOption);
    tasks.forEach((task) => addOption(task.course));
    addOption(focusLabel);
    addOption(plannerGoal);

    return options.sort((first, second) => first.localeCompare(second));
  }, [focusLabel, plannerGoal, savedCourses, tasks]);

  const filteredCourseOptions = useMemo(() => {
    const courseSearchTerm = form.course.trim().toLowerCase();

    return savedCourseOptions.filter((course) =>
      !courseSearchTerm ? true : course.toLowerCase().includes(courseSearchTerm),
    );
  }, [form.course, savedCourseOptions]);

  const filteredTaskTitleOptions = useMemo(() => {
    const taskSearchTerm = form.title.trim().toLowerCase();

    return learningTaskOptions.filter((taskTitle) =>
      !taskSearchTerm ? true : taskTitle.toLowerCase().includes(taskSearchTerm),
    );
  }, [form.title]);
  const weekCompletion = weekTasks.length
    ? Math.round((weekTasks.filter((task) => task.status === "completed").length / weekTasks.length) * 100)
    : 0;

  const dailyStreak = useMemo(() => {
    let streak = 0;
    let cursor = new Date();

    while (streak < 60) {
      const key = toDateKey(cursor);
      const hasCompleted = tasks.some((task) => task.date === key && task.status === "completed");
      if (!hasCompleted) break;
      streak += 1;
      cursor = addDays(cursor, -1);
    }

    return streak;
  }, [tasks]);

  const calendarSummary = nextTask
    ? `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(dateFromKey(nextTask.date))} at ${nextTask.startTime}`
    : "Plan today";

  const loadCloudTasks = useCallback(async () => {
    if (!userId) {
      setSyncStatus("local");
      return;
    }

    setSyncStatus((current) => (current === "local" ? "syncing" : current));

    try {
      const client = supabase as unknown as { from: (table: string) => unknown };
      const query = client.from(cloudTable) as {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            order: (column: string, options?: { ascending?: boolean }) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }>;
          };
        };
      };
      const { data, error } = await query
        .select("*")
        .eq("user_id", userId)
        .order("session_date", { ascending: true });

      if (error) throw error;

      const cloudTasks = (data ?? []).map(mapCloudRowToTask).filter(Boolean) as LearningCalendarTask[];
      setTasks((current) => (learningTasksEqual(current, cloudTasks) ? current : cloudTasks));
      setSyncStatus("synced");
    } catch (error) {
      console.warn("Learning calendar cloud sync unavailable:", error);
      setSyncStatus("local");
    }
  }, [userId]);

  const syncTaskToCloud = useCallback(
    async (task: LearningCalendarTask) => {
      if (!userId) return;

      try {
        const client = supabase as unknown as { from: (table: string) => unknown };
        const query = client.from(cloudTable) as {
          upsert: (row: Record<string, unknown>) => Promise<{ error: Error | null }>;
        };
        const { error } = await query.upsert(mapTaskToCloudRow(task, userId));
        if (error) throw error;
        setSyncStatus("synced");
      } catch (error) {
        console.warn("Unable to sync learning calendar task:", error);
        setSyncStatus("local");
      }
    },
    [userId],
  );

  const deleteTaskFromCloud = useCallback(
    async (taskId: string) => {
      if (!userId) return;

      try {
        const client = supabase as unknown as { from: (table: string) => unknown };
        const query = client.from(cloudTable) as {
          delete: () => {
            eq: (column: string, value: string) => Promise<{ error: Error | null }>;
          };
        };
        const { error } = await query.delete().eq("id", taskId);
        if (error) throw error;
      } catch (error) {
        console.warn("Unable to delete learning calendar task from cloud:", error);
      }
    },
    [userId],
  );

  const showLearningNotification = useCallback(
    (title: string, description: string) => {
      toast({ title, description });

      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification(title, {
            body: description,
            icon: "/logo.png",
          });
        } catch (error) {
          console.warn("Browser notification failed:", error);
        }
      }
    },
    [toast],
  );

  useEffect(() => {
    const storedTasks = readStoredTasks(storageKey);
    setTasks((current) => (learningTasksEqual(current, storedTasks) ? current : storedTasks));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const updateViewport = () => setIsCompactViewport(mediaQuery.matches);

    updateViewport();

    const listeners: Partial<MediaQueryList> = mediaQuery;
    if (listeners.addEventListener && listeners.removeEventListener) {
      listeners.addEventListener("change", updateViewport);
      return () => listeners.removeEventListener?.("change", updateViewport);
    }

    if (listeners.addListener && listeners.removeListener) {
      listeners.addListener(updateViewport);
      return () => listeners.removeListener?.(updateViewport);
    }

    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(tasks));
  }, [storageKey, tasks]);

  useEffect(() => {
    onSummaryChange?.(calendarSummary);
  }, [calendarSummary, onSummaryChange]);

  useEffect(() => {
    onTasksChange?.(sortedTasks);
  }, [onTasksChange, sortedTasks]);

  useEffect(() => {
    const granted =
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted";
    setNotificationsEnabled(granted && allowBrowserNotifications);
  }, [allowBrowserNotifications]);

  useEffect(() => {
    void loadCloudTasks();
  }, [loadCloudTasks]);

  useEffect(() => {
    if (!userId) return;

    const client = supabase as unknown as {
      channel: (name: string) => {
        on: (event: string, options: Record<string, string>, callback: () => void) => { subscribe: () => unknown };
        subscribe: () => unknown;
      };
      removeChannel: (channel: unknown) => void;
    };

    try {
      const channel = client
        .channel(`learning-calendar-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            filter: `user_id=eq.${userId}`,
            schema: "public",
            table: cloudTable,
          },
          () => {
            void loadCloudTasks();
          },
        )
        .subscribe();

      return () => client.removeChannel(channel);
    } catch (error) {
      console.warn("Learning calendar realtime sync unavailable:", error);
    }
  }, [loadCloudTasks, userId]);

  useEffect(() => {
    const runSmartChecks = () => {
      const now = new Date();
      const alerts: Array<{ description: string; title: string }> = [];
      const cloudUpdates: LearningCalendarTask[] = [];

      setTasks((current) => {
        let changed = false;

        const next = current.map((task) => {
          if (task.status !== "scheduled") return task;

          const start = buildTaskDateTime(task);
          const end = getTaskEndTime(task);
          const reminderAt = addMinutes(start, -task.reminderMinutes);
          const reminderKey = `reminder:${task.id}:${task.reminderMinutes}`;
          const exactKey = `start:${task.id}`;
          let nextTask = task;

          if (now >= reminderAt && now < end && !task.reminderLog.includes(reminderKey)) {
            nextTask = {
              ...nextTask,
              reminderLog: [...nextTask.reminderLog, reminderKey],
              updatedAt: now.toISOString(),
            };
            alerts.push({
              description: `${task.title} starts at ${task.startTime}. Stay consistent with your plan.`,
              title: "Learning reminder",
            });
            changed = true;
          }

          if (now >= start && now < end && !nextTask.reminderLog.includes(exactKey)) {
            nextTask = {
              ...nextTask,
              reminderLog: [...nextTask.reminderLog, exactKey],
              updatedAt: now.toISOString(),
            };
            alerts.push({
              description: `${task.title} is scheduled now.`,
              title: "Time to learn",
            });
            changed = true;
          }

          if (now > end) {
            const missedTask = {
              ...nextTask,
              missedAt: now.toISOString(),
              status: "missed" as TaskStatus,
              updatedAt: now.toISOString(),
            };
            alerts.push({
              description: "You missed your learning session. Stay consistent to achieve your goals.",
              title: "Learning session missed",
            });
            cloudUpdates.push(missedTask);
            changed = true;
            return missedTask;
          }

          if (nextTask !== task) cloudUpdates.push(nextTask);
          return nextTask;
        });

        return changed ? next : current;
      });

      alerts.forEach((alert) => showLearningNotification(alert.title, alert.description));
      cloudUpdates.forEach((task) => void syncTaskToCloud(task));
    };

    runSmartChecks();
    const intervalId = window.setInterval(runSmartChecks, 30_000);
    return () => window.clearInterval(intervalId);
  }, [showLearningNotification, syncTaskToCloud]);

  const requestNotificationPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast({
        title: "Notifications unavailable",
        description: "This browser does not support learning reminders.",
      });
      return;
    }

    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    onBrowserNotificationsChange?.(enabled);
    setNotificationsEnabled(enabled);
    toast({
      title: enabled ? "Learning reminders enabled" : "Notifications not enabled",
      description: enabled
        ? "EazyBizy can now remind you about upcoming learning sessions."
        : "You can still use the planner, but browser reminders are disabled.",
    });
  };

  const openNewTaskDialog = (date = selectedDate) => {
    setEditingTaskId(null);
    setTitleSearchOpen(false);
    setCourseSearchOpen(false);
    setForm(getDefaultForm(date));
    setTaskDialogOpen(true);
  };

  const openEditTaskDialog = (task: LearningCalendarTask) => {
    setEditingTaskId(task.id);
    setTitleSearchOpen(false);
    setCourseSearchOpen(false);
    setForm({
      category: task.category,
      course: task.course,
      customReminderMinutes: String(task.reminderMinutes),
      date: task.date,
      durationMinutes: String(task.durationMinutes),
      notes: task.notes,
      reminderMode: task.reminderMinutes === 0 || task.reminderMinutes === 15 || task.reminderMinutes === 60
        ? String(task.reminderMinutes) as LearningTaskForm["reminderMode"]
        : "custom",
      startTime: task.startTime,
      title: task.title,
    });
    setTaskDialogOpen(true);
  };

  const selectSavedCourse = (course: string) => {
    setForm((current) => ({ ...current, course }));
    setCourseSearchOpen(false);
  };

  const selectLearningTaskTitle = (title: string) => {
    setForm((current) => ({ ...current, title }));
    setTitleSearchOpen(false);
  };

  const updateTask = (taskId: string, updater: (task: LearningCalendarTask) => LearningCalendarTask) => {
    let updatedTask: LearningCalendarTask | null = null;

    setTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        updatedTask = updater(task);
        return updatedTask;
      }),
    );

    if (updatedTask) void syncTaskToCloud(updatedTask);
  };

  const handleTaskSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.title.trim()) {
      toast({
        variant: "destructive",
        title: "Task title required",
        description: "Add a clear learning task before saving the schedule.",
      });
      return;
    }

    const now = new Date().toISOString();
    const reminderMinutes =
      form.reminderMode === "custom"
        ? Math.max(0, Number(form.customReminderMinutes) || 0)
        : Number(form.reminderMode);

    const nextTask: LearningCalendarTask = {
      aiGenerated: false,
      category: form.category,
      completedAt: null,
      course: form.course.trim() || focusLabel || "Banking",
      createdAt: now,
      date: form.date,
      durationMinutes: Math.max(15, Number(form.durationMinutes) || 45),
      id: editingTaskId ?? createId(),
      missedAt: null,
      notes: form.notes.trim(),
      reminderLog: [],
      reminderMinutes,
      startTime: form.startTime || "19:00",
      status: "scheduled",
      title: form.title.trim(),
      timezone: timezoneLabel,
      updatedAt: now,
    };

    if (editingTaskId) {
      setTasks((current) =>
        current.map((task) =>
          task.id === editingTaskId
            ? {
                ...nextTask,
                createdAt: task.createdAt,
              }
            : task,
        ),
      );
    } else {
      setTasks((current) => [...current, nextTask]);
    }

    void syncTaskToCloud(nextTask);
    setSelectedDate(dateFromKey(nextTask.date));
    setTaskDialogOpen(false);
    toast({
      title: editingTaskId ? "Learning task updated" : "Learning task scheduled",
      description: `${nextTask.title} is planned for ${formatDayTitle(dateFromKey(nextTask.date))} at ${nextTask.startTime}.`,
    });
  };

  const markTaskCompleted = (taskId: string) => {
    const now = new Date().toISOString();
    updateTask(taskId, (task) => ({
      ...task,
      completedAt: now,
      missedAt: null,
      status: "completed",
      updatedAt: now,
    }));
    toast({
      title: "Session completed",
      description: "Nice momentum. Your learning progress has been updated.",
    });
  };

  const rescheduleTask = (task: LearningCalendarTask, date = addDays(new Date(), 1)) => {
    const now = new Date().toISOString();
    const rescheduledTask = {
      ...task,
      completedAt: null,
      date: toDateKey(date),
      missedAt: null,
      reminderLog: [],
      status: "scheduled" as TaskStatus,
      updatedAt: now,
    };

    setTasks((current) => current.map((item) => (item.id === task.id ? rescheduledTask : item)));
    void syncTaskToCloud(rescheduledTask);
    setSelectedDate(date);
    toast({
      title: "Session rescheduled",
      description: `${task.title} moved to ${formatDayTitle(date)}.`,
    });
  };

  const deleteTask = (taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    void deleteTaskFromCloud(taskId);
    toast({
      title: "Task removed",
      description: "The learning session has been removed from your planner.",
    });
  };

  const generateAiPlan = () => {
    const days = Math.min(10, Math.max(3, Number(plannerDays) || 5));
    const template = getPlanTemplate(plannerGoal || focusLabel);
    const now = new Date();
    const firstDate = now.getHours() >= 20 ? addDays(now, 1) : now;
    const generatedAt = now.toISOString();

    const generatedTasks = Array.from({ length: days }, (_, index) => {
      const date = addDays(firstDate, index);
      const holiday = getIndianHoliday(date);
      const title = template[index % template.length];

      return {
        aiGenerated: true,
        category: holiday ? "Revision" as TaskCategory : index === days - 1 ? "Exams" as TaskCategory : "Courses" as TaskCategory,
        completedAt: null,
        course: plannerGoal || focusLabel || "Banking",
        createdAt: generatedAt,
        date: toDateKey(date),
        durationMinutes: holiday ? 30 : 45,
        id: createId(),
        missedAt: null,
        notes: holiday
          ? `${holiday.name}: use this holiday to revise your learning.`
          : "AI suggested learning block from EazyBizy Smart Planner.",
        reminderLog: [],
        reminderMinutes: 15,
        startTime: holiday ? "10:00" : "19:00",
        status: "scheduled" as TaskStatus,
        title,
        timezone: timezoneLabel,
        updatedAt: generatedAt,
      };
    });

    setTasks((current) => [...current, ...generatedTasks]);
    generatedTasks.forEach((task) => void syncTaskToCloud(task));
    setSelectedDate(dateFromKey(generatedTasks[0]?.date ?? toDateKey(now)));
    setView("week");
    toast({
      title: "AI study plan created",
      description: `EazyBizy filled ${days} learning sessions for ${plannerGoal || focusLabel}.`,
    });
  };

  const shiftPeriod = (direction: -1 | 1) => {
    const next = new Date(selectedDate);
    if (view === "month") next.setMonth(next.getMonth() + direction);
    if (view === "week") next.setDate(next.getDate() + direction * 7);
    if (view === "day") next.setDate(next.getDate() + direction);
    setSelectedDate(next);
  };

  const monthGrid = useMemo(() => getMonthGrid(selectedDate), [selectedDate]);
  const noStudyToday = todayTasks.length === 0;
  const closeToModuleCompletion = completedTasks.length > 0 && completedTasks.length % 4 === 3;

  const syncLabel =
    syncStatus === "synced" ? "Cloud sync on" : syncStatus === "syncing" ? "Syncing" : "Local backup";

  const renderTaskRow = (task: LearningCalendarTask) => {
    const categoryStyle = categoryStyles[task.category];
    const statusStyle = statusStyles[task.status];
    const StatusIcon = task.status === "completed" ? CheckCircle2 : task.status === "missed" ? XCircle : AlarmClock;

    return (
      <div
        key={task.id}
        className="group rounded-[24px] border border-[#243966] bg-[linear-gradient(180deg,rgba(17,27,58,0.96),rgba(11,18,40,0.98))] p-4 shadow-[0_18px_42px_-34px_rgba(2,6,23,0.9)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[#3650a7] hover:bg-[#15244a]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]", categoryStyle.chip)}>
                {task.category}
              </span>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]", statusStyle.className)}>
                <StatusIcon className={cn("h-3.5 w-3.5", statusStyle.iconClassName)} />
                {statusStyle.label}
              </span>
              {task.aiGenerated ? (
                <span className="rounded-full border border-[#3654a7] bg-[#132659] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d9e5ff]">
                  AI plan
                </span>
              ) : null}
            </div>
            <h4 className="mt-3 text-[1rem] font-semibold leading-6 text-white">{task.title}</h4>
            <p className="mt-1 text-sm leading-6 text-[#adc0ea]">
              {task.startTime} - {task.durationMinutes} min - {task.course}
            </p>
            {task.notes ? <p className="mt-2 text-sm leading-6 text-[#8fa3d1]">{task.notes}</p> : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {task.status !== "completed" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => markTaskCompleted(task.id)}
              className="h-9 rounded-full bg-[linear-gradient(135deg,#10b981_0%,#059669_100%)] px-4 text-white hover:brightness-105"
            >
              Mark complete
            </Button>
          ) : null}
          {task.status === "missed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => rescheduleTask(task)}
              className="h-9 rounded-full border-rose-400/25 bg-[#1b1326] px-4 text-rose-200 hover:bg-[#2a1734]"
            >
              Reschedule
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => openEditTaskDialog(task)}
            className="h-9 rounded-full border-[#304a85] bg-[#111b3a] px-4 text-[#d9e5ff] hover:bg-[#16264f]"
          >
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => deleteTask(task.id)}
            className="h-9 rounded-full border-[#304a85] bg-[#111b3a] px-4 text-[#a7b9e4] hover:bg-[#16264f]"
          >
            Remove
          </Button>
        </div>
      </div>
    );
  };

  const renderCompactTaskRow = (task: LearningCalendarTask) => {
    const categoryStyle = categoryStyles[task.category];
    const statusStyle = statusStyles[task.status];
    const StatusIcon = task.status === "completed" ? CheckCircle2 : task.status === "missed" ? XCircle : AlarmClock;

    return (
      <div
        key={task.id}
        className="rounded-[18px] border border-[#243966] bg-[#111b3a] p-3 shadow-[0_12px_26px_-24px_rgba(2,6,23,0.84)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", categoryStyle.dot)} />
              <p className="truncate text-sm font-semibold text-white">{task.title}</p>
            </div>
            <p className="mt-1 text-xs text-[#9eb1dc]">
              {task.startTime} - {task.durationMinutes}m - {task.category}
            </p>
          </div>
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border", statusStyle.className)}>
            <StatusIcon className={cn("h-3.5 w-3.5", statusStyle.iconClassName)} />
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {task.status !== "completed" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => markTaskCompleted(task.id)}
              className="h-8 rounded-full bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700"
            >
              Done
            </Button>
          ) : null}
          {task.status === "missed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => rescheduleTask(task)}
              className="h-8 rounded-full border-rose-400/25 bg-[#1b1326] px-3 text-xs text-rose-200 hover:bg-[#2a1734]"
            >
              Reschedule
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => openEditTaskDialog(task)}
            className="h-8 rounded-full border-[#304a85] bg-[#111b3a] px-3 text-xs text-[#d9e5ff] hover:bg-[#16264f]"
          >
            Edit
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-[#253a6b] bg-[linear-gradient(180deg,#091225_0%,#0d1630_54%,#09101f_100%)] p-3.5 text-[#e8eeff] shadow-[0_28px_72px_-44px_rgba(2,6,23,0.92)] sm:p-4">
      <div className="pointer-events-none absolute left-[-24%] top-[-18%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.18),transparent_66%)] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-22%] right-[-24%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.16),transparent_68%)] blur-3xl" />

      <div className="relative">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#2d4380] bg-white/6 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-[#c7d5ff] shadow-[0_16px_30px_-26px_rgba(37,99,235,0.4)]">
              <Sparkles className="h-3.5 w-3.5" />
              Smart planner
            </div>
            <h3 className="mt-3 text-[1.25rem] font-semibold leading-tight tracking-tight text-white">
              Smart Learning Calendar
            </h3>
            <p className="mt-1 text-xs leading-5 text-[#90a3cf]">
              Plan, track, and reschedule learning sessions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <Button
              type="button"
              onClick={() => openNewTaskDialog()}
              className="h-10 w-full rounded-full bg-[linear-gradient(135deg,#1539b6_0%,#1d4ed8_100%)] px-4 text-sm text-white shadow-[0_18px_34px_-24px_rgba(37,99,235,0.5)] hover:brightness-105 sm:h-9 sm:w-auto sm:px-3"
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-[18px] border border-[#243966] bg-[linear-gradient(180deg,rgba(17,27,58,0.98),rgba(12,19,42,0.98))] p-3 shadow-[0_14px_34px_-30px_rgba(2,6,23,0.85)]">
            <div className="flex items-center gap-2 text-[#8cb3ff]">
              <Flame className="h-4 w-4" />
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em]">Streak</span>
            </div>
            <p className="mt-1.5 text-xl font-semibold text-white">{dailyStreak} day{dailyStreak === 1 ? "" : "s"}</p>
          </div>
          <div className="rounded-[18px] border border-[#243966] bg-[linear-gradient(180deg,rgba(17,27,58,0.98),rgba(12,19,42,0.98))] p-3 shadow-[0_14px_34px_-30px_rgba(2,6,23,0.85)]">
            <div className="flex items-center gap-2 text-[#9ab7ff]">
              <BadgeCheck className="h-4 w-4" />
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em]">Week</span>
            </div>
            <p className="mt-1.5 text-xl font-semibold text-white">{weekCompletion}%</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {viewModes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition",
                view === mode
                  ? "bg-[linear-gradient(135deg,#1539b6_0%,#1d4ed8_100%)] text-white shadow-[0_16px_30px_-22px_rgba(37,99,235,0.5)]"
                  : "border border-[#2d4380] bg-[#101b38] text-[#b4c2e6] hover:bg-[#18274f] hover:text-white",
              )}
            >
              {mode}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedDate(new Date())}
            className="rounded-full border border-[#2d4380] bg-[#101b38] px-3 py-1.5 text-xs font-semibold text-[#b4c2e6] transition hover:bg-[#18274f] hover:text-white"
          >
            Today
          </button>
        </div>

        <div className="mt-4 rounded-[24px] border border-[#23365e] bg-[linear-gradient(180deg,rgba(15,24,52,0.98),rgba(8,14,32,0.98))] p-3 shadow-[0_20px_46px_-36px_rgba(2,6,23,0.88)] backdrop-blur-xl sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8da0c8]">
                {view === "month" ? "Month view" : view === "week" ? "Week view" : "Daily plan"}
              </p>
              <h4 className="mt-1 text-base font-semibold text-white">
                {view === "month" ? formatMonthTitle(selectedDate) : view === "week" ? `${formatDayTitle(weekStart)} - ${formatDayTitle(addDays(weekEnd, -1))}` : formatFullDate(selectedDate)}
              </h4>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => shiftPeriod(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#2d4380] bg-[#101b38] text-[#d7e3ff] shadow-[0_12px_28px_-24px_rgba(2,6,23,0.85)] transition hover:bg-[#18274f] hover:text-white sm:h-9 sm:w-9"
                aria-label="Previous calendar period"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => shiftPeriod(1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#2d4380] bg-[#101b38] text-[#d7e3ff] shadow-[0_12px_28px_-24px_rgba(2,6,23,0.85)] transition hover:bg-[#18274f] hover:text-white sm:h-9 sm:w-9"
                aria-label="Next calendar period"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="rounded-full border border-[#2e4a94] bg-[#112047] px-2.5 py-1 text-[11px] font-semibold text-[#d9e4ff]">
                {timezoneLabel}
              </div>
            </div>
          </div>

          {view === "month" ? (
            <div className="mt-3">
              <div className="overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <div className={cn("grid gap-1", isCompactViewport ? "min-w-[20rem]" : "min-w-0")}>
                  <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7f91bc]">
                    {weekDayLabels.map((day) => (
                      <div key={day} className="py-1">
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {monthGrid.map((day) => {
                      const key = toDateKey(day);
                      const dayTasks = tasksByDate.get(key) ?? [];
                      const holiday = getIndianHoliday(day);
                      const isCurrentMonth = day.getMonth() === selectedDate.getMonth();
                      const selected = key === selectedDateKey;
                      const isToday = isSameDay(day, new Date());

                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setSelectedDate(day)}
                          onDoubleClick={() => openNewTaskDialog(day)}
                          className={cn(
                            "min-h-[52px] rounded-[13px] border p-1.5 text-left transition hover:-translate-y-0.5 hover:border-[#3650a7] hover:bg-[#172652] sm:min-h-[44px]",
                            selected
                              ? "border-[#5b82ff] bg-[linear-gradient(180deg,rgba(37,99,235,0.28),rgba(19,35,81,0.94))] shadow-[0_18px_34px_-24px_rgba(37,99,235,0.5)]"
                              : "border-[#18274d] bg-[#0f1835]",
                            !isCurrentMonth && "opacity-45",
                            holiday && "bg-[#132246]",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={cn(
                                "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold sm:h-6 sm:w-6 sm:text-xs",
                                isToday ? "bg-[linear-gradient(135deg,#1539b6_0%,#1d4ed8_100%)] text-white" : "text-[#dce6ff]",
                              )}
                            >
                              {day.getDate()}
                            </span>
                            {holiday ? <span className="h-1.5 w-1.5 rounded-full bg-[#78a7ff]" /> : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-0.5 sm:gap-1">
                            {dayTasks.slice(0, 3).map((task) => (
                              <span key={task.id} className={cn("h-1.5 w-1.5 rounded-full", categoryStyles[task.category].dot)} />
                            ))}
                            {dayTasks.length > 3 ? <span className="text-[10px] font-semibold text-[#9fb2db]">+{dayTasks.length - 3}</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {view === "week" ? (
            <div className="mt-3 grid gap-2">
              {weekDays.map((day) => {
                const key = toDateKey(day);
                const dayTasks = tasksByDate.get(key) ?? [];
                const holiday = getIndianHoliday(day);

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedDate(day);
                      setView("day");
                    }}
                    className={cn(
                      "rounded-[18px] border border-[#23365e] bg-[#111b3a] p-3 text-left shadow-[0_12px_30px_-28px_rgba(2,6,23,0.84)] transition hover:-translate-y-0.5 hover:bg-[#172750]",
                      key === selectedDateKey && "ring-2 ring-[#5b82ff]/70",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{formatDayTitle(day)}</p>
                        <p className="mt-1 text-xs text-[#9fb2db]">{holiday?.name ?? `${dayTasks.length} learning session${dayTasks.length === 1 ? "" : "s"}`}</p>
                      </div>
                      <span className="rounded-full border border-[#2e4a94] bg-[#112047] px-3 py-1 text-xs font-semibold text-[#d9e4ff]">
                        {dayTasks.length}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {dayTasks.length ? (
                        dayTasks.slice(0, 3).map((task) => (
                          <span key={task.id} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", categoryStyles[task.category].chip)}>
                            {task.startTime} {task.title}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-[#9fb2db]">Open slot for a focused learning block.</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {view === "day" ? (
            <div className="mt-3 space-y-2">
              {selectedTasks.length ? selectedTasks.map(renderCompactTaskRow) : (
                <div className="rounded-[20px] border border-dashed border-[#2d4380] bg-[#0f1835] p-4 text-center">
                  <CalendarDays className="mx-auto h-7 w-7 text-[#7ea2ff]" />
                  <p className="mt-2 text-sm font-semibold text-white">No session planned.</p>
                  <p className="mt-1 text-xs leading-5 text-[#9fb2db]">Add a task or use AI planner.</p>
                  <Button
                    type="button"
                    onClick={() => openNewTaskDialog(selectedDate)}
                    className="mt-4 h-10 rounded-full bg-[linear-gradient(135deg,#1539b6_0%,#1d4ed8_100%)] px-4 text-white"
                  >
                    Add learning task
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3">
          {selectedHoliday ? (
            <div className="rounded-[20px] border border-[#23365e] bg-[#101a39] p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#132659] text-[#89a9ff]">
                  <CalendarDays className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{selectedHoliday.name}</p>
                  <p className="mt-1 text-xs leading-5 text-[#9fb2db]">
                    Use this holiday to revise or complete a short practice block.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-[20px] border border-[#23365e] bg-[#101a39] p-3 shadow-[0_16px_38px_-32px_rgba(2,6,23,0.84)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8da0c8]">Today&apos;s plan</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {todayTasks.length ? `${todayTasks.length} session${todayTasks.length === 1 ? "" : "s"} scheduled` : "No session scheduled"}
                </p>
              </div>
              <Clock3 className="h-5 w-5 text-[#89a9ff]" />
            </div>
            <div className="mt-3 space-y-2">
              {todayTasks.length ? todayTasks.slice(0, 2).map(renderCompactTaskRow) : (
                <div className="rounded-[16px] bg-[#0f1835] p-3 text-xs leading-5 text-[#9fb2db]">
                  You haven&apos;t studied today. Add a 30 minute session.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[20px] border border-[#304a85] bg-[linear-gradient(135deg,#10193a_0%,#172a5d_46%,#2043a8_100%)] p-3 text-white shadow-[0_24px_48px_-34px_rgba(37,99,235,0.38)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/78">
                  <Lightbulb className="h-3.5 w-3.5" />
                  AI Planner
                </div>
                <h4 className="mt-3 text-base font-semibold tracking-tight">Auto-fill study plan</h4>
                <p className="mt-1 text-xs leading-5 text-white/70">
                  Create 3-10 sessions from your goal.
                </p>
              </div>
              <Target className="h-5 w-5 text-white/78" />
            </div>

            <div className="mt-3 grid gap-2">
              <Input
                value={plannerGoal}
                onChange={(event) => setPlannerGoal(event.target.value)}
                placeholder="Banking, Loans, MSME..."
                className="h-10 rounded-2xl border-white/10 bg-white/10 text-sm text-white placeholder:text-white/46"
              />
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  value={plannerDays}
                  onChange={(event) => setPlannerDays(event.target.value)}
                  className="h-10 rounded-2xl border border-white/10 bg-white/10 px-3 text-sm font-semibold text-white outline-none"
                >
                  <option className="text-slate-900" value="3">3 days</option>
                  <option className="text-slate-900" value="5">5 days</option>
                  <option className="text-slate-900" value="7">7 days</option>
                  <option className="text-slate-900" value="10">10 days</option>
                </select>
                <Button
                  type="button"
                  onClick={generateAiPlan}
                  className="h-10 w-full rounded-2xl bg-white px-3 text-sm font-semibold text-[#1e1b4b] hover:bg-white/92 sm:w-auto"
                >
                  Generate
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={requestNotificationPermission}
              className="rounded-[18px] border border-[#23365e] bg-[#101a39] p-3 text-left shadow-[0_12px_30px_-28px_rgba(2,6,23,0.84)] transition hover:bg-[#15244a]"
            >
              <BellRing className="h-4 w-4 text-[#89a9ff]" />
              <p className="mt-2 text-sm font-semibold text-white">
                {notificationsEnabled ? "Browser alerts on" : "Enable reminders"}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#9fb2db]">Before and exact-time alerts.</p>
            </button>
            <div className="rounded-[18px] border border-[#23365e] bg-[#101a39] p-3 shadow-[0_12px_30px_-28px_rgba(2,6,23,0.84)]">
              <ListChecks className="h-4 w-4 text-[#89a9ff]" />
              <p className="mt-2 text-sm font-semibold text-white">{syncLabel}</p>
              <p className="mt-1 text-xs leading-5 text-[#9fb2db]">Status and reminders stored.</p>
            </div>
          </div>

          {noStudyToday || closeToModuleCompletion || missedTasks.length ? (
            <div className="rounded-[20px] border border-[#23365e] bg-[#101a39] p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#132659] text-[#89a9ff]">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="space-y-1.5 text-xs leading-5 text-[#9fb2db]">
                  {noStudyToday ? <p>You haven&apos;t studied today. Add a short session.</p> : null}
                  {closeToModuleCompletion ? <p>You&apos;re close to completing this module.</p> : null}
                  {missedTasks.length ? <p>{missedTasks.length} missed session{missedTasks.length === 1 ? "" : "s"} need rescheduling.</p> : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[720px] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-[28px] border border-[#dce2ff] bg-white p-0 text-slate-900 shadow-[0_34px_80px_-42px_rgba(37,99,235,0.38)] sm:w-full sm:rounded-[34px]">
          <div className="overflow-hidden rounded-[28px] sm:rounded-[34px]">
            <div className="bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_44%,#eef3ff_100%)] px-5 py-6 sm:px-8 sm:py-7">
              <DialogHeader>
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#1d4ed8]">
                  <NotebookPen className="h-3.5 w-3.5" />
                  Learning task
                </div>
                <DialogTitle className="mt-4 text-[1.9rem] font-semibold tracking-tight text-slate-950 sm:text-3xl">
                  {editingTaskId ? "Edit learning session" : "Add learning session"}
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm leading-7 text-slate-600">
                  Set course, time, duration, category, notes, and smart reminders.
                </DialogDescription>
              </DialogHeader>
            </div>

            <form onSubmit={handleTaskSubmit} className="space-y-5 px-5 py-5 sm:px-8 sm:py-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label htmlFor="learning-task-title" className="text-sm font-semibold text-slate-700">Learning task</label>
                  <div className="relative">
                    <Input
                      id="learning-task-title"
                      value={form.title}
                      onFocus={() => setTitleSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setTitleSearchOpen(false), 120)}
                      onChange={(event) => {
                        setTitleSearchOpen(true);
                        setForm((current) => ({ ...current, title: event.target.value }));
                      }}
                      placeholder="Complete Module 1"
                      autoComplete="off"
                      className={inputClassName}
                    />
                    {titleSearchOpen ? (
                      <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_48px_-28px_rgba(15,23,42,0.24)]">
                        <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Modules
                        </div>
                        <div className="max-h-[min(16rem,50dvh)] overflow-y-auto py-1">
                          {filteredTaskTitleOptions.length > 0 ? (
                            filteredTaskTitleOptions.map((taskTitle) => (
                              <button
                                key={taskTitle}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => selectLearningTaskTitle(taskTitle)}
                                className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-[#f8fbff] hover:text-slate-950"
                              >
                                <span>{taskTitle}</span>
                              </button>
                            ))
                          ) : (
                            <p className="px-4 py-3 text-sm leading-6 text-slate-500">
                              No module matches this search. You can still type a custom task.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs leading-5 text-slate-500">
                    Choose from Module 1 to Module 5, or type a custom learning task.
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="learning-task-course" className="text-sm font-semibold text-slate-700">Course / goal</label>
                  <div className="relative">
                    <Input
                      id="learning-task-course"
                      value={form.course}
                      onFocus={() => setCourseSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setCourseSearchOpen(false), 120)}
                      onChange={(event) => {
                        setCourseSearchOpen(true);
                        setForm((current) => ({ ...current, course: event.target.value }));
                      }}
                      placeholder="Search saved courses or type your goal"
                      autoComplete="off"
                      className={inputClassName}
                    />
                    {courseSearchOpen ? (
                      <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_48px_-28px_rgba(15,23,42,0.24)]">
                        <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Saved courses
                        </div>
                        <div className="max-h-[min(16rem,50dvh)] overflow-y-auto py-1">
                          {filteredCourseOptions.length > 0 ? (
                            filteredCourseOptions.map((course) => (
                              <button
                                key={course}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => selectSavedCourse(course)}
                                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-[#f8fbff] hover:text-slate-950"
                              >
                                <span className="line-clamp-2">{course}</span>
                                <span className="shrink-0 rounded-full bg-[#eef3ff] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">
                                  Saved
                                </span>
                              </button>
                            ))
                          ) : (
                            <p className="px-4 py-3 text-sm leading-6 text-slate-500">
                              No saved course matches this search. You can still type a custom goal.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs leading-5 text-slate-500">
                    {savedCourseOptions.length > 0
                      ? `Search ${savedCourseOptions.length} saved courses or type your own goal.`
                      : "Type a course name or a custom learning goal."}
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="learning-task-category" className="text-sm font-semibold text-slate-700">Category</label>
                  <select
                    id="learning-task-category"
                    value={form.category}
                    onChange={(event) => setForm((current) => ({ ...current, category: normalizeCategory(event.target.value) }))}
                    className={selectClassName}
                  >
                    {taskCategories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="learning-task-date" className="text-sm font-semibold text-slate-700">Date</label>
                  <Input
                    id="learning-task-date"
                    type="date"
                    value={form.date}
                    onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                    className={pickerInputClassName}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="learning-task-time" className="text-sm font-semibold text-slate-700">Time</label>
                  <Input
                    id="learning-task-time"
                    type="time"
                    value={form.startTime}
                    onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                    className={pickerInputClassName}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="learning-task-duration" className="text-sm font-semibold text-slate-700">Duration</label>
                  <select
                    id="learning-task-duration"
                    value={form.durationMinutes}
                    onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))}
                    className={selectClassName}
                  >
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="90">1.5 hours</option>
                    <option value="120">2 hours</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="learning-task-reminder" className="text-sm font-semibold text-slate-700">Reminder</label>
                  <select
                    id="learning-task-reminder"
                    value={form.reminderMode}
                    onChange={(event) => setForm((current) => ({ ...current, reminderMode: event.target.value as LearningTaskForm["reminderMode"] }))}
                    className={selectClassName}
                  >
                    <option value="15">15 min before</option>
                    <option value="60">1 hr before</option>
                    <option value="0">At exact time</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {form.reminderMode === "custom" ? (
                  <div className="space-y-2">
                    <label htmlFor="learning-task-custom-reminder" className="text-sm font-semibold text-slate-700">Custom minutes before</label>
                    <Input
                      id="learning-task-custom-reminder"
                      type="number"
                      min="0"
                      value={form.customReminderMinutes}
                      onChange={(event) => setForm((current) => ({ ...current, customReminderMinutes: event.target.value }))}
                      className={inputClassName}
                    />
                  </div>
                ) : null}

                <div className="space-y-2 sm:col-span-2">
                  <label htmlFor="learning-task-notes" className="text-sm font-semibold text-slate-700">Notes</label>
                  <Textarea
                    id="learning-task-notes"
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Add chapter notes, exam focus, or module target."
                    className={textareaClassName}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTaskDialogOpen(false)}
                  className="h-12 w-full rounded-2xl border-slate-200 bg-white px-6 text-slate-700 hover:bg-slate-50 sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="h-12 w-full rounded-2xl bg-[linear-gradient(135deg,#1539b6_0%,#1d4ed8_100%)] px-6 text-white shadow-[0_18px_34px_-24px_rgba(37,99,235,0.5)] hover:brightness-105 sm:w-auto"
                >
                  {editingTaskId ? "Save Changes" : "Add Learning Task"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default memo(SmartLearningCalendar);