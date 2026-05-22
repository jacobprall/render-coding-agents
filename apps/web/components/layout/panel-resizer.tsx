"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

interface PanelResizerHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  style?: React.CSSProperties;
}

interface PanelResizerProps extends Omit<ComponentPropsWithoutRef<"div">, "style"> {
  handleProps: PanelResizerHandleProps;
}

export function PanelResizer({ handleProps, className, ...props }: PanelResizerProps) {
  const { style, ...restHandleProps } = handleProps;

  return (
    <div
      {...restHandleProps}
      {...props}
      style={style}
      className={cn(
        "group relative z-10 w-1 shrink-0 touch-none hover:w-2",
        className,
      )}
      role="separator"
      aria-orientation="vertical"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-border" />
    </div>
  );
}
