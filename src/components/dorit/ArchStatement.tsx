import React from "react";

const COLS: number[] = [160, 320, 480];

export default function ArchStatement() {
  return (
    <div className="relative w-full animate-fade-up">
      <div className="relative border border-[#D3C6B9]/60 overflow-hidden bg-[#F7F4F1]">
        {/* Graph paper grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(125,107,93,0.13) 1px, transparent 1px), linear-gradient(to bottom, rgba(125,107,93,0.13) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        {/* Architectural columns + arches */}
        <svg
          viewBox="0 0 640 360"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ opacity: 0.5 }}
        >
          <g stroke="#7D6B5D" strokeWidth="1.5" fill="none">
            <line x1="60" y1="312" x2="580" y2="312" />
            {COLS.map((cx) => (
              <g key={cx}>
                <rect x={cx - 16} y="110" width="32" height="190" />
                <line x1={cx - 8} y1="120" x2={cx - 8} y2="294" strokeWidth="0.6" />
                <line x1={cx} y1="120" x2={cx} y2="294" strokeWidth="0.6" />
                <line x1={cx + 8} y1="120" x2={cx + 8} y2="294" strokeWidth="0.6" />
                <rect x={cx - 24} y="300" width="48" height="12" />
                <rect x={cx - 24} y="96" width="48" height="14" />
              </g>
            ))}
            <path d="M184,96 A56,56 0 0 1 296,96" />
            <path d="M344,96 A56,56 0 0 1 456,96" />
          </g>
        </svg>
        {/* Statement */}
        <h1 className="relative z-10 text-center py-12 md:py-20 px-6">
          <span className="block font-heading text-[7.5vw] md:text-[4.25rem] leading-[1.1] font-bold text-foreground">
            מקצועיות, יושר
          </span>
          <div className="mx-auto my-5 h-[3px] w-36 md:w-52 bg-[#9C836A]" />
          <span className="block font-heading text-[7.5vw] md:text-[4.25rem] leading-[1.1] font-bold text-foreground">
            ואנושיות נפגשים
          </span>
        </h1>
      </div>
    </div>
  );
}