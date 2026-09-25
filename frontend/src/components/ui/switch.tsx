import type { ReactNode } from "react";

/** A labelled on/off row, iOS-proportioned (52x32 track, 28px thumb). The whole row is the tap target; a
 * native checkbox with `role="switch"` underneath keeps keyboard and screen-reader behaviour for free. */
export const Switch = ({
  label,
  hint,
  checked,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex min-h-12 cursor-pointer items-center gap-4">
    <span className="min-w-0 flex-1">
      <span className="block text-[15px] font-medium leading-snug">{label}</span>
      {hint && <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{hint}</span>}
    </span>
    <input
      type="checkbox"
      role="switch"
      className="peer sr-only"
      checked={checked}
      aria-checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span
      aria-hidden
      className={
        "relative h-8 w-13 shrink-0 rounded-full bg-muted shadow-[inset_0_0_0_1px_var(--border)] transition-colors duration-200 ease-out-strong " +
        "after:absolute after:left-0.5 after:top-0.5 after:size-7 after:rounded-full after:bg-card after:shadow-sm " +
        "after:transition-transform after:duration-200 after:ease-out-strong " +
        "peer-checked:bg-primary peer-checked:shadow-none peer-checked:after:translate-x-5 " +
        "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background " +
        "motion-reduce:transition-none motion-reduce:after:transition-none"
      }
    />
  </label>
);
