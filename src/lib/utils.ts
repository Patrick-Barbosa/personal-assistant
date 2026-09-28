/**
 * Utility functions for the Copernico design system.
 * cn() merges Tailwind classes safely using clsx + tailwind-merge.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
