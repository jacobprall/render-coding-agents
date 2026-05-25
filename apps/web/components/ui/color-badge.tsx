import * as React from "react";
import { cn } from "@/lib/utils";

const variantStyles = {
  success: "bg-green-500/15 text-green-500 border-green-500/25",
  failure: "bg-destructive/15 text-destructive border-destructive/25",
  pending: "bg-yellow-500/15 text-yellow-600 border-yellow-500/25",
  info: "bg-blue-500/15 text-blue-500 border-blue-500/25",
  neutral: "bg-zinc-500/15 text-muted-foreground border-border",
} as const;

const dotStyles = {
  success: "bg-green-500",
  failure: "bg-destructive",
  pending: "bg-yellow-500",
  info: "bg-blue-500",
  neutral: "bg-muted-foreground",
} as const;

type ColorBadgeVariant = keyof typeof variantStyles;

export interface ColorBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: ColorBadgeVariant;
  dot?: boolean;
}

export const ColorBadge = React.forwardRef<HTMLSpanElement, ColorBadgeProps>(
  ({ variant = "neutral", dot = false, className, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
          variantStyles[variant],
          className,
        )}
        {...props}
      >
        {dot && (
          <span
            className={cn("h-1.5 w-1.5 rounded-full", dotStyles[variant])}
          />
        )}
        {children}
      </span>
    );
  },
);

ColorBadge.displayName = "ColorBadge";
