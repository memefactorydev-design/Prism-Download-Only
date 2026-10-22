"use client";

import { motion, useReducedMotion } from "motion/react";
import { BRAND, PRODUCT } from "@/lib/brand";

/**
 * The Prism mark: a triangle whose stroke cycles the full spectrum — teal up
 * the left into red at the apex, falling through orange and rose to violet,
 * closing along the base through indigo back to teal. Recreated per-edge as
 * three gradient strokes (one linear gradient can't cycle). Matches the master
 * logo artwork; the UI otherwise spends the restrained 4-stop brand gradient.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      className="inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      whileHover={reduce ? {} : { scale: 1.08, rotate: 2 }}
      transition={{ type: "spring", stiffness: 300, damping: 18 }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} fill="none" aria-hidden>
        <defs>
          <linearGradient id="prismL" x1="14" y1="84" x2="50" y2="10" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2BD9A9" />
            <stop offset="0.38" stopColor="#4C6FFF" />
            <stop offset="0.75" stopColor="#FF4E8E" />
            <stop offset="1" stopColor="#FF3D2E" />
          </linearGradient>
          <linearGradient id="prismR" x1="50" y1="10" x2="86" y2="84" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FF5A2E" />
            <stop offset="0.35" stopColor="#FF9E5A" />
            <stop offset="0.68" stopColor="#FF4E8E" />
            <stop offset="1" stopColor="#C43BFF" />
          </linearGradient>
          <linearGradient id="prismB" x1="86" y1="84" x2="14" y2="84" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#C43BFF" />
            <stop offset="0.45" stopColor="#6D5AF7" />
            <stop offset="0.72" stopColor="#4C6FFF" />
            <stop offset="1" stopColor="#2BD9A9" />
          </linearGradient>
        </defs>
        <path d="M14 84 L50 10" stroke="url(#prismL)" strokeWidth="8" strokeLinecap="round" />
        <path d="M50 10 L86 84" stroke="url(#prismR)" strokeWidth="8" strokeLinecap="round" />
        <path d="M86 84 L14 84" stroke="url(#prismB)" strokeWidth="8" strokeLinecap="round" />
      </svg>
    </motion.span>
  );
}

export function Logo({
  size = 32,
  showWordmark = true,
  showProduct = true,
}: {
  size?: number;
  showWordmark?: boolean;
  showProduct?: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      {showWordmark && (
        <span className="flex items-baseline gap-1.5">
          <span className="font-display text-[17px] font-extrabold tracking-[-0.04em] text-foreground">{BRAND}</span>
          {showProduct && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">{PRODUCT}</span>
          )}
        </span>
      )}
    </span>
  );
}
