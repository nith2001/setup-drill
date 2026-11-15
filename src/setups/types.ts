import type { Preset } from '../core/overlays';
import type { Day, Eval } from '../core/types';

/** User settings that rules can depend on. */
export interface SetupOpts { orMin: number }

/**
 * Everything about one setup drill. To add a setup: create a file exporting one of these
 * and add it to the list in ./index.ts.
 */
export interface SetupDef {
  id: string;
  group: 'Price action' | 'Indicators';
  label: string;
  blurb: string;
  /** Rule text shown during the rep (HTML allowed). */
  rule: (o: SetupOpts) => string;
  /** null = the day lacks the context for this drill; otherwise valid or no-trade. */
  evaluate: (day: Day, o: SetupOpts) => Eval | null;
  /** Indicator drills: indicators switched on when the rep starts (on top of the user's own). Also hides opening-range lines. */
  preset?: Preset;
}

/** Bars after the rule deadline that stay in the rep. */
export const GRACE = 5;
/** Minimum relative volume for volume-confirmed triggers. */
export const RV_MIN = 1.5;
