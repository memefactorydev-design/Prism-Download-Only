"use client";

import { motion } from "motion/react";

// Small entrance animation. Pass an index for a staggered cascade in grids/lists.
export function Reveal({
  children,
  i = 0,
  className,
}: {
  children: React.ReactNode;
  i?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: Math.min(i * 0.05, 0.4) }}
    >
      {children}
    </motion.div>
  );
}
