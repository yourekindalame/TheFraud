import React, { useEffect, useMemo, useRef, useState } from "react";

export function HoldButton({
  seconds = 5,
  className,
  children,
  onConfirm,
  disabled
}: {
  seconds?: number;
  className?: string;
  children: React.ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const durationMs = seconds * 1000;
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const pct = useMemo(() => Math.max(0, Math.min(100, progress * 100)), [progress]);

  const stop = () => {
    setHolding(false);
    setProgress(0);
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  const tick = (t: number) => {
    if (!startRef.current) startRef.current = t;
    const elapsed = t - startRef.current;
    const p = Math.min(1, elapsed / durationMs);
    setProgress(p);
    if (p >= 1) {
      stop();
      onConfirm();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const begin = () => {
    if (disabled) return;
    setHolding(true);
    setProgress(0);
    startRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <div>
      <button
        className={className || "btn"}
        onMouseDown={begin}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={begin}
        onTouchEnd={stop}
        disabled={disabled}
      >
        {children}
      </button>
      {holding && (
        <div style={{ marginTop: 8 }}>
          <div className="holdBar" aria-hidden="true">
            <div className="holdFill" style={{ width: `${pct}%` }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Keep holding…
          </div>
        </div>
      )}
    </div>
  );
}

