"use client";

import { useCallback, useRef, useState, useEffect } from "react";

interface UsePanelResizeOptions {
  direction: "horizontal";
  initialSize: number;
  minSize: number;
  maxSize: number;
  storageKey?: string;
  invertDrag?: boolean;
  size?: number;
  onSizeChange?: (size: number) => void;
}

export function usePanelResize({
  direction: _direction,
  initialSize,
  minSize,
  maxSize,
  storageKey,
  invertDrag = false,
  size: controlledSize,
  onSizeChange,
}: UsePanelResizeOptions) {
  const isControlled = controlledSize !== undefined && onSizeChange !== undefined;

  const [internalSize, setInternalSize] = useState(() => {
    if (isControlled) return controlledSize;
    if (storageKey && typeof window !== "undefined") {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minSize && parsed <= maxSize) return parsed;
      }
    }
    return initialSize;
  });

  const size = isControlled ? controlledSize : internalSize;

  const setSize = useCallback(
    (next: number | ((prev: number) => number)) => {
      const resolved = typeof next === "function" ? next(size) : next;
      const clamped = Math.max(minSize, Math.min(maxSize, resolved));
      if (isControlled) {
        onSizeChange(clamped);
      } else {
        setInternalSize(clamped);
      }
    },
    [isControlled, maxSize, minSize, onSizeChange, size],
  );

  const dragging = useRef(false);
  const startX = useRef(0);
  const startSize = useRef(0);

  useEffect(() => {
    if (isControlled || !storageKey || typeof window === "undefined") return;
    localStorage.setItem(storageKey, String(size));
  }, [size, storageKey, isControlled]);

  useEffect(() => {
    setSize((curr) => Math.min(curr, maxSize));
  }, [maxSize, setSize]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startSize.current = size;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [size],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const newSize = invertDrag
        ? startSize.current - delta
        : startSize.current + delta;
      setSize(newSize);
    },
    [invertDrag, setSize],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    style: { cursor: "col-resize", touchAction: "none" } as const,
  };

  return { size, setSize, handleProps, isDragging: dragging.current };
}
