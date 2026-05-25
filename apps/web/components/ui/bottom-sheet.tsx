"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

const BottomSheet = DialogPrimitive.Root;
const BottomSheetTrigger = DialogPrimitive.Trigger;
const BottomSheetClose = DialogPrimitive.Close;
const BottomSheetPortal = DialogPrimitive.Portal;

const BottomSheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px]",
      "data-[state=open]:animate-[overlay-fade-in_180ms_ease-out]",
      "data-[state=closed]:animate-[overlay-fade-out_140ms_ease-in]",
      className,
    )}
    style={style}
    {...props}
  />
));
BottomSheetOverlay.displayName = "BottomSheetOverlay";

interface BottomSheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Show a drag handle along the top edge. Defaults to true. */
  showHandle?: boolean;
  /** Optional accessible title (visually hidden if `srOnly`). */
  title?: string;
  /** Optional description for screen readers. */
  description?: string;
  /** Whether to add safe-area bottom padding. Defaults to true. */
  safeArea?: boolean;
  /** Hide internal padding so callers can manage layout fully. */
  unpadded?: boolean;
}

/**
 * Mobile bottom sheet that slides up from the bottom of the screen.
 *
 * Drag the handle (or anywhere on the header) downward to dismiss.
 * Built on top of Radix Dialog so it inherits focus trap + escape key behavior.
 */
const BottomSheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  BottomSheetContentProps
>(
  (
    {
      className,
      children,
      showHandle = true,
      title,
      description,
      safeArea = true,
      unpadded = false,
      ...props
    },
    ref,
  ) => {
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const [dragOffset, setDragOffset] = React.useState(0);
    const startYRef = React.useRef<number | null>(null);

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        contentRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [ref],
    );

    function handleTouchStart(e: React.TouchEvent) {
      startYRef.current = e.touches[0]?.clientY ?? null;
    }

    function handleTouchMove(e: React.TouchEvent) {
      if (startYRef.current == null) return;
      const y = e.touches[0]?.clientY ?? startYRef.current;
      const delta = Math.max(0, y - startYRef.current);
      setDragOffset(delta);
    }

    function handleTouchEnd() {
      if (startYRef.current == null) return;
      startYRef.current = null;
      const node = contentRef.current;
      const height = node?.getBoundingClientRect().height ?? 0;
      if (dragOffset > Math.max(80, height * 0.25)) {
        const closeBtn = node?.querySelector<HTMLButtonElement>(
          "[data-bottom-sheet-close]",
        );
        if (closeBtn) closeBtn.click();
      }
      setDragOffset(0);
    }

    return (
      <BottomSheetPortal>
        <BottomSheetOverlay />
        <DialogPrimitive.Content
          ref={setRefs}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col border-t border-stroke-default bg-card shadow-2xl outline-none",
            "data-[state=open]:animate-[sheet-slide-up_220ms_cubic-bezier(0.2,0,0,1)]",
            "data-[state=closed]:animate-[sheet-slide-down_180ms_ease-in]",
            className,
          )}
          style={{
            transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
            transition: startYRef.current == null ? "transform 180ms ease" : "none",
            paddingBottom: safeArea ? "var(--safe-area-bottom, 0px)" : undefined,
          }}
          {...props}
        >
          {/* Drag handle / dismiss area */}
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            className="flex shrink-0 cursor-grab touch-none select-none flex-col items-center pb-1 pt-2 active:cursor-grabbing"
            aria-hidden
          >
            {showHandle ? (
              <span className="h-1 w-10 rounded-full bg-text-tertiary/40" />
            ) : null}
          </div>

          {title ? (
            <DialogPrimitive.Title className="px-4 pb-2 text-sm font-semibold text-foreground">
              {title}
            </DialogPrimitive.Title>
          ) : (
            <DialogPrimitive.Title className="sr-only">
              {title ?? "Detail panel"}
            </DialogPrimitive.Title>
          )}
          {description ? (
            <DialogPrimitive.Description className="sr-only">
              {description}
            </DialogPrimitive.Description>
          ) : null}

          <DialogPrimitive.Close
            data-bottom-sheet-close
            aria-hidden
            tabIndex={-1}
            className="sr-only"
          />

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain",
              unpadded ? undefined : "px-4 pb-4",
            )}
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </BottomSheetPortal>
    );
  },
);
BottomSheetContent.displayName = "BottomSheetContent";

export {
  BottomSheet,
  BottomSheetTrigger,
  BottomSheetClose,
  BottomSheetPortal,
  BottomSheetOverlay,
  BottomSheetContent,
};
