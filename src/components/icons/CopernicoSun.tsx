import React from "react";

interface CopernicoSunProps {
  size?: number | string;
  volume?: number; // 0.0 to 1.0 (for acoustic petal blooming)
  className?: string;
  strokeColor?: string;
}

export const CopernicoSun: React.FC<CopernicoSunProps> = ({
  size = 44,
  volume = 0,
  className = "",
  strokeColor = "#f59e0b",
}) => {
  const clampedVol = Math.max(0, Math.min(1, volume));
  const bloomDistance = clampedVol * 6; // Radial blooming offset in pixels

  // 12 rays around a 360 circle (every 30 degrees)
  const rayAngles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`select-none shrink-0 ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer ambient glow ring */}
      <circle
        cx="32"
        cy="32"
        r={14 + clampedVol * 4}
        stroke={strokeColor}
        strokeWidth="1"
        strokeOpacity={0.25 + clampedVol * 0.4}
        className="transition-all duration-150 ease-out"
      />

      {/* 12 dynamic geometric rays */}
      {rayAngles.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const innerR = 17 + bloomDistance;
        const outerR = 23 + bloomDistance * 1.5;
        const x1 = 32 + innerR * Math.cos(rad);
        const y1 = 32 + innerR * Math.sin(rad);
        const x2 = 32 + outerR * Math.cos(rad);
        const y2 = 32 + outerR * Math.sin(rad);

        return (
          <line
            key={angle}
            x1={x1.toFixed(2)}
            y1={y1.toFixed(2)}
            x2={x2.toFixed(2)}
            y2={y2.toFixed(2)}
            stroke={strokeColor}
            strokeWidth={angle % 60 === 0 ? "2" : "1.2"}
            strokeLinecap="round"
            strokeOpacity={0.6 + clampedVol * 0.4}
            className="transition-all duration-150 ease-out"
          />
        );
      })}

      {/* Central Core (Heliocentric star) */}
      <circle
        cx="32"
        cy="32"
        r={9 + clampedVol * 2}
        fill={strokeColor}
        fillOpacity={0.9}
        className="transition-all duration-150 ease-out"
      />
      <circle
        cx="32"
        cy="32"
        r={6}
        fill="#ffffff"
        fillOpacity={0.8}
      />
    </svg>
  );
};
