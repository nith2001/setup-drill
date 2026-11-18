// Chart drawings. Anchors use chart time (seconds) so they survive timeframe switches.
export interface Pt { t: number; p: number }
export type Drawing =
  | { id: string; kind: 'hline'; price: number; color: string }
  | { id: string; kind: 'trend'; a: Pt; b: Pt; color: string }
  /** A box between two opposite corners (zones, ranges). */
  | { id: string; kind: 'rect'; a: Pt; b: Pt; color: string };
export type Tool = 'cursor' | 'trend' | 'hline' | 'rect';

let n = 0;
export const newId = () => `d${Date.now().toString(36)}${n++}`;
export const DRAW_COLOR = '#2962ff';
