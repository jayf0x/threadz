import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const base =
  "press inline-flex select-none items-center justify-center gap-1.5 rounded-full text-[15px] font-medium md:text-sm " +
  "outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-45";

const variants: Record<Variant, string> = {
  primary: "bg-primary-sheen font-semibold text-primary-foreground shadow-md hover:brightness-105",
  secondary: "bg-secondary text-secondary-foreground ring-1 ring-inset ring-border hover:bg-accent",
  outline: "border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
  ghost: "bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  danger: "border border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10",
};

// 44px hit areas on a phone (HIG), the compact desktop sizes from `md`.
const sizes: Record<Size, string> = {
  sm: "h-10 px-4 md:h-8",
  md: "h-11 px-5 md:h-9",
  icon: "size-11 p-0 md:size-9",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} {...props} />
  ),
);
Button.displayName = "Button";
