import type { LucideIcon } from "lucide-react";

interface SectionTitleProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}

const toneForTitle = (title: string) => {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("owner") || normalizedTitle.includes("address") || normalizedTitle.includes("contact")) {
    return "blue";
  }
  if (normalizedTitle.includes("personal") || normalizedTitle.includes("business") || normalizedTitle.includes("profile")) {
    return "green";
  }
  if (normalizedTitle.includes("kyc") || normalizedTitle.includes("identity") || normalizedTitle.includes("review")) {
    return "purple";
  }
  if (normalizedTitle.includes("loan") || normalizedTitle.includes("finance") || normalizedTitle.includes("capital")) {
    return "amber";
  }
  return "teal";
};

const toneClasses = {
  blue: "border-blue-100 bg-blue-50/80 text-blue-700",
  green: "border-emerald-100 bg-emerald-50/80 text-emerald-700",
  purple: "border-violet-100 bg-violet-50/80 text-violet-700",
  amber: "border-amber-100 bg-amber-50/80 text-amber-700",
  teal: "border-teal-100 bg-teal-50/80 text-teal-700",
} as const;

const iconToneClasses = {
  blue: "bg-blue-600 text-white shadow-sm",
  green: "bg-emerald-600 text-white shadow-sm",
  purple: "bg-violet-600 text-white shadow-sm",
  amber: "bg-amber-500 text-white shadow-sm",
  teal: "bg-teal-600 text-white shadow-sm",
} as const;

const SectionTitle = ({ icon: Icon, title, subtitle }: SectionTitleProps) => {
  const tone = toneForTitle(title);

  return (
    <div className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 sm:gap-4 sm:px-4 ${toneClasses[tone]}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.75rem] sm:h-11 sm:w-11 ${iconToneClasses[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h3 className="text-[1.05rem] font-bold leading-tight text-slate-900 sm:text-lg">{title}</h3>
        <p className="mt-1 text-sm leading-5 text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
};

export default SectionTitle;
