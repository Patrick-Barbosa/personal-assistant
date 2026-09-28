import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default:
    "bg-amber-500 text-zinc-950 font-medium hover:bg-amber-400 active:bg-amber-600 shadow-sm shadow-amber-500/20",
  destructive:
    "bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 active:bg-red-500/30",
  outline:
    "border border-[var(--border-subtle)]/60 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/60 hover:text-[var(--text-primary)] active:bg-[var(--bg-elevated)]",
  secondary:
    "bg-[var(--bg-elevated)]/70 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] active:bg-[var(--bg-elevated)]/60 border border-[var(--border-subtle)]/40",
  ghost:
    "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/50 active:bg-[var(--bg-elevated)]",
  link: "text-amber-400 underline-offset-4 hover:underline hover:text-amber-300 p-0 h-auto",
};

const sizeStyles: Record<NonNullable<ButtonProps["size"]>, string> = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 px-3 text-xs rounded-lg",
  lg: "h-10 px-6 text-sm rounded-xl",
  icon: "h-8 w-8 p-0 rounded-lg",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50 disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none",
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
