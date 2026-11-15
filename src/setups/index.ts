import { prepDay } from '../core/day';
import type { Day, Eval } from '../core/types';
import { ema } from './ema';
import { gap } from './gap';
import { macd } from './macd';
import { orb } from './orb';
import { rsi } from './rsi';
import type { SetupDef, SetupOpts } from './types';
import { vwap } from './vwap';

export type { SetupDef, SetupOpts } from './types';

/** Registry: add new setups here. Order = order on the home screen. */
export const SETUPS: SetupDef[] = [orb, gap, vwap, ema, macd, rsi];

export const SETUP_BY_ID: Record<string, SetupDef> = Object.fromEntries(SETUPS.map((s) => [s.id, s]));

/** Free play is a rep mode with no rule. */
export const FREE_PLAY = { id: 'random', label: 'Free play', blurb: 'Any day, no rules. Scored on P&L and trade management.' } as const;

export function evaluate(id: string, day: Day, opts: SetupOpts = { orMin: 15 }): Eval | null {
  const s = SETUP_BY_ID[id];
  if (!s) return null;
  prepDay(day);
  return s.evaluate(day, opts);
}
