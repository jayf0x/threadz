import { useState } from "react";
import { cn } from "@/lib/cn";

export type Theme = "light" | "system" | "dark";

declare global {
  interface Window {
    /** Defined inline in index.html so the theme paints before first paint.
     * Single writer for the root class + localStorage — React only calls it. */
    _setTheme: (theme: Theme | null) => void;
  }
}

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

/** Three-way light / system / dark toggle. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(read);

  return (
    <fieldset className={cn("flex gap-px border border-border p-px", className)}>
      <legend className="sr-only">Colour scheme</legend>
      {OPTIONS.map(({ value, label, path }) => {
        const active = theme === value;
        return (
          <label
            key={value}
            title={label}
            className={cn(
              "flex cursor-pointer items-center p-1.5 transition-colors has-focus-visible:outline",
              "has-focus-visible:outline-ring",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={active}
              onChange={() => {
                window._setTheme(value);
                setTheme(value);
              }}
              className="sr-only"
            />
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              role="img"
              aria-label={label}
            >
              <path d={path} />
            </svg>
            <span className="sr-only">{label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
