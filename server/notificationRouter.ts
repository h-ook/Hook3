import fs from 'fs';
import path from 'path';
import { getEffectiveTelegramConfig, sendTelegramMessage } from './telegramService';
import { ExchangeId, MarketType, Timeframe } from '../src/types';

export type NotificationChannel = 'telegram' | 'browser' | 'internal';

export type NotificationEventType =
  | 'PRICE_ALERT'
  | 'BOS'
  | 'CHoCH'
  | 'STRUCTURE_SHIFT'
  | 'THIRD_TOUCH'
  | 'DENSITY'
  | 'OI_ANOMALY'
  | 'SETUP'
  | 'SURVEILLANCE_LEVEL'
  | 'MOMENTUM'
  | 'CHANNEL_BREAK'
  | 'FIBONACCI'
  | 'CRON_TEST';

export interface NotificationEvent {
  eventId?: string; // Optional custom ID; if omitted, deterministic identity is computed
  userId: string;
  symbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  eventType: NotificationEventType;
  title: string;
  description: string;
  price: number;
  timeframe?: Timeframe | string;
  direction?: 'bullish' | 'bearish' | 'LONG' | 'SHORT' | 'neutral';
  logicalLevel?: number; // Normalized price level for dedup
  severity?: 'info' | 'warning' | 'critical';
  telegramHtml?: string;
  channels?: NotificationChannel[];
  metadata?: Record<string, any>;
  createdAt?: number;
}

export interface NotificationHistoryRecord {
  id: string;
  traceId: string;
  userId: string;
  eventId: string;
  symbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  title: string;
  description: string;
  price: number;
  timeframe?: string;
  severity: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped' | 'deduplicated' | 'cooldown';
  error?: string;
  retryCount: number;
  attemptedAt: number;
  sentAt?: number;
  createdAt: number;
  metadata?: Record<string, any>;
}

export interface DispatchResult {
  success: boolean;
  eventId: string;
  traceId: string;
  status: 'sent' | 'failed' | 'skipped' | 'cooldown' | 'deduplicated';
  channels: {
    telegram?: { sent: boolean; error?: string; skipped?: boolean };
    browser?: { sent: boolean; error?: string };
    internal?: { sent: boolean };
  };
  error?: string;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const NOTIFICATION_HISTORY_FILE = path.join(DATA_DIR, 'notification_history.json');
const ALERT_HISTORY_FILE = path.join(DATA_DIR, 'alert_history.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
      console.error('[NotificationRouter] Failed to create data dir:', e);
    }
  }
}

export class NotificationRouter {
  private static instance: NotificationRouter | null = null;

  // Cooldown durations by event type in milliseconds
  private readonly defaultCooldowns: Record<NotificationEventType, number> = {
    PRICE_ALERT: 10 * 60 * 1000,         // 10 min for same price alert target
    BOS: 15 * 60 * 1000,                 // 15 min for same timeframe structure break
    CHoCH: 15 * 60 * 1000,               // 15 min for change of character
    STRUCTURE_SHIFT: 15 * 60 * 1000,     // 15 min
    THIRD_TOUCH: 12 * 60 * 1000,         // 12 min
    DENSITY: 15 * 60 * 1000,             // 15 min for same density level
    OI_ANOMALY: 15 * 60 * 1000,          // 15 min
    SETUP: 20 * 60 * 1000,               // 20 min for confirmed setup
    SURVEILLANCE_LEVEL: 15 * 60 * 1000,  // 15 min for level crossing
    MOMENTUM: 10 * 60 * 1000,            // 10 min
    CHANNEL_BREAK: 15 * 60 * 1000,       // 15 min
    FIBONACCI: 20 * 60 * 1000,           // 20 min
    CRON_TEST: 5 * 1000,                 // 5 sec for manual tests
  };

  // Cooldown store: deterministicKey -> timestamp of last SUCCESSFUL dispatch
  private lastDispatchTimestamps = new Map<string, number>();

  // Deduplication store: deterministicKey -> timestamp of recent detection (short window: 30s)
  private recentDetections = new Map<string, number>();

  // In-memory ring buffer for browser/in-app notification delivery (user-partitioned)
  // Stores up to 200 events per user
  private clientNotificationBuffer = new Map<string, NotificationHistoryRecord[]>();

  // Complete persisted history
  private historyCache: NotificationHistoryRecord[] = [];
  private isHistoryLoaded = false;

  public static getInstance(): NotificationRouter {
    if (!NotificationRouter.instance) {
      NotificationRouter.instance = new NotificationRouter();
    }
    return NotificationRouter.instance;
  }

  constructor() {
    this.loadPersistedHistory();
  }

  private loadPersistedHistory() {
    if (this.isHistoryLoaded) return;
    try {
      ensureDataDir();
      if (fs.existsSync(NOTIFICATION_HISTORY_FILE)) {
        const raw = fs.readFileSync(NOTIFICATION_HISTORY_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.historyCache = parsed;
        }
      }
    } catch (e) {
      console.error('[NotificationRouter] Error reading notification_history.json:', e);
      this.historyCache = [];
    }
    this.isHistoryLoaded = true;
  }

  private savePersistedHistory() {
    try {
      ensureDataDir();
      // Keep maximum 1000 notification records in persistent history
      if (this.historyCache.length > 1000) {
        this.historyCache = this.historyCache.slice(0, 1000);
      }
      fs.writeFileSync(NOTIFICATION_HISTORY_FILE, JSON.stringify(this.historyCache, null, 2), 'utf-8');
    } catch (e) {
      console.error('[NotificationRouter] Error saving notification_history.json:', e);
    }
  }

  /**
   * Deterministic Identity Generator
   * Generates a stable event key resistant to micro-price volatility.
   *
   * Formats:
   * - PRICE_ALERT: user:symbol:PRICE_ALERT:condition:levelRounded
   * - BOS / CHoCH: user:symbol:type:timeframe:direction:logicalLevel
   * - THIRD_TOUCH: user:symbol:THIRD_TOUCH:logicalLevel
   * - DENSITY: user:symbol:DENSITY:side:levelRounded
   * - OI_ANOMALY: user:symbol:OI_ANOMALY:10mBucket
   * - SETUP: user:symbol:SETUP:setupType:direction:zoneRounded
   * - SURVEILLANCE_LEVEL: user:symbol:SURV:eventType:levelRounded
   */
  public generateEventIdentity(event: NotificationEvent): string {
    if (event.eventId && event.eventId.trim()) {
      return event.eventId.trim();
    }

    const uid = event.userId || 'guest';
    const sym = event.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const tf = event.timeframe ? event.timeframe.toLowerCase() : 'any';
    const dir = event.direction ? event.direction.toUpperCase() : 'NONE';

    // Round price level to stable bucket to prevent price jitter from bypassing dedup
    const level = event.logicalLevel !== undefined
      ? event.logicalLevel
      : event.price > 0
      ? this.roundPriceToBucket(event.price)
      : 0;

    switch (event.eventType) {
      case 'PRICE_ALERT': {
        const cond = event.metadata?.condition || 'target';
        return `alert:${uid}:${sym}:${cond}:${level}`;
      }
      case 'BOS':
      case 'CHoCH':
      case 'STRUCTURE_SHIFT': {
        return `struct:${uid}:${sym}:${event.eventType}:${tf}:${dir}:${level}`;
      }
      case 'THIRD_TOUCH': {
        const stage = event.metadata?.state || 'active';
        return `tt:${uid}:${sym}:${stage}:${level}`;
      }
      case 'DENSITY': {
        const side = event.metadata?.side || 'BID';
        return `density:${uid}:${sym}:${side}:${level}`;
      }
      case 'OI_ANOMALY': {
        // 10-minute time bucket for OI anomalies
        const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
        return `oi:${uid}:${sym}:${bucket}`;
      }
      case 'SETUP': {
        const sType = event.metadata?.setupType || 'SETUP';
        const stage = event.metadata?.stage || 'CONFIRMED';
        return `setup:${uid}:${sym}:${sType}:${stage}:${dir}:${level}`;
      }
      case 'SURVEILLANCE_LEVEL': {
        const subType = event.metadata?.subType || 'CROSS';
        return `surv_lvl:${uid}:${sym}:${subType}:${tf}:${level}`;
      }
      default: {
        return `${event.eventType.toLowerCase()}:${uid}:${sym}:${tf}:${level}`;
      }
    }
  }

  private roundPriceToBucket(price: number): number {
    if (price <= 0) return 0;
    if (price >= 10000) return Math.round(price); // e.g. BTC rounded to $1
    if (price >= 1000) return Number(price.toFixed(1));
    if (price >= 10) return Number(price.toFixed(2));
    if (price >= 1) return Number(price.toFixed(3));
    if (price >= 0.01) return Number(price.toFixed(5));
    return Number(price.toFixed(7));
  }

  /**
   * Pre-check whether this event can be dispatched.
   * Checks validation, short-term deduplication, and cooldown.
   *
   * CRITICAL: Does NOT modify cooldown timestamp! Cooldown is only updated
   * once an actual delivery attempt succeeds.
   */
  public canDispatch(event: NotificationEvent): {
    canDispatch: boolean;
    reason?: 'validation_failed' | 'deduplicated' | 'cooldown_active' | 'no_channels';
    remainingCooldownSeconds?: number;
    eventKey: string;
  } {
    const eventKey = this.generateEventIdentity(event);
    const now = Date.now();

    // 1. Validation check
    if (!event.symbol || !event.title) {
      return { canDispatch: false, reason: 'validation_failed', eventKey };
    }

    // 2. Short-term Deduplication check (30 seconds window for exact same event tick)
    const lastDetected = this.recentDetections.get(eventKey);
    if (lastDetected && now - lastDetected < 25000) {
      return { canDispatch: false, reason: 'deduplicated', eventKey };
    }

    // 3. Cooldown check
    const lastDispatched = this.lastDispatchTimestamps.get(eventKey);
    const cooldownDuration = this.getCooldownDuration(event);
    if (lastDispatched && now - lastDispatched < cooldownDuration) {
      const remainingSeconds = Math.ceil((cooldownDuration - (now - lastDispatched)) / 1000);
      return {
        canDispatch: false,
        reason: 'cooldown_active',
        remainingCooldownSeconds: remainingSeconds,
        eventKey,
      };
    }

    return { canDispatch: true, eventKey };
  }

  public getCooldownDuration(event: NotificationEvent): number {
    const customCooldown = event.metadata?.cooldownMs;
    if (typeof customCooldown === 'number' && customCooldown > 0) {
      return customCooldown;
    }
    return this.defaultCooldowns[event.eventType] || 15 * 60 * 1000;
  }

  /**
   * Record Successful Dispatch:
   * Sets the cooldown timestamp, appends to history, and buffers for browser notifications.
   */
  public recordDispatchSuccess(
    event: NotificationEvent,
    traceId: string,
    channels: { telegramSent: boolean; browserSent: boolean }
  ): NotificationHistoryRecord {
    const now = Date.now();
    const eventKey = this.generateEventIdentity(event);

    // Update Cooldown & Deduplication timestamps
    this.lastDispatchTimestamps.set(eventKey, now);
    this.recentDetections.set(eventKey, now);

    const record: NotificationHistoryRecord = {
      id: `nh_${now}_${Math.random().toString(36).substring(2, 7)}`,
      traceId,
      userId: event.userId || 'guest',
      eventId: eventKey,
      symbol: event.symbol,
      exchange: event.exchange,
      marketType: event.marketType,
      eventType: event.eventType,
      channel: channels.telegramSent ? 'telegram' : 'browser',
      title: event.title,
      description: event.description,
      price: event.price,
      timeframe: event.timeframe,
      severity: event.severity || 'info',
      status: 'sent',
      retryCount: 0,
      attemptedAt: now,
      sentAt: now,
      createdAt: event.createdAt || now,
      metadata: event.metadata,
    };

    this.historyCache.unshift(record);
    this.savePersistedHistory();

    // Buffer for client browser notification streaming
    this.pushClientBuffer(event.userId, record);

    console.log(`[Trace:${traceId}] [SUCCESS] Delivered notification for #${event.symbol} (${event.eventType}) to user ${event.userId || 'guest'}`);
    return record;
  }

  /**
   * Record Dispatch Failure:
   * Logs error and saves failure record to history.
   * Does NOT lock cooldown for transient failures so the system can retry.
   */
  public recordDispatchFailure(
    event: NotificationEvent,
    traceId: string,
    error: string,
    isTerminal: boolean,
    retryCount: number
  ): NotificationHistoryRecord {
    const now = Date.now();
    const eventKey = this.generateEventIdentity(event);

    if (isTerminal) {
      // If error is terminal (invalid token, bot blocked), lock cooldown to prevent infinite error spamming
      this.lastDispatchTimestamps.set(eventKey, now);
    }

    const record: NotificationHistoryRecord = {
      id: `nh_fail_${now}_${Math.random().toString(36).substring(2, 7)}`,
      traceId,
      userId: event.userId || 'guest',
      eventId: eventKey,
      symbol: event.symbol,
      exchange: event.exchange,
      marketType: event.marketType,
      eventType: event.eventType,
      channel: 'telegram',
      title: event.title,
      description: event.description,
      price: event.price,
      timeframe: event.timeframe,
      severity: event.severity || 'warning',
      status: 'failed',
      error,
      retryCount,
      attemptedAt: now,
      createdAt: event.createdAt || now,
      metadata: event.metadata,
    };

    this.historyCache.unshift(record);
    this.savePersistedHistory();

    console.error(`[Trace:${traceId}] [FAIL] Notification failed for #${event.symbol} (${event.eventType}): ${error}. Terminal: ${isTerminal}, Retries: ${retryCount}`);
    return record;
  }

  /**
   * Main Dispatch Entry Point
   * 1. Validates event
   * 2. Checks deduplication
   * 3. Checks cooldown
   * 4. Dispatches to enabled channels (Telegram, Browser, UI)
   * 5. Performs exponential backoff retry for transient network errors
   * 6. Records actual outcome
   */
  public async dispatch(event: NotificationEvent): Promise<DispatchResult> {
    const traceId = Math.random().toString(36).substring(2, 8);
    const eventKey = this.generateEventIdentity(event);
    const channels = event.channels || ['telegram', 'browser', 'internal'];

    console.log(`[Trace:${traceId}] [DETECTED] #${event.symbol} event: ${event.eventType} on ${event.exchange.toUpperCase()}`);

    // Check Dedup and Cooldown
    const check = this.canDispatch(event);
    if (!check.canDispatch) {
      if (check.reason === 'deduplicated') {
        console.log(`[Trace:${traceId}] [DEDUP] Duplicate event suppressed for ${eventKey}`);
        return {
          success: false,
          eventId: eventKey,
          traceId,
          status: 'deduplicated',
          channels: {},
          error: 'Подія щойно була оброблена (deduplication)',
        };
      }
      if (check.reason === 'cooldown_active') {
        console.log(`[Trace:${traceId}] [COOLDOWN] Cooldown active for ${eventKey} (${check.remainingCooldownSeconds}s remaining)`);
        return {
          success: false,
          eventId: eventKey,
          traceId,
          status: 'cooldown',
          channels: {},
          error: `Cooldown активний: зачекайте ${check.remainingCooldownSeconds}с`,
        };
      }
      return {
        success: false,
        eventId: eventKey,
        traceId,
        status: 'skipped',
        channels: {},
        error: `Event rejected: ${check.reason}`,
      };
    }

    console.log(`[Trace:${traceId}] [DISPATCH] Dispatching #${event.symbol} (${event.eventType}) to channels: ${channels.join(', ')}`);

    let telegramSent = false;
    let telegramError: string | undefined;
    let telegramSkipped = false;

    // 1. Dispatch Telegram if requested
    if (channels.includes('telegram')) {
      const tgConfig = getEffectiveTelegramConfig(event.userId);

      if (!tgConfig.botToken || !tgConfig.chatId) {
        telegramSkipped = true;
        telegramError = 'Telegram credentials not configured for user';
        console.log(`[Trace:${traceId}] [TELEGRAM] Skipped: Telegram not configured for user ${event.userId || 'guest'}`);
      } else {
        const messageHtml = event.telegramHtml || this.formatFallbackTelegramMessage(event);

        // Attempt delivery with transient error retry
        const deliveryResult = await this.deliverTelegramWithRetry(
          messageHtml,
          tgConfig.botToken,
          tgConfig.chatId,
          traceId
        );

        telegramSent = deliveryResult.success;
        telegramError = deliveryResult.error;
      }
    }

    // 2. Dispatch Browser / In-App Event
    let browserSent = false;
    if (channels.includes('browser') || channels.includes('internal')) {
      browserSent = true;
      console.log(`[Trace:${traceId}] [BROWSER] Registered in-app/browser notification event for user: ${event.userId || 'guest'}`);
    }

    const overallSuccess = telegramSent || (telegramSkipped && browserSent);

    if (overallSuccess) {
      this.recordDispatchSuccess(event, traceId, { telegramSent, browserSent });
      return {
        success: true,
        eventId: eventKey,
        traceId,
        status: 'sent',
        channels: {
          telegram: { sent: telegramSent, error: telegramError, skipped: telegramSkipped },
          browser: { sent: browserSent },
          internal: { sent: true },
        },
      };
    } else {
      const isTerminal = this.isTerminalTelegramError(telegramError || '');
      this.recordDispatchFailure(event, traceId, telegramError || 'Помилка надсилання сповіщення', isTerminal, 3);
      return {
        success: false,
        eventId: eventKey,
        traceId,
        status: 'failed',
        channels: {
          telegram: { sent: false, error: telegramError },
          browser: { sent: browserSent },
          internal: { sent: true },
        },
        error: telegramError,
      };
    }
  }

  /**
   * Telegram Delivery with Exponential Backoff for Transient Failures
   */
  private async deliverTelegramWithRetry(
    htmlText: string,
    botToken: string,
    chatId: string,
    traceId: string
  ): Promise<{ success: boolean; error?: string }> {
    const maxRetries = 2; // initial attempt + 2 retries = 3 total attempts
    const backoffs = [1500, 4000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Trace:${traceId}] [TELEGRAM] Attempt ${attempt + 1}/${maxRetries + 1}...`);
        const result = await sendTelegramMessage(htmlText, {
          botToken,
          chatId,
        });

        if (result.success) {
          return { success: true };
        }

        const err = result.error || 'Unknown error';
        if (this.isTerminalTelegramError(err)) {
          console.warn(`[Trace:${traceId}] [TELEGRAM] Terminal error detected (${err}), aborting retries.`);
          return { success: false, error: err };
        }

        if (attempt < maxRetries) {
          const delay = backoffs[attempt] || 3000;
          console.warn(`[Trace:${traceId}] [TELEGRAM] Transient failure: ${err}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          return { success: false, error: err };
        }
      } catch (err: any) {
        const msg = err?.message || 'Network error';
        if (attempt < maxRetries) {
          const delay = backoffs[attempt] || 3000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          return { success: false, error: msg };
        }
      }
    }

    return { success: false, error: 'Maximum retries exceeded' };
  }

  private isTerminalTelegramError(error: string): boolean {
    const err = error.toLowerCase();
    return (
      err.includes('blocked by the user') ||
      err.includes('chat not found') ||
      err.includes('unauthorized') ||
      err.includes('invalid token') ||
      err.includes("can't send messages to the bot") ||
      err.includes('user is deactivated') ||
      err.includes('not a member')
    );
  }

  private formatFallbackTelegramMessage(event: NotificationEvent): string {
    const sym = event.symbol.toUpperCase();
    const ex = event.exchange.toUpperCase();
    const mkt = event.marketType.toUpperCase();
    const timeStr = new Date().toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv' });

    return `🚨 <b>SIGNALHOOK ALERT</b>\n\n` +
      `🪙 <b>#${sym}</b> (${ex} ${mkt})\n` +
      `📌 <b>${event.title}</b>\n` +
      `💵 <b>Ціна:</b> $${event.price}\n` +
      `📝 ${event.description}\n` +
      (event.timeframe ? `⏱ <b>Timeframe:</b> ${event.timeframe.toUpperCase()}\n` : '') +
      `\n⏰ <i>${timeStr} (Київ)</i>`;
  }

  private pushClientBuffer(userId: string, record: NotificationHistoryRecord) {
    const uid = userId || 'guest';
    const current = this.clientNotificationBuffer.get(uid) || [];
    current.unshift(record);
    if (current.length > 200) current.pop();
    this.clientNotificationBuffer.set(uid, current);
  }

  /**
   * Get recent notifications for client browser delivery / polling
   */
  public getClientNotifications(userId?: string, sinceTimestamp = 0): NotificationHistoryRecord[] {
    const uid = userId || 'guest';
    const list = this.clientNotificationBuffer.get(uid) || [];
    if (sinceTimestamp > 0) {
      return list.filter((r) => r.createdAt > sinceTimestamp);
    }
    return list.slice(0, 50);
  }

  /**
   * Return complete notification history
   */
  public getHistory(userId?: string): NotificationHistoryRecord[] {
    this.loadPersistedHistory();
    if (!userId || userId === 'all') {
      return this.historyCache;
    }
    return this.historyCache.filter((h) => h.userId === userId);
  }

  /**
   * Reset cooldown for testing or explicit user reset
   */
  public resetCooldown(eventKey?: string) {
    if (eventKey) {
      this.lastDispatchTimestamps.delete(eventKey);
      this.recentDetections.delete(eventKey);
    } else {
      this.lastDispatchTimestamps.clear();
      this.recentDetections.clear();
    }
  }

  /**
   * Diagnostics status for health and statistics
   */
  public getDiagnostics() {
    return {
      activeCooldownsCount: this.lastDispatchTimestamps.size,
      recentDetectionsCount: this.recentDetections.size,
      totalHistoryRecords: this.historyCache.length,
      bufferedUsersCount: this.clientNotificationBuffer.size,
    };
  }
}

export const notificationRouter = NotificationRouter.getInstance();
