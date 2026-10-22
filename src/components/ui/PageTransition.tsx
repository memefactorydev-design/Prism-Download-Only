"use client";

import { usePathname } from "next/navigation";
import { motion } from "motion/react";

// Re-mounts + eases content in on each route change (enter-only — robust in the
// App Router). Respects reduced motion via the global CSS override.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
