# Entry Intelligence Engine

This revision changes the system from **formation detection -> entry** to:

`formation -> location -> trigger -> independent confirmations -> risk/reward -> confirmed entry`

## Entry hard gates

A `CONFIRMED` setup requires:

- valid directional formation;
- higher-timeframe context not contradicting the direction;
- a recent lower-timeframe BOS/CHoCH trigger;
- at least 3 independent confirmation groups;
- risk/reward >= 2.0;
- confluence score >= 78/100.

The score is a **confluence score**, not a probability of profit.

## Confirmation groups

- Formation quality
- HTF structure
- BOS/CHoCH
- Volume / RVOL
- Aggressive trade flow
- Order-book density quality
- Order-book imbalance
- Open interest regime
- BTC/market context

## Order-book density

Densities now track:

- persistence ratio and sample count;
- cancellation rate;
- replenishment rate;
- average/max notional;
- nearest approach to price;
- quality score 0-100;
- spoof-risk penalty.

A large wall alone is no longer enough to confirm an entry.

## Formation page

Formation scanning now ignores an in-progress candle when the feed contains a live candle. Volatility squeeze is neutral until a directional breakout is confirmed. Formation confidence is adjusted using closed-candle volume and trigger state.

## Risk model

Entries use a preferred entry price, invalidation, target and R:R. Static default TP/SL percentages are no longer the primary source of setup quality.

## Alert behavior

Telegram setup alerts are emitted only for `CONFIRMED` entries. Watch/approach states remain available in the application state but do not produce entry alerts.

## Validation

The changed TypeScript modules were syntax/type-checked in isolation. Full project type-checking still depends on the project's npm dependencies being installed; the provided environment could not complete `npm ci` within the available execution window.
