import { useState } from "react";
import { cn } from "@/lib/cn";

export type Theme = "light" | "system" | "dark";

const read = (): Theme => {
  const c = document.documentElement.classList;
  return c.contains("dark") ? "dark" : c.contains("light") ? "light" : "system";
};

const OPTIONS: { value: Theme; label: string; path: string }[] = [
  {
    value: "light",
    label: "Light",
    path: "M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1v2M8 13v2M3 3l1.4 1.4M11.6 11.6L13 13M1 8h2M13 8h2M3 13l1.4-1.4M11.6 4.4L13 3",
  },
  { value: "system", label: "System", path: "M2 3h12v8H2zM6 14h4M8 11v3" },
  {
    value: "dark",
    label: "Dark",
    path: "M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 100 11c2.3 0 4.3-1.4 5.2-3.4a5.6 5.6 0 001.3-1.1z",
  },
];

/** Three-way light / system / dark toggle: a pill track with a thumb that slides to the choice. */
export const ThemeToggle = ({ className }: { className?: string }) => {
  const [theme, setTheme] = useState<Theme>(read);
  const index = OPTIONS.findIndex((o) => o.value === theme);

  return (
    <fieldset
      className={cn(
        "relative grid w-fit grid-cols-3 rounded-full bg-muted p-1 shadow-[inset_0_0_0_1px_var(--border)]",
        className,
      )}
    >
      <legend className="sr-only">Colour scheme</legend>
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-card shadow-sm transition-transform duration-200 ease-out-strong motion-reduce:transition-none"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map(({ value, label, path }) => (
        <label
          key={value}
          title={label}
          className={cn(
            "press relative grid h-11 w-16 cursor-pointer place-items-center rounded-full text-foreground md:h-9 md:w-12",
            "has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-ring",
            theme !== value && "text-muted-foreground hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name="theme"
            value={value}
            checked={theme === value}
            onChange={() => {
              window._setTheme(value);
              setTheme(value);
            }}
            className="sr-only"
          />
          <svg
            className="size-5 md:size-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            role="img"
            aria-label={label}
          >
            <path d={path} />
          </svg>
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
};
