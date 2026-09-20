import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const base =
  "inline-flex select-none items-center justify-center gap-1.5 rounded-md font-medium " +
  "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-45";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
  outline: "border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
  ghost: "bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  danger: "border border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
  icon: "h-8 w-8 p-0 text-sm",
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
