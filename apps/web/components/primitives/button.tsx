"use client";

import React from "react";

const variantStyles = {
  primary:
    "bg-accent text-white hover:bg-accent/70 active:bg-accent/60 focus-visible:ring-accent/50",
  secondary:
    "bg-surface-2 text-text-primary hover:bg-surface-2/70 active:bg-surface-2/60 border border-stroke-default focus-visible:ring-surface-3/50",
  ghost:
    "bg-transparent text-text-secondary hover:bg-surface-1/70 hover:text-text-primary active:bg-surface-2/60 focus-visible:ring-surface-3/50",
  danger:
    "bg-danger text-white hover:bg-danger/70 active:bg-danger/60 focus-visible:ring-danger/50",
} as const;

const sizeStyles = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-base gap-2.5",
} as const;

type ButtonVariant = keyof typeof variantStyles;
type ButtonSize = keyof typeof sizeStyles;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
}

function Slot({
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  if (React.isValidElement<Record<string, unknown>>(children)) {
    const childProps = children.props as Record<string, unknown>;
    return React.cloneElement(children, {
      ...props,
      ...childProps,
      className: cn(props.className as string, childProps.className as string),
    } as Record<string, unknown>);
  }
  return <span {...props}>{children}</span>;
}

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-colors duration-(--of-duration-instant) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

    const combinedClassName = cn(
      baseStyles,
      variantStyles[variant],
      sizeStyles[size],
      className
    );

    if (asChild) {
      return (
        <Slot className={combinedClassName} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        className={combinedClassName}
        disabled={isDisabled}
        {...props}
      >
        {loading && (
          <span className="inline-flex animate-spin">
            <svg
              className="h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </span>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
