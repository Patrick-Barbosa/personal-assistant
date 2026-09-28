import React from "react";

interface CopernicoSquircleProps {
  size?: number | string;
  className?: string;
  strokeColor?: string;
}

export const CopernicoSquircle: React.FC<CopernicoSquircleProps> = ({
  size = 44,
  className = "",
  strokeColor = "#f59e0b",
}) => {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`select-none shrink-0 ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="2"
        y="2"
        width="44"
        height="44"
        rx="12"
        className="fill-zinc-900/90 stroke-zinc-800"
        strokeWidth="1.5"
      />
      {/* Orbital ellipse */}
      <ellipse
        cx="24"
        cy="24"
        rx="14"
        ry="6"
        transform="rotate(-25 24 24)"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeOpacity="0.4"
        strokeDasharray="2 2"
      />
      {/* Central Star (Sun) */}
      <circle
        cx="24"
        cy="24"
        r="6"
        fill={strokeColor}
        fillOpacity="0.9"
      />
      <circle
        cx="24"
        cy="24"
        r="9"
        stroke={strokeColor}
        strokeWidth="1"
        strokeOpacity="0.3"
      />
      {/* Planet on orbit */}
      <circle
        cx="33"
        cy="19"
        r="2"
        fill={strokeColor}
      />
    </svg>
  );
};
