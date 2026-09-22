import type { RequirementCategory } from "@/core/kit/types";

/** Consistent per-category colours across the whole kit UI. */
const CATEGORY_STYLES: Record<RequirementCategory, string> = {
  technical: "bg-sky-50 text-sky-700 ring-sky-200",
  behavioural: "bg-rose-50 text-rose-700 ring-rose-200",
  system_design: "bg-violet-50 text-violet-700 ring-violet-200",
  domain: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  process: "bg-amber-50 text-amber-700 ring-amber-200",
};

export function CategoryBadge({ category }: { category: string }) {
  const style =
    CATEGORY_STYLES[category as RequirementCategory] ??
    "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {category.replace("_", " ")}
    </span>
  );
}
