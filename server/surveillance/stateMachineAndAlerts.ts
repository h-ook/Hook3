import { EngineAlertEvent, SetupInstance, ThirdTouchTracker, DensityItem, OISnapshot, NewsItem } from './types';
import { sendTelegramMessage } from '../telegramService';
import { getUserTelegram } from '../alertService';

function formatCryptoPrice(val: number): string {
  if (!val && val !== 0) return '0.00';
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 1) return val.toFixed(4);
  if (val >= 0.0001) return val.toFixed(6);
  return val.toFixed(8);
}

export class StateMachineAndAlerts {
  private lastAlertTimestamps = new Map<string, number>();

  // Cooldown durations per alert type in ms
  private readonly cooldowns: Record<string, number> = {
    THIRD_TOUCH_APPROACHING: 15 * 60 * 1000,
    THIRD_TOUCH_ACTIVE: 10 * 60 * 1000,
    DENSITY_APPEARED: 15 * 60 * 1000,
    DENSITY_PERSISTENT: 20 * 60 * 1000,
    OI_ANOMALY: 12 * 60 * 1000,
    FORMATION_DETECTED: 30 * 60 * 1000,
    BREAKOUT_REALTIME: 10 * 60 * 1000,
    BREAKOUT_CONFIRMED: 20 * 60 * 1000,
    SUPPORT_RETEST_WATCH: 15 * 60 * 1000,
    SUPPORT_RETEST_CONFIRMED: 20 * 60 * 1000,
    RESISTANCE_REJECTION: 20 * 60 * 1000,
    IMPULSE: 10 * 60 * 1000,
    SESSION_CHANGED: 60 * 60 * 1000,
    NEWS: 30 * 60 * 1000,
    STRUCTURE_SHIFT: 20 * 60 * 1000,
  };

  public canSendAlert(key: string, eventType: string): boolean {
    const now = Date.now();
    const lastTime = this.lastAlertTimestamps.get(key) || 0;
    const cooldown = this.cooldowns[eventType] || 15 * 60 * 1000;

    if (now - lastTime >= cooldown) {
      this.lastAlertTimestamps.set(key, now);
      return true;
    }
    return false;
  }

  // Telegram Support Retest formatted message (Sections 58 & 84)
  public formatSupportRetestMessage(setup: SetupInstance, currentPrice: number): string {
    const sym = setup.symbol;
    const ex = setup.exchange.toUpperCase();
    const mkt = setup.marketType === 'futures' ? 'Linear / Futures' : 'Spot';
    const isConfirmed = setup.stage === 'CONFIRMED';

    return `${isConfirmed ? '🟢' : '🟡'} <b>SUPPORT RETEST — ${isConfirmed ? 'CONFIRMED' : 'WATCH'}</b>

<b>${sym}</b> | ${ex} ${mkt}

<b>ЦІНА:</b> $${formatCryptoPrice(currentPrice)}
<b>ЗОНА ПІДТРИМКИ:</b> $${formatCryptoPrice(setup.entryZone.low)} – $${formatCryptoPrice(setup.entryZone.high)}
<b>СИЛА РІВНЯ:</b> ${setup.evidence.levelStrength}/100
<b>СТАДІЯ:</b> ${setup.stage}

━━━━━━━━━━━━

<b>1. ЩО СТАЛОСЯ?</b>
Ціна ${isConfirmed ? 'протестувала підтримку та продемонструвала реакцію покупця' : 'наближається до ключової зони підтримки'}.

<b>2. ПІДТВЕРДЖЕННЯ (КОНФЛЮЕНС):</b>
${setup.confirmations.map((c) => `• ✓ ${c}`).join('\n') || '• Очікування додаткових підтверджень'}

<b>3. ДЕТАЛІ АНАЛІЗУ:</b>
• <b>HTF Тренд:</b> ${setup.evidence.htfStructure}
• <b>Стакан/Щільність:</b> ${setup.evidence.densityPresence}
• <b>Open Interest:</b> ${setup.evidence.oiContext}
• <b>Контекст BTC:</b> ${setup.evidence.btcContext}
• <b>R:R Співвідношення:</b> 1:${setup.riskRewardRatio || '2.0'}

━━━━━━━━━━━━

<b>ЦІЛІ ТА СКАСУВАННЯ:</b>
• <b>Скасування (Invalidation):</b> $${formatCryptoPrice(setup.invalidationPrice)}
• <b>Ціль 1 (TP1):</b> $${formatCryptoPrice(setup.targets?.tp1 || setup.targetPrice)}
• <b>Ціль 2 (TP2):</b> $${formatCryptoPrice(setup.targets?.tp2 || setup.targetPrice)}
• <b>Конфлюенс:</b> <b>${setup.confluenceScore}/100</b>

<b>НАСТУПНИЙ КРОК:</b>
${isConfirmed ? 'Стеження за реакцією та захистом зони покупцем.' : setup.waitingFor}`;
  }

  // Telegram Third Touch message (Section 13)
  public formatThirdTouchMessage(item: ThirdTouchTracker, symbol: string, exchange: string, currentPrice: number): string {
    return `⚠️ <b>THIRD TOUCH ${item.state === 'ACTIVE' ? 'ACTIVE' : 'APPROACHING'}</b>

<b>${symbol}</b> | ${exchange.toUpperCase()}

<b>РІВЕНЬ (${item.levelType}):</b> $${formatCryptoPrice(item.price)}
<b>ПОТОЧНА ЦІНА:</b> $${formatCryptoPrice(currentPrice)}
<b>ДИСТАНЦІЯ:</b> ${item.distancePct}%
<b>ШВИДКІСТЬ НАБЛИЖЕННЯ:</b> ${item.approachSpeed}

<b>ПІДТВЕРДЖЕНІ ДОТИКИ:</b> ${item.touchCount}
<b>КОМПРЕСІЯ:</b> ${item.compression ? 'ТАК (Виявлено затискання)' : 'НІ'}
${item.askDensityUsd ? `<b>Ask Density:</b> $${(item.askDensityUsd / 1000000).toFixed(2)}M\n` : ''}${item.bidDensityUsd ? `<b>Bid Density:</b> $${(item.bidDensityUsd / 1000000).toFixed(2)}M\n` : ''}
<b>СТАТУС:</b> <b>НАБЛИЖЕННЯ ТРЕТЬОГО ТЕСТУ</b>`;
  }

  // Telegram Density message (Section 20 & 21)
  public formatDensityMessage(density: DensityItem, symbol: string, exchange: string): string {
    const rx = density.historicalReaction;
    return `💧 <b>ЗНАЧУЩА ЩІЛЬНІСТЬ У СТАКАНІ</b>

<b>${symbol}</b> | ${exchange.toUpperCase()}

<b>СТОРОНА:</b> <b>${density.side}</b>
<b>ЦІНА:</b> $${formatCryptoPrice(density.price)}
<b>ОБСЯГ:</b> <b>$${(density.notionalUsd / 1000000).toFixed(2)}M</b>
<b>ДИСТАНЦІЯ:</b> ${density.distancePct}%
<b>ТРИВАЛІСТЬ:</b> ${Math.floor(density.ageSeconds / 60)}хв ${density.ageSeconds % 60}с
<b>КЛАСИФІКАЦІЯ:</b> <b>${density.classification}</b>
${rx ? `<b>Історичний рейт реакції:</b> ${rx.reactionRate}% (Сер. відскок +${rx.averageReactionPct}%)` : ''}`;
  }

  // Telegram OI message (Section 27)
  public formatOIMessage(oi: OISnapshot, symbol: string, currentPrice: number): string {
    return `🚨 <b>АНОМАЛІЯ OPEN INTEREST</b>

<b>${symbol}</b>

<b>OI Зміна 15m:</b> <b>${oi.change15mPct >= 0 ? '+' : ''}${oi.change15mPct}%</b>
<b>Поточний OI:</b> $${(oi.currentUsd / 1000000).toFixed(2)}M
<b>Поточна ціна:</b> $${formatCryptoPrice(currentPrice)}
<b>Інтерпретація ринку:</b> <b>${oi.regime}</b>`;
  }

  // Structure message
  public formatStructureMessage(symbol: string, tf: string, breakDesc: string, price: number): string {
    return `🔄 <b>ЗМІНА СТРУКТУРИ (${tf.toUpperCase()})</b>

<b>${symbol}</b>
<b>Подія:</b> <b>${breakDesc}</b>
<b>Ціна:</b> $${formatCryptoPrice(price)}
<b>Підтверджено:</b> Так (закриття свічки)`;
  }

  // Dispatch alert to user Telegram
  public async dispatchAlert(userId: string, htmlMessage: string) {
    try {
      const userTg = getUserTelegram(userId);
      if (userTg && userTg.chatId && userTg.botToken) {
        await sendTelegramMessage(htmlMessage, {
          botToken: userTg.botToken,
          chatId: userTg.chatId,
        });
      } else {
        // Fallback to global env bot if available
        await sendTelegramMessage(htmlMessage);
      }
    } catch (e) {
      console.warn('[StateMachineAndAlerts] Failed to send Telegram alert:', e);
    }
  }
}
