import { Kline, Timeframe } from '../../src/types';
import { calculateATR } from './multiTimeframeEngine';
import { DetectedPattern, LevelZone, ThirdTouchTracker } from './types';

export class LevelsAndFormationsEngine {
  private levelZones: LevelZone[] = [];
  private thirdTouchTrackers = new Map<string, ThirdTouchTracker>();

  public findSupportResistanceZones(candles1d: Kline[], candles4h: Kline[], candles1h: Kline[]): LevelZone[] {
    const zones: LevelZone[] = [];
    const closed = (candles: Kline[], tfMs: number) => {
      if (candles.length <= 2) return candles;
      const t = candles[candles.length - 1].time > 2_000_000_000_000 ? candles[candles.length - 1].time : candles[candles.length - 1].time * 1000;
      const interval = candles.length > 2 ? Math.max(1000, ((candles[candles.length - 1].time > 2_000_000_000_000 ? candles[candles.length - 1].time : candles[candles.length - 1].time * 1000) - (candles[candles.length - 2].time > 2_000_000_000_000 ? candles[candles.length - 2].time : candles[candles.length - 2].time * 1000))) : tfMs;
      return t + Math.min(tfMs, interval) > Date.now() ? candles.slice(0, -1) : candles;
    };
    candles1d = closed(candles1d, 24 * 60 * 60 * 1000);
    candles4h = closed(candles4h, 4 * 60 * 60 * 1000);
    candles1h = closed(candles1h, 60 * 60 * 1000);

    const analyzeCandlesForZones = (candles: Kline[], tf: Timeframe, weight: number) => {
      if (candles.length < 10) return;
      const atr = calculateATR(candles);
      const zoneTolerance = atr * 0.35; // Zone width proportional to volatility

      // Group swing highs & lows
      for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        const isHigh = c.high >= candles[i - 1].high && c.high >= candles[i - 2].high &&
                       c.high >= candles[i + 1].high && c.high >= candles[i + 2].high;
        const isLow = c.low <= candles[i - 1].low && c.low <= candles[i - 2].low &&
                      c.low <= candles[i + 1].low && c.low <= candles[i + 2].low;

        if (isHigh) {
          const reactionHigh = Math.min(candles.length - 1, i + 6);
          const minAfter = Math.min(...candles.slice(i + 1, reactionHigh + 1).map(x => x.low), c.high);
          const reactionPct = Math.max(0, (c.high - minAfter) / c.high * 100);
          this.clusterZone(zones, tf, 'RESISTANCE', c.high, zoneTolerance, c.time, weight, reactionPct, reactionPct >= 1.0);
        }
        if (isLow) {
          const reactionHigh = Math.min(candles.length - 1, i + 6);
          const maxAfter = Math.max(...candles.slice(i + 1, reactionHigh + 1).map(x => x.high), c.low);
          const reactionPct = Math.max(0, (maxAfter - c.low) / c.low * 100);
          this.clusterZone(zones, tf, 'SUPPORT', c.low, zoneTolerance, c.time, weight, reactionPct, reactionPct >= 1.0);
        }
      }
    };

    analyzeCandlesForZones(candles1d, '1d', 35);
    analyzeCandlesForZones(candles4h, '4h', 30);
    analyzeCandlesForZones(candles1h, '1h', 20);

    // Calculate level strength score (0-100) and reaction stats
    for (const z of zones) {
      const touchScore = Math.min(40, z.touches * 10);
      const reactionScore = Math.min(30, (z.strongReactions / Math.max(1, z.touches)) * 30);
      const tfScore = z.timeframe === '1d' ? 30 : z.timeframe === '4h' ? 20 : 10;
      z.strengthScore = Math.min(100, Math.round(touchScore + reactionScore + tfScore));
      z.averageReactionPct = Number((z.averageReactionPct / Math.max(1, z.touches)).toFixed(2));
    }

    this.levelZones = zones.sort((a, b) => b.strengthScore - a.strengthScore);
    return this.levelZones;
  }

  private clusterZone(
    zones: LevelZone[],
    tf: Timeframe,
    type: 'SUPPORT' | 'RESISTANCE',
    price: number,
    tolerance: number,
    time: number,
    weight: number,
    reactionPct = 0,
    strongReaction = false
  ) {
    const existing = zones.find((z) => z.type === type && Math.abs(z.zoneCenter - price) <= tolerance);
    if (existing) {
      existing.touches += 1;
      existing.zoneLow = Math.min(existing.zoneLow, price - tolerance * 0.5);
      existing.zoneHigh = Math.max(existing.zoneHigh, price + tolerance * 0.5);
      existing.zoneCenter = (existing.zoneLow + existing.zoneHigh) / 2;
      existing.lastTouchTime = Math.max(existing.lastTouchTime, time);
      if (strongReaction) existing.strongReactions += 1;
      else existing.weakReactions += 1;
      existing.averageReactionPct += reactionPct;
      existing.maxReactionPct = Math.max(existing.maxReactionPct, reactionPct);
    } else {
      zones.push({
        id: `zone_${tf}_${type}_${Math.round(price)}`,
        timeframe: tf,
        type,
        zoneLow: price - tolerance * 0.5,
        zoneHigh: price + tolerance * 0.5,
        zoneCenter: price,
        touches: 1,
        strongReactions: strongReaction ? 1 : 0,
        weakReactions: strongReaction ? 0 : 1,
        averageReactionPct: reactionPct,
        maxReactionPct: reactionPct,
        strengthScore: weight,
        firstSeen: time,
        lastTouchTime: time,
      });
    }
  }

  public trackThirdTouch(currentPrice: number, candles1h: Kline[]): ThirdTouchTracker[] {
    const activeTrackers: ThirdTouchTracker[] = [];
    const atr = calculateATR(candles1h);

    for (const zone of this.levelZones) {
      if (zone.touches < 2) continue; // Needs at least 2 prior confirmed touches

      const dist = Math.abs(currentPrice - zone.zoneCenter);
      const distPct = (dist / zone.zoneCenter) * 100;
      const approachThresholdPct = (atr / zone.zoneCenter) * 100 * 1.5;

      let tracker = this.thirdTouchTrackers.get(zone.id);
      if (!tracker) {
        tracker = {
          levelId: zone.id,
          levelType: zone.type,
          price: zone.zoneCenter,
          touchCount: zone.touches,
          state: 'NOT_EXPECTED',
          distancePct: Number(distPct.toFixed(3)),
          approachSpeed: 'NORMAL',
          compression: false,
          higherLowsCount: 0,
          lowerHighsCount: 0,
          volumeRatio: 1.0,
          updatedAt: Date.now(),
        };
        this.thirdTouchTrackers.set(zone.id, tracker);
      }

      tracker.distancePct = Number(distPct.toFixed(3));
      tracker.touchCount = zone.touches;

      // In zone or approaching
      if (distPct <= approachThresholdPct) {
        if (currentPrice >= zone.zoneLow && currentPrice <= zone.zoneHigh) {
          tracker.state = 'ACTIVE';
        } else {
          tracker.state = 'APPROACHING';
        }

        // Check compression into level
        const recent10 = candles1h.slice(-10);
        let hlCount = 0;
        let lhCount = 0;
        for (let i = 1; i < recent10.length; i++) {
          if (recent10[i].low > recent10[i - 1].low) hlCount++;
          if (recent10[i].high < recent10[i - 1].high) lhCount++;
        }

        tracker.higherLowsCount = hlCount;
        tracker.lowerHighsCount = lhCount;
        tracker.compression = (zone.type === 'RESISTANCE' && hlCount >= 4) || (zone.type === 'SUPPORT' && lhCount >= 4);

        activeTrackers.push(tracker);
      } else {
        if (tracker.state === 'ACTIVE' || tracker.state === 'APPROACHING') {
          tracker.state = 'REACTION';
        }
      }
    }

    return activeTrackers;
  }

  public detectFormations(candles1h: Kline[], currentPrice: number): DetectedPattern[] {
    // Never finalize a formation from an in-progress candle. The live candle is
    // useful for proximity/approach elsewhere, but confirmation is closed-candle only.
    const tfMs = 60 * 60 * 1000;
    const lastTimeMs = candles1h.length ? (candles1h[candles1h.length - 1].time > 2_000_000_000_000 ? candles1h[candles1h.length - 1].time : candles1h[candles1h.length - 1].time * 1000) : 0;
    const prevTimeMs = candles1h.length > 1 ? (candles1h[candles1h.length - 2].time > 2_000_000_000_000 ? candles1h[candles1h.length - 2].time : candles1h[candles1h.length - 2].time * 1000) : 0;
    const intervalMs = Math.max(1000, lastTimeMs - prevTimeMs || tfMs);
    const closed = candles1h.length > 2 && lastTimeMs + Math.min(tfMs, intervalMs) > Date.now()
      ? candles1h.slice(0, -1)
      : candles1h;
    const patterns: DetectedPattern[] = [];
    if (closed.length < 25) return patterns;

    const slice = closed.slice(-40);
    const atr = calculateATR(slice);
    const closedPrice = slice[slice.length - 1].close;
    const atrPct = closedPrice > 0 ? (atr / closedPrice) * 100 : 0;
    const equalTolerancePct = Math.max(0.12, Math.min(2.0, atrPct * 0.35));
    const tolerance = Math.max(atr * 0.35, closedPrice * equalTolerancePct / 100);
    const equalToleranceRatio = equalTolerancePct / 100;
    const swings = this.findSwings(slice, 2);
    const highs = swings.filter(s=>s.type==='HIGH');
    const lows = swings.filter(s=>s.type==='LOW');
    const priorSlice = slice.slice(0, -1);
    const maxHigh = Math.max(...priorSlice.map(c=>c.high));
    const minLow = Math.min(...priorSlice.map(c=>c.low));
    const range = Math.max(maxHigh-minLow, 0.00000001);

    if (lows.length >= 2) {
      const a=lows[lows.length-2], b=lows[lows.length-1];
      const diff=Math.abs(a.price-b.price)/Math.max(a.price,b.price);
      const between=highs.filter(h=>h.index>a.index && h.index<b.index);
      if (b.index-a.index>=4 && diff<=Math.max(equalToleranceRatio, 0.0012) && between.length) {
        const neckline=Math.max(...between.map(h=>h.price));
        const height=neckline-(a.price+b.price)/2;
        if(height/range>=0.12) {
          const breakout=closedPrice>neckline;
          const retest=breakout && closedPrice<=neckline*1.008;
          const score=this.patternScore({symmetry:1-diff/Math.max(equalToleranceRatio,0.0012), depth:Math.min(1,height/(a.price*0.03)), trigger:breakout?1:0, volume:this.breakoutVolumeScore(closed, b.index, neckline, 'LONG')});
          patterns.push({name:'Double Bottom',type:'Double Bottom',bias:'bullish',score,upperBoundary:neckline,lowerBoundary:Math.min(a.price,b.price),touchesUpper:1,touchesLower:2,compression:false,timeframe:'1h',status:retest||breakout?'BROKEN':'READY'});
        }
      }
    }

    if (highs.length >= 2) {
      const a=highs[highs.length-2], b=highs[highs.length-1];
      const diff=Math.abs(a.price-b.price)/Math.max(a.price,b.price);
      const between=lows.filter(l=>l.index>a.index && l.index<b.index);
      if (b.index-a.index>=4 && diff<=Math.max(equalToleranceRatio,0.0012) && between.length) {
        const neckline=Math.min(...between.map(l=>l.price));
        const height=(a.price+b.price)/2-neckline;
        if(height/range>=0.12) {
          const breakdown=closedPrice<neckline;
          const retest=breakdown && closedPrice>=neckline*0.992;
          const score=this.patternScore({symmetry:1-diff/Math.max(equalToleranceRatio,0.0012),depth:Math.min(1,height/(a.price*0.03)),trigger:breakdown?1:0,volume:this.breakoutVolumeScore(closed,b.index,neckline,'SHORT')});
          patterns.push({name:'Double Top',type:'Double Top',bias:'bearish',score,upperBoundary:Math.max(a.price,b.price),lowerBoundary:neckline,touchesUpper:2,touchesLower:1,compression:false,timeframe:'1h',status:retest||breakdown?'BROKEN':'READY'});
        }
      }
    }

    const highCluster=highs.filter(h=>Math.abs(h.price-maxHigh)/maxHigh<=Math.max(equalToleranceRatio,0.0015));
    const hl=lowPairs(lows).filter(([a,b])=>b.price>a.price).length;
    if(highCluster.length>=3 && hl>=2) {
      const score=this.patternScore({symmetry:1,depth:Math.min(1,hl/4),trigger:closedPrice>maxHigh?1:0,volume:this.breakoutVolumeScore(closed,closed.length-1,maxHigh,'LONG')});
      patterns.push({name:'Ascending Triangle',type:'Ascending Triangle',bias:'bullish',score,upperBoundary:maxHigh,lowerBoundary:minLow,touchesUpper:highCluster.length,touchesLower:hl+1,compression:true,timeframe:'1h',status:closedPrice>maxHigh?'BROKEN':'READY'});
    }

    const lowCluster=lows.filter(l=>Math.abs(l.price-minLow)/minLow<=Math.max(equalToleranceRatio,0.0015));
    const lh=highPairs(highs).filter(([a,b])=>b.price<a.price).length;
    if(lowCluster.length>=3 && lh>=2) {
      const score=this.patternScore({symmetry:1,depth:Math.min(1,lh/4),trigger:closedPrice<minLow?1:0,volume:this.breakoutVolumeScore(closed,closed.length-1,minLow,'SHORT')});
      patterns.push({name:'Descending Triangle',type:'Descending Triangle',bias:'bearish',score,upperBoundary:maxHigh,lowerBoundary:minLow,touchesUpper:lh+1,touchesLower:lowCluster.length,compression:true,timeframe:'1h',status:closedPrice<minLow?'BROKEN':'READY'});
    }

    const recentAtr=calculateATR(slice.slice(-10));
    const priorAtr=calculateATR(slice.slice(-25,-10));
    if(priorAtr>0 && recentAtr<priorAtr*0.7) {
      // Squeeze is explicitly neutral until a confirmed directional breakout exists.
      const breakoutUp=closedPrice>maxHigh;
      const breakoutDown=closedPrice<minLow;
      patterns.push({name:'Volatility Compression',type:'Compression',bias:breakoutUp?'bullish':breakoutDown?'bearish':'neutral',score:breakoutUp||breakoutDown?70:55,upperBoundary:maxHigh,lowerBoundary:minLow,touchesUpper:highCluster.length,touchesLower:lowCluster.length,compression:true,timeframe:'1h',status:breakoutUp||breakoutDown?'BROKEN':'READY'});
    }

    return patterns.filter(p=>p.score>=50);
  }

  private findSwings(candles: Kline[], window=2): Array<{index:number;price:number;type:'HIGH'|'LOW'}> {
    const out:Array<{index:number;price:number;type:'HIGH'|'LOW'}>=[];
    for(let i=window;i<candles.length-window;i++) {
      let hi=true,lo=true;
      for(let j=1;j<=window;j++) { if(candles[i-j].high>=candles[i].high||candles[i+j].high>=candles[i].high)hi=false; if(candles[i-j].low<=candles[i].low||candles[i+j].low<=candles[i].low)lo=false; }
      if(hi)out.push({index:i,price:candles[i].high,type:'HIGH'});
      if(lo)out.push({index:i,price:candles[i].low,type:'LOW'});
    }
    return out.sort((a,b)=>a.index-b.index);
  }

  private patternScore(args:{symmetry:number;depth:number;trigger:number;volume:number}):number {
    return Math.round(Math.max(50,Math.min(95,55+args.symmetry*15+args.depth*12+args.trigger*8+args.volume*5)));
  }

  private breakoutVolumeScore(candles:Kline[], index:number, boundary:number, direction:'LONG'|'SHORT'):number {
    const sample=candles.slice(Math.max(0,index-20),index);
    if(!sample.length)return 0;
    const avg=sample.reduce((s,c)=>s+c.volume,0)/sample.length;
    const c=candles[Math.min(candles.length-1,index)];
    const directional=direction==='LONG'?c.close>boundary:c.close<boundary;
    return directional && c.volume>avg*1.2 ? Math.min(1,c.volume/Math.max(avg*2,0.00000001)) : 0;
  }
}

function lowPairs(xs:Array<{index:number;price:number;type:'HIGH'|'LOW'}>) { const out:Array<[typeof xs[number],typeof xs[number]]>=[]; for(let i=1;i<xs.length;i++)out.push([xs[i-1],xs[i]]); return out; }
function highPairs(xs:Array<{index:number;price:number;type:'HIGH'|'LOW'}>) { const out:Array<[typeof xs[number],typeof xs[number]]>=[]; for(let i=1;i<xs.length;i++)out.push([xs[i-1],xs[i]]); return out; }
