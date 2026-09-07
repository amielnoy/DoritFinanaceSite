import React from "react";

const VALUES = ["מקצועית", "יושר", "אנושיות"];

export default function BrandStatement() {
  return (
    <section className="relative py-20 md:py-28 border-b border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 text-center">
        <p className="text-[11px] tracking-[0.35em] uppercase text-accent mb-8">
          דורית גוב ארי
        </p>
        <h2 className="font-heading text-3xl md:text-5xl leading-tight max-w-3xl mx-auto text-balance">
          כש
          <span className="text-accent">מקצועית</span>
          <span className="text-muted-foreground mx-2">,</span>
          <span className="text-accent">יושר</span>
          <span className="text-muted-foreground mx-2">ו</span>
          <span className="text-accent">אנושיות</span>
          <br />
          נפגשים
        </h2>

        <div className="mt-12 flex items-center justify-center gap-4 md:gap-10">
          {VALUES.map((v, i) => (
            <React.Fragment key={v}>
              <span className="font-heading text-lg md:text-2xl text-foreground/85">
                {v}
              </span>
              {i < VALUES.length - 1 && (
                <span className="w-10 md:w-16 h-px bg-[#C4A484]" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}