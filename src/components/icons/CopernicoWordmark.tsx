import React from "react";

interface CopernicoWordmarkProps {
  height?: number | string;
  className?: string;
}

export const CopernicoWordmark: React.FC<CopernicoWordmarkProps> = ({
  height = 28,
  className = "",
}) => {
  return (
    <div
      className={`inline-flex items-center gap-2 select-none ${className}`}
      style={{ height }}
    >
      <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
        <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
      </div>
      <span className="font-semibold text-sm tracking-tight text-[var(--text-primary)]">
        Copernico
      </span>
    </div>
  );
};
