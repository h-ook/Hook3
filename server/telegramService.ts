import fs from 'fs';
import path from 'path';

export interface TelegramConfigFile {
  botToken?: string;
  chatId?: string;
}

export interface UserTelegramData {
  botToken?: string;
  chatId?: string;
  updatedAt?: string;
}

export interface EffectiveTelegramConfig {
  botToken: string;
  chatId: string;
  source: 'user' | 'env' | 'global' | 'none';
  hasEnvToken: boolean;
  hasEnvChatId: boolean;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const GLOBAL_CONFIG_FILE = path.join(DATA_DIR, 'telegram_config.json');
const USER_TELEGRAM_FILE = path.join(DATA_DIR, 'user_telegram.json');

let globalMemoryConfig: TelegramConfigFile = {};
let isGlobalConfigLoaded = false;

let userTelegramMap = new Map<string, UserTelegramData>();
let isUserTelegramLoaded = false;

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
      console.error('Failed to create server/data directory:', e);
    }
  }
}

// --- User-Scoped Telegram Persistence ---
// Keeps each user's credentials isolated in server/data/user_telegram.json
export function loadUserTelegram(): Map<string, UserTelegramData> {
  if (isUserTelegramLoaded) return userTelegramMap;
  try {
    ensureDataDir();
    if (fs.existsSync(USER_TELEGRAM_FILE)) {
      const raw = fs.readFileSync(USER_TELEGRAM_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        userTelegramMap = new Map(Object.entries(parsed));
      }
    }
  } catch (err) {
    console.error('Failed to read user_telegram.json:', err);
  }
  isUserTelegramLoaded = true;
  return userTelegramMap;
}

export function saveUserTelegram(userId: string, creds: { botToken?: string; chatId?: string }): void {
  if (!userId || userId === 'guest') return;
  loadUserTelegram();
  const existing = userTelegramMap.get(userId) || {};
  const updated: UserTelegramData = {
    botToken: creds.botToken && creds.botToken.trim() ? creds.botToken.trim() : existing.botToken,
    chatId: creds.chatId && creds.chatId.trim() ? creds.chatId.trim() : existing.chatId,
    updatedAt: new Date().toISOString(),
  };
  userTelegramMap.set(userId, updated);
  try {
    ensureDataDir();
    const obj = Object.fromEntries(userTelegramMap.entries());
    fs.writeFileSync(USER_TELEGRAM_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    console.log(`[Telegram] User-scoped credentials updated for user: ${userId}`);
  } catch (err) {
    console.error('Failed to save user_telegram.json:', err);
  }
}

export function getUserTelegram(userId?: string): UserTelegramData | undefined {
  if (!userId || userId === 'guest') return undefined;
  loadUserTelegram();
  return userTelegramMap.get(userId);
}

// --- Global / System Telegram Persistence (Legacy / Fallback) ---
// Used only for system-wide fallback or unauthenticated / guest alerts.
// MUST NOT be overwritten when an authenticated user saves their private credentials.
function loadSavedConfig(): TelegramConfigFile {
  if (isGlobalConfigLoaded && (globalMemoryConfig.botToken || globalMemoryConfig.chatId)) {
    return globalMemoryConfig;
  }
  try {
    ensureDataDir();
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      const raw = fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8');
      globalMemoryConfig = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to read telegram_config.json:', err);
  }
  isGlobalConfigLoaded = true;
  return globalMemoryConfig;
}

export function saveTelegramConfig(config: TelegramConfigFile): boolean {
  try {
    ensureDataDir();
    const existing = loadSavedConfig();
    const updated: TelegramConfigFile = {
      botToken: config.botToken && config.botToken.trim() !== '' ? config.botToken.trim() : existing.botToken,
      chatId: config.chatId && config.chatId.trim() !== '' ? config.chatId.trim() : existing.chatId,
    };
    globalMemoryConfig = updated;
    isGlobalConfigLoaded = true;
    fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    console.log('[Telegram] Global system config updated.');
    return true;
  } catch (err) {
    console.error('Failed to save telegram_config.json:', err);
    return false;
  }
}

/**
 * Single Unified Telegram Configuration Layer
 *
 * Priority order:
 * 1. User-scoped configuration (if userId is provided and has credentials)
 * 2. Environment variables (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
 * 3. Global system configuration (telegram_config.json)
 *
 * This completely prevents User A's credentials from overwriting User B's,
 * while allowing Price Alerts, Surveillance, CRON, and manual tests to use
 * the exact same configuration resolver.
 */
export function getEffectiveTelegramConfig(userId?: string): EffectiveTelegramConfig {
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const envChatId = process.env.TELEGRAM_CHAT_ID?.trim() || '';
  const hasEnvToken = Boolean(envToken);
  const hasEnvChatId = Boolean(envChatId);

  // 1. Check User-scoped credentials
  if (userId && userId !== 'guest') {
    const userTg = getUserTelegram(userId);
    if (userTg?.botToken && userTg?.chatId) {
      return {
        botToken: userTg.botToken.trim(),
        chatId: userTg.chatId.trim(),
        source: 'user',
        hasEnvToken,
        hasEnvChatId,
      };
    }
  }

  // 2. Check Environment variables
  if (envToken && envChatId) {
    return {
      botToken: envToken,
      chatId: envChatId,
      source: 'env',
      hasEnvToken,
      hasEnvChatId,
    };
  }

  // 3. Check Global configuration fallback
  const globalSaved = loadSavedConfig();
  const globalToken = globalSaved.botToken?.trim() || envToken;
  const globalChat = globalSaved.chatId?.trim() || envChatId;

  if (globalToken && globalChat) {
    return {
      botToken: globalToken,
      chatId: globalChat,
      source: 'global',
      hasEnvToken,
      hasEnvChatId,
    };
  }

  return {
    botToken: globalToken || '',
    chatId: globalChat || '',
    source: 'none',
    hasEnvToken,
    hasEnvChatId,
  };
}

// Check Telegram Bot Info
export async function getTelegramBotInfo(token?: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  const effectiveToken = token || getEffectiveTelegramConfig().botToken;
  if (!effectiveToken) {
    return { ok: false, error: 'Bot Token не вказано' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${effectiveToken}/getMe`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data.ok && data.result) {
      return { ok: true, username: data.result.username };
    }
    return { ok: false, error: data.description || 'Невірний токен Telegram бота' };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Помилка з\'єднання з Telegram API' };
  }
}

// Human-friendly Telegram error translator
export function formatTelegramErrorMessage(rawError: string, botUsername?: string, botId?: string, targetChatId?: string): string {
  const err = rawError.toLowerCase();

  if (err.includes("can't send messages to the bot") || err.includes("can't send message to bot") || (botId && targetChatId && botId === targetChatId)) {
    return `❌ Помилка: Ви вказали ID самого бота замість вашого особистого Chat ID!\n` +
      `Бот не може писати самому собі або іншим ботам.\n\n` +
      `👉 Як виправити:\n` +
      `1. Відкрийте чат з ботом${botUsername ? ` @${botUsername}` : ''} та натисніть «START»\n` +
      `2. Скористайтеся кнопкою «⚡ Автоматично знайти мій Chat ID» або відкрийте @userinfobot щоб дізнатися ваш особистий ID`;
  }

  if (err.includes('bot was blocked by the user')) {
    return `❌ Бот заблокований у вашому Telegram!\n` +
      `Відкрийте діалог з ботом${botUsername ? ` @${botUsername}` : ''} і натисніть «Розблокувати» або /start.`;
  }

  if (err.includes('chat not found')) {
    return `❌ Чат не знайдено!\n` +
      `Telegram забороняє ботам писати першими. Перейдіть у чат з ботом${botUsername ? ` @${botUsername}` : ''}, натисніть «START» (/start) та перевірте правильність Chat ID.`;
  }

  if (err.includes('unauthorized') || err.includes('invalid token')) {
    return `❌ Невірний Bot Token!\n` +
      `Перевірте токен бота, наданий @BotFather (має формат 123456789:ABCdef...).`;
  }

  return rawError;
}

// Send Telegram Message with automatic HTML error fallback
export async function sendTelegramMessage(
  text: string,
  options?: { botToken?: string; chatId?: string; parseMode?: 'HTML' | 'Markdown' }
): Promise<{ success: boolean; error?: string }> {
  const config = getEffectiveTelegramConfig();
  const botToken = options?.botToken || config.botToken;
  const chatId = options?.chatId || config.chatId;

  if (!botToken || !chatId) {
    const msg = 'Telegram не налаштовано: відсутній Bot Token або Chat ID';
    console.warn('[Telegram]', msg);
    return { success: false, error: msg };
  }

  // Pre-check: Did the user enter the bot's own ID as the chat_id?
  const botIdFromToken = botToken.split(':')[0]?.trim();
  if (botIdFromToken && chatId.trim() === botIdFromToken) {
    const friendlyError = formatTelegramErrorMessage("the bot can't send messages to the bot", undefined, botIdFromToken, chatId.trim());
    return { success: false, error: friendlyError };
  }

  try {
    console.log(`[Telegram] Sending notification to chat ${chatId}...`);
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options?.parseMode || 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    if (data.ok) {
      console.log(`[Telegram] Successfully sent message to chat ${chatId}`);
      return { success: true };
    }

    // Fallback: If Telegram rejected due to HTML parse entities, retry as plain text!
    if (data.description && (data.description.includes('can\'t parse entities') || data.description.includes('entity'))) {
      console.warn('[Telegram] HTML parsing failed, retrying as plain text without tags...');
      const plainText = text.replace(/<[^>]*>?/gm, '');
      const retryRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: plainText,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const retryData = await retryRes.json();
      if (retryData.ok) {
        console.log(`[Telegram] Fallback plain-text message sent successfully to chat ${chatId}`);
        return { success: true };
      }
    }

    console.error('[Telegram] Telegram API rejected message:', data.description);
    const friendlyErr = formatTelegramErrorMessage(data.description || 'Telegram відхилив повідомлення', undefined, botIdFromToken, chatId.trim());
    return { success: false, error: friendlyErr };
  } catch (err: any) {
    console.error('[Telegram] Error sending telegram message:', err);
    return { success: false, error: err.message || 'Не вдалося надіслати запит до Telegram' };
  }
}

// Auto-detect user Chat ID from incoming messages/updates
export async function detectChatIdFromUpdates(token?: string): Promise<{
  success: boolean;
  chatId?: string;
  username?: string;
  firstName?: string;
  botUsername?: string;
  error?: string;
}> {
  const config = getEffectiveTelegramConfig();
  const effectiveToken = token?.trim() || config.botToken;
  if (!effectiveToken) {
    return { success: false, error: 'Введіть спочатку Bot Token' };
  }

  const botInfo = await getTelegramBotInfo(effectiveToken);
  if (!botInfo.ok) {
    return { success: false, error: botInfo.error || 'Невірний Bot Token' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${effectiveToken}/getUpdates?limit=100&allowed_updates=["message","channel_post","callback_query"]`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!data.ok) {
      return {
        success: false,
        botUsername: botInfo.username,
        error: data.description || 'Не вдалося отримати оновлення від Telegram',
      };
    }

    const updates = Array.isArray(data.result) ? data.result : [];
    const botIdFromToken = effectiveToken.split(':')[0]?.trim();

    // Loop backwards to get the most recent message from a human user
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const msg = u.message || u.edited_message || u.channel_post || u.callback_query?.message;
      const from = u.message?.from || u.callback_query?.from || msg?.from;
      const chat = msg?.chat;

      if (chat && chat.id) {
        // Skip if sender is a bot or matches the bot's own ID
        if (from?.is_bot || (botIdFromToken && String(chat.id) === botIdFromToken)) {
          continue;
        }

        return {
          success: true,
          chatId: String(chat.id),
          username: from?.username || chat.username,
          firstName: from?.first_name || chat.first_name || chat.title,
          botUsername: botInfo.username,
        };
      }
    }

    return {
      success: false,
      botUsername: botInfo.username,
      error: `Повідомлень у боті не знайдено. Перейдіть у Telegram у чат з ботом @${botInfo.username}, натисніть кнопку START (або надішліть будь-який текст), після чого натисніть цю кнопку ще раз!`,
    };
  } catch (err: any) {
    return {
      success: false,
      botUsername: botInfo.username,
      error: err.message || 'Помилка звернення до Telegram API',
    };
  }
}

// Test Telegram notification & auto-save on success (scoped to user if userId provided)
export async function testTelegramConnection(
  token?: string,
  chatId?: string,
  userId?: string
): Promise<{ success: boolean; botUsername?: string; error?: string }> {
  const config = getEffectiveTelegramConfig(userId);
  const activeToken = token?.trim() || config.botToken;
  const activeChatId = chatId?.trim() || config.chatId;

  if (!activeToken) {
    return { success: false, error: 'Вкажіть Bot Token для тесту' };
  }
  if (!activeChatId) {
    return { success: false, error: 'Вкажіть Chat ID для тесту' };
  }

  // 1. Check Bot validity
  const botInfo = await getTelegramBotInfo(activeToken);
  if (!botInfo.ok) {
    return { success: false, error: botInfo.error };
  }

  // 2. Pre-check: Bot ID vs Chat ID
  const botIdFromToken = activeToken.split(':')[0]?.trim();
  if (botIdFromToken && activeChatId === botIdFromToken) {
    return {
      success: false,
      botUsername: botInfo.username,
      error: formatTelegramErrorMessage("the bot can't send messages to the bot", botInfo.username, botIdFromToken, activeChatId),
    };
  }

  // 3. Send test message
  const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  const testMessage = `🔔 <b>SIGNALHOOK: ТЕСТ ПІДКЛЮЧЕННЯ УСПІШНИЙ!</b>\n\n` +
    `🤖 Бот: <b>@${botInfo.username}</b>\n` +
    `✅ Сповіщення цін та патернів налаштовано правильно.\n` +
    `📈 Тепер ви будете отримувати миттєві сповіщення, коли ціна досягне ваших рівнів.\n\n` +
    `⏱ <i>Час тесту: ${now} (Київ)</i>`;

  const sendResult = await sendTelegramMessage(testMessage, {
    botToken: activeToken,
    chatId: activeChatId,
  });

  if (sendResult.success) {
    // Auto-save working credentials strictly scoped to user or global fallback
    if (userId && userId !== 'guest') {
      saveUserTelegram(userId, { botToken: activeToken, chatId: activeChatId });
    } else {
      saveTelegramConfig({ botToken: activeToken, chatId: activeChatId });
    }
    return { success: true, botUsername: botInfo.username };
  }

  const friendlyError = formatTelegramErrorMessage(sendResult.error || 'Помилка надсилання', botInfo.username, botIdFromToken, activeChatId);
  return { success: false, botUsername: botInfo.username, error: friendlyError };
}
