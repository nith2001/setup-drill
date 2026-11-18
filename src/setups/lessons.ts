// Teaching content for each setup: shown in the guided tutorial and the "How to trade it" box.
// `steps` explains each labelled point (keyed by the mark text the setup's evaluator emits).

export interface Lesson {
  /** What the setup is and why it tends to work. */
  idea: string;
  /** Checklist of what has to be true. */
  look: string[];
  /** Explanation for each labelled point on the chart, keyed by mark text. */
  steps: Record<string, string>;
  entry: string;
  stop: string;
  /** Where profit is taken and why. */
  target: string;
  manage: string;
  mistakes: string[];
}

export const LESSONS: Record<string, Lesson> = {
  orbBreak: {
    idea: 'The first 15 minutes set a range while buyers and sellers fight over the overnight news. When price finally closes outside it with conviction, in the direction of your bias and on real volume, one side has won and the move often runs. The breakout candle itself is the trigger, which catches the strong moves that never come back for a retest.',
    look: ['Your bias from the 4-hour chart', 'A clear opening range (the blue OR lines)', 'The first candle that closes outside it, in the bias direction', 'A strong candle: big body, closing near its high (or a bullish engulfing)', 'Volume at least normal for that time of day (vs the same minutes on recent days)'],
    steps: {
      'range set': 'The opening range is set: the high and low of the first 15 minutes. Inside it, do nothing. Wait for a close outside.',
      breakout: 'The breakout candle. Judge it: did it close outside the range with a big body near its high, on real volume, with your bias? If yes, it\'s the trigger. A small body or a long wick back toward the range is a weak breakout: pass.',
    },
    entry: 'Enter at the close of the breakout candle, if it\'s strong, on volume, and with your bias.',
    stop: 'Below the breakout candle (above it for shorts).',
    target: 'Fixed 2R. The breakout leaves open space; the range height projected from the edge is a common alternative.',
    manage: 'If a candle closes back inside the range, the breakout failed: get out. Otherwise take part at 1R to 2R or trail under higher lows.',
    mistakes: ['Taking a breakout against your bias', 'Buying a weak, wicky breakout candle', 'Buying a wick above the range that closes back inside', 'Entering late, several candles after the breakout'],
  },
  orb: {
    idea: 'The first 15 minutes set a range while buyers and sellers fight over the overnight news. A breakout can easily reverse, so instead of chasing it you wait for price to come back to the edge of the range. If the old ceiling now holds as a floor and a reversal candle prints there, the breakout is real.',
    look: ['A clear opening range (the blue OR lines)', 'A breakout: a candle closes outside it on strong volume', 'Price pushes on, then pulls back to the range edge', 'The edge holds: no close back inside the range', 'The trigger: a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high) at the edge'],
    steps: {
      'range set': 'The opening range is now set: the high and low of the first 15 minutes. Mark them and wait. Trading inside the range is a coin flip.',
      breakout: 'The breakout. Don\'t chase it: many breakouts reverse. Wait for price to come back to the range edge.',
      retest: 'The retest: price is back at the range edge. If it holds and a reversal candle prints here, that\'s the trigger. A close back inside the range means the breakout failed.',
    },
    entry: 'Enter at the close of the trigger candle (a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)) within 3 candles of the retest.',
    stop: 'Below the retest low (for longs). If price closes back inside the range, you\'re wrong.',
    target: 'Fixed 2R. The breakout leaves open space; the opening range\'s height projected from the edge is a common alternative.',
    manage: 'Take part at 1R to 2R, or trail the stop under each new higher low. A close back inside the range means get out.',
    mistakes: ['Chasing the breakout candle instead of waiting for the retest', 'Buying a retest that closes back inside the range (failed breakout)', 'Entering at the edge before a reversal candle prints'],
  },
  gap: {
    idea: 'A stock that opens far from yesterday\'s close has news behind it. If buyers (for a gap up) keep pushing right from the open, the gap tends to extend. If they don\'t, gaps often fill back toward the prior close.',
    look: ['A gap of at least 1.5% from the prior close', 'A candle that closes beyond the first 5 minutes\' high (gap up) or low (gap down) by 10:05', 'Price on the right side of VWAP: above it for gap ups'],
    steps: { 'first 5 min': 'This is the first 5-minute range. For a gap up, its high is the line in the sand. Price needs to close above it while staying above VWAP.' },
    entry: 'Enter on the close of the candle that breaks the 5-minute level on the right side of VWAP.',
    stop: 'Below the trigger candle; the other side of the 5-minute range is the widest it should be.',
    target: 'Fixed 2R. Gap moves are fast, so a fixed target keeps it simple.',
    manage: 'Gap moves are fast. Many traders take profit quickly or trail tightly, because if it stalls, the gap can fill fast.',
    mistakes: ['Chasing a gap that\'s already fading below VWAP', 'Trading it after 10:05, when the opening energy is gone', 'Ignoring where the prior day\'s high is; it can act as resistance'],
  },
  vwap: {
    idea: 'VWAP is the average price everyone paid today, so big traders treat it as fair value. In a trend, price pulls back to VWAP and bounces. Once VWAP has held one pullback, the next test is a lower-risk entry, triggered by a reversal candle at VWAP.',
    look: ['Price on one side of VWAP for 30+ minutes', 'Touch 1: a pullback to VWAP that bounces clearly (VWAP is respected)', 'Touch 2: price comes back, and the test candle closes back on the right side', 'The trigger: a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)'],
    steps: {
      'touch 1': 'Touch 1: price pulled back to VWAP. Watch whether it bounces. If it pushes clearly away without closing through, VWAP is being respected.',
      'touch 2': 'Touch 2: the retest. VWAP held last time. Now wait for a reversal candle (engulfing or hammer) here.',
    },
    entry: 'Enter at the close of the trigger candle (a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)) within 3 candles of touch 2.',
    stop: 'Beyond the test candle (below its low for longs). If price closes clearly through VWAP, you\'re wrong.',
    target: 'Fixed 2R. In a trend there is no obvious level ahead, so you aim for a multiple of your risk.',
    manage: 'Many traders take part at 2R and trail the rest under each higher low. A close through VWAP means get out.',
    mistakes: ['Buying the first touch before VWAP has proven it holds', 'Buying at VWAP before a reversal candle prints', 'Trading VWAP bounces on a choppy day where price crosses VWAP every few candles'],
  },
  trend123: {
    idea: 'Bias first, then the pattern, then the trigger. Your bias comes from the 4-hour chart: the trend over the past month and week. With a long bias you only look for 1-2-3 lows: a swing low, a swing high, and a higher low. The higher low (3) shows buyers stepping in earlier than before, and a strong candle breaking 2 is the trigger.',
    look: ['Bias: on the 4-hour chart the past month and the past week are both trending up', '1: a swing low', '2: a swing high clearly above 1', '3: a real pullback (several candles) to a swing low that holds above 1 (a higher low)', '4: a trigger candle closes above 2: a bullish engulfing candle, a hammer, or a strong bullish candle (big body, closing near its high)'],
    steps: {
      '1': 'Point 1: a swing low. Price stopped falling here and turned up.',
      '2': 'Point 2: the swing high after 1. Draw a horizontal line here; this is the level you want price to break later.',
      '3': 'Point 3: the pullback low. It held above point 1, so this is a higher low. Buyers stepped in earlier than last time. (You only know it\'s the low once price turns back up.)',
      '4': 'Point 4: the break of 2.',
    },
    entry: 'Enter when a trigger candle (bullish engulfing, hammer, or a strong bullish candle) closes above point 2 (point 4), in the direction of your bias. A weak, wicky close above 2 isn\'t enough: wait up to 3 candles for a trigger candle, then let it go.',
    stop: 'Below point 3. If price goes below 3, the pattern is broken.',
    target: 'Fixed 2R. With the bias behind it, price is heading for new highs. A measured move (the 1→2 leg projected from 3) is often closer than 2R after a deep pullback, so use it for partial profit, not the main target.',
    manage: 'Measure the 1→2 move; a common target is the same distance projected from 3, or 2R. Trail the stop under new higher lows.',
    mistakes: ['Taking a 1-2-3 against your 4-hour bias, or when month and week disagree', 'Buying before 2 breaks (anticipating)', 'Entering on a weak, wicky break of 2 instead of waiting for a trigger candle', 'Taking it when 3 dips below 1 (that\'s a lower low; the pattern failed)'],
  },
  flag: {
    idea: 'After a sharp move (the pole), the price pauses in a tight, quiet drift (the flag). Traders who missed the move wait to buy and early buyers mostly hold. When a strong candle breaks out of the flag, the move often continues by a similar amount.',
    look: ['A fast, strong pole', 'A pause of a few candles drifting slightly against the move or sideways', 'The pause gives back no more than 61.8% of the pole', 'A trigger candle (engulfing, hammer, or a strong full-bodied candle) breaking the pole\'s extreme'],
    steps: {
      'pole starts': 'The pole starts here: the beginning of a sharp, fast move.',
      'pole ends': 'The pole ends here. Now watch the pause. Tight, small candles drifting back are healthy; a deep, fast pullback is not.',
    },
    entry: 'Enter when a trigger candle (engulfing, hammer, or a strong full-bodied candle) closes beyond the pole\'s extreme (the break level line). A weak, wicky break isn\'t enough.',
    stop: 'Beyond the flag\'s low (for bull flags). A tight flag gives a tight stop, which is why flags have good reward-to-risk.',
    target: 'A measured move: the pole\'s length added to the breakout level. Flags often travel about as far as the pole.',
    manage: 'A classic target is the pole\'s length projected from the breakout. Many traders take part at 2R and let the rest run.',
    mistakes: ['Calling a deep pullback a flag', 'Buying a weak, wicky breakout candle', 'Buying inside the flag before it breaks'],
  },
  srReject: {
    idea: 'A line is support only once the market has turned there twice: two lows at about the same price (or the prior day\'s low plus one low today). That shows buyers keep defending it. When price comes back a third time, you wait for a reversal candle at the line and buy it.',
    look: ['Touch 1: a swing low that bounced clearly', 'Touch 2: another swing low at about the same price, which bounced again', 'Draw the line through them', 'Touch 3: price comes back to the line and doesn\'t close through it', 'The trigger: a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)', 'Room to the target: at least 1.5R'],
    steps: {
      'touch 1': 'Touch 1: price turned up here. One turn isn\'t a level yet. Note the price and wait to see if it gets defended again.',
      'touch 2': 'Touch 2: price turned up again at about the same price. Two lows make a level: draw your line through them.',
      'touch 3': 'Touch 3: price is back at the line. Don\'t buy just because it\'s here. Wait for a reversal candle (engulfing or hammer). A close through the line means the level broke.',
    },
    entry: 'Enter at the close of the trigger candle (a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)) within 3 candles of the third test.',
    stop: 'Just below the support line itself (or below the test\'s lowest wick if it dipped further). A test can turn a little above the line, so a stop under that wick sits inside the zone and gets knocked out by normal wiggle. If price closes through the level, you\'re wrong.',
    target: 'The high of the bounce between the touches (low for shorts): where price turned the other way last time. If it\'s less than 1.5R away, skip it.',
    manage: 'Take profit at the bounce high. If a candle closes through the level, get out; the level broke.',
    mistakes: ['Drawing a level from a single turn', 'Buying at the line before a reversal candle prints', 'Holding after a close through the level'],
  },
  srFlip: {
    idea: 'A real ceiling is resistance price has turned at before: two highs at the same price today, the prior day\'s high, or an older daily level that turned price twice. When it finally breaks, the sellers who were wrong want out near their entry, so when price comes back to it, old resistance tends to act as support. You buy that retest once a reversal candle shows the new support is holding.',
    look: ['The level: two swing highs at about the same price today, the prior day high, or an older daily resistance', 'A clean close above it (the break)', 'Price moves away, then comes back to retest it from above', 'The retest holds: no close back below', 'The trigger: a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)'],
    steps: {
      'touch 1': 'Touch 1: price turned down here. Note the price.',
      'touch 2': 'Touch 2: price turned down again at about the same price. That\'s resistance: draw the line.',
      break: 'The level just broke. Don\'t chase it. Wait for price to come back and test it from the other side.',
      retest: 'The retest: price came back to the old resistance. Now wait for a reversal candle here; a close back below means the flip failed.',
    },
    entry: 'Enter at the close of the trigger candle (a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)) within 3 candles of the retest.',
    stop: 'Below the retest low (above the retest high for shorts). If price closes back through the level, the flip failed.',
    target: 'Fixed 2R. A flip is a continuation: you expect price to go past the breakout high, a sensible place for partial profit.',
    manage: 'Take part at the breakout high or 1R, move the stop to breakeven, and aim for 2R with the rest.',
    mistakes: ['Chasing the first break instead of waiting for the retest', 'Using a level touched only once', 'Buying the retest before a reversal candle prints'],
  },
  rangeFade: {
    idea: 'When the market has no trend, price bounces between a ceiling and a floor. Selling near the top and buying near the bottom works until the range breaks, so you only fade an edge once a reversal candle shows it\'s turning.',
    look: ['An hour or more of sideways action', 'At least two touches of the top and of the bottom', 'VWAP inside the range (no trend)', 'At the bottom edge: a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high) (at the top: a bearish engulfing or shooting star)'],
    steps: {
      'range starts': 'The range starts here. Draw the top and bottom lines yourself as the touches build up.',
      edge: 'Price has reached an edge. Don\'t enter yet; wait for a reversal candle back into the range.',
      breakout: 'A close outside the box: the range broke. Fading here is fighting a breakout.',
    },
    entry: 'Enter at the close of the reversal candle at the edge, within 3 candles of reaching it.',
    stop: 'Just beyond the edge\'s extreme.',
    target: 'Just inside the other side of the range, where price turned before. If that\'s less than 1.5R away, skip it.',
    manage: 'Target the middle of the range first, then the other side. Ranges eventually break, so don\'t get greedy.',
    mistakes: ['Fading the edge before a reversal candle', 'Fading a trend day (VWAP not inside the range)', 'Holding after a close outside the range'],
  },
  ema: {
    idea: 'In a clean trend, the 20 EMA acts like a moving floor (uptrend) or ceiling (downtrend). After price has bounced off it once (touch 1), you know the market is respecting it, so the next pullback to it (touch 2) is a lower-risk entry once a reversal candle prints.',
    look: ['9 EMA above the 20 EMA, visibly apart', '20 EMA clearly rising (not flat)', 'Touch 1: a pullback to the 20 EMA that bounced back above the 9', 'Touch 2: price gets clear, then pulls back to the 20 EMA again', 'No candle closes below the 20 EMA', 'The trigger: a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)'],
    steps: {
      'touch 1': 'Touch 1: price pulled back to the 20 EMA and bounced back above the 9. The trend respects the 20 EMA. Don\'t chase the bounce; wait for the next pullback.',
      'touch 2': 'Touch 2: the retest of the 20 EMA. A close below the 20 kills the setup. Wait for a reversal candle (engulfing or hammer).',
    },
    entry: 'Enter at the close of the trigger candle (a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)) within 4 candles of touch 2.',
    stop: 'Below the pullback low.',
    target: 'Fixed 2R. A trend is heading for new highs, so there is no level ahead to aim at. The prior high is a place to take partial profit.',
    manage: 'Trail the stop under the 20 EMA or under new higher lows.',
    mistakes: ['Trading it when the EMAs are flat and tangled (no trend)', 'Buying the first touch before the EMA has proven itself', 'Buying at the EMA before a reversal candle prints'],
  },
  macd: {
    idea: 'MACD measures momentum. A cross of its signal line shows momentum turning, but crosses happen constantly. Only crosses on the trend side of zero count, and only once a reversal candle confirms it in price.',
    look: ['MACD crosses its signal line after a quiet period', 'For longs, MACD above zero (below zero for shorts)', 'The trigger: a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high) within 3 candles'],
    steps: { cross: 'MACD just crossed. That\'s the signal, not the entry: wait for a reversal candle (engulfing or hammer) in the same direction.' },
    entry: 'Enter at the close of the trigger candle (a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)) within 3 candles of the cross.',
    stop: 'Beyond the recent swing (the last few candles\' extreme).',
    target: 'Fixed 2R. MACD gives no price level to aim at.',
    manage: 'MACD lags price, so these trades work best with a fixed target (2R) or a trailing stop under swing points.',
    mistakes: ['Taking every cross (most below zero are counter-trend)', 'Entering on the cross without a trigger candle', 'Using MACD alone without looking at price structure'],
  },
  rsi: {
    idea: 'RSI shows when price has moved too far, too fast. In an uptrend, a dip to oversold that recovers is a buyable pullback. In a downtrend the same signal is a falling knife. The 50 SMA tells you which one you\'re looking at, and a reversal candle tells you when.',
    look: ['RSI drops below 35 (oversold)', 'RSI closes back above 35', 'The 50 SMA is rising (uptrend)', 'The trigger: a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high) within 3 candles'],
    steps: {
      oversold: 'RSI is oversold here. Don\'t buy yet: wait for it to close back above the line, check the 50 SMA is rising, then wait for a reversal candle.',
      overbought: 'RSI is overbought here. For a short, wait for it to close back below the line with the 50 SMA falling, then a bearish reversal candle.',
    },
    entry: 'Enter at the close of the trigger candle (a bullish engulfing candle (green, its body covers the previous red body) or a hammer (long lower wick, closes near its high)) within 3 candles of RSI reclaiming the line.',
    stop: 'Below the low of the oversold stretch.',
    target: 'Fixed 2R; the prior swing high is a place for partial profit.',
    manage: 'Targets: the prior swing high, VWAP, or 2R.',
    mistakes: ['Buying oversold readings in a downtrend', 'Buying the reclaim without a trigger candle', 'Treating "oversold" as "must bounce"'],
  },
};
