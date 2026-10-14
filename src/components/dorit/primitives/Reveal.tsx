import React, { type ReactNode } from "react";
import { motion } from "framer-motion";

interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

/**
 * A short fade as a block scrolls in. It was 0.7 s from 24 px below, starting
 * 80 px inside the viewport: on a fast phone scroll whole screens showed empty
 * and headings sat faded until it ended (user feedback, 2026-10-14). Now 0.2 s
 * from 8 px, starting as the block enters, and a stagger never waits past 0.1 s.
 */
export const REVEAL_DURATION_S = 0.2;
const MAX_DELAY_S = 0.1;

export default function Reveal({ children, delay = 0, className = "" }: RevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px" }}
      transition={{ duration: REVEAL_DURATION_S, delay: Math.min(delay, MAX_DELAY_S), ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
