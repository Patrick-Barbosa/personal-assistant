import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "amber" | "emerald";
}

const badgeVariants: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)]/50",
  secondary: "bg-[var(--bg-elevated)]/50 text-[var(--text-muted)] border-transparent",
  destructive: "bg-red-500/15 text-red-400 border-red-500/20",
  outline: "border-zinc-700 text-zinc-300 bg-transparent",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors select-none",
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}
