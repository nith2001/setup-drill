import type { Preset } from '../core/overlays';
import type { Day, Eval } from '../core/types';

/** User settings that rules can depend on. */
export interface SetupOpts {
  orMin: number;
  /** Candle size the rules run on (1 or 5 minutes). */
  barMin?: number;
  /** Look for the next event starting at this bar (several events per day). */
  from?: number;
  /** The day's 4-hour bias (set by evaluateAll), for setups that only look in its direction. */
  bias?: import('../core/bias').Bias | null;
}

/**
 * Everything about one setup drill. To add a setup: create a file exporting one of these
 * and add it to the list in ./index.ts.
 */
export interface SetupDef {
  id: string;
  group: 'Price action' | 'Support & resistance' | 'Indicators';
  label: string;
  blurb: string;
  /** Rule text shown during the rep (HTML allowed). */
  rule: (o: SetupOpts) => string;
  /** null = the day lacks the context for this drill; otherwise valid or no-trade. */
  evaluate: (day: Day, o: SetupOpts) => Eval | null;
  /** The indicators this drill shows (exactly these; the user can change them per setup). */
  preset: Preset;
  /** How strict the bias check is (default strict: month and week agree). */
  biasMode?: import('../core/bias').BiasMode;
  /** trend (default): needs an up/down bias. range: also trades both ways on a sideways bias. */
  style?: import('../core/bias').SetupStyle;
  /** Once-a-day setups tied to the open (no quiet mid-day charts for these). */
  openOnly?: boolean;
}

/** Candles after the rule deadline that stay in the rep. */
export const GRACE = 5;
/** Minimum relative volume for volume-confirmed triggers. */
export const RV_MIN = 1.5;
