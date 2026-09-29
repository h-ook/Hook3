import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Mail,
  Send,
  Sliders,
  Bell,
  LogOut,
  Save,
  CheckCircle2,
  AlertCircle,
  Key,
  MessageSquare,
  Sparkles,
  ExternalLink,
  Shield,
  FolderArchive,
  Lock,
  Eye,
  EyeOff,
  Zap,
  RefreshCw,
  Wallet,
  Check,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAlerts } from '../context/AlertsContext';
import { useArchive } from '../context/ArchiveContext';
import { ExchangeId, MarketType, Timeframe, ExchangeApiCredentials } from '../types';
import { saveStoredPreferences } from '../utils/userPreferences';
import {
  testExchangeApiKeys,
  getLocalExchangeCredentials,
  saveLocalExchangeCredentials,
  removeLocalExchangeCredentials,
} from '../utils/exchangeTradingClient';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAlerts?: () => void;
  onOpenArchive?: () => void;
  initialTab?: 'general' | 'exchange_api';
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  onOpenAlerts,
  onOpenArchive,
  initialTab = 'general',
}) => {
  const { user, profile, updateProfileData, logout } = useAuth();
  const { alerts, activeAlertsCount } = useAlerts();
  const { archiveCount } = useArchive();

  const [activeTab, setActiveTab] = useState<'general' | 'exchange_api'>(initialTab);

  // General profile state
  const [displayName, setDisplayName] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [defaultExchange, setDefaultExchange] = useState<'all' | ExchangeId>('all');
  const [defaultMarketType, setDefaultMarketType] = useState<'all' | MarketType>('all');
  const [defaultTimeframe, setDefaultTimeframe] = useState<Timeframe>('1h');
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(true);

  // Exchange API keys state
  const [selectedExchange, setSelectedExchange] = useState<ExchangeId>('binance');

  // Binance fields
  const [binanceKey, setBinanceKey] = useState('');
  const [binanceSecret, setBinanceSecret] = useState('');
  const [binanceMarketType, setBinanceMarketType] = useState<MarketType>('futures');
  const [binanceIsTestnet, setBinanceIsTestnet] = useState(false);
  const [binanceEnabled, setBinanceEnabled] = useState(true);
  const [showBinanceSecret, setShowBinanceSecret] = useState(false);

  // Bybit fields
  const [bybitKey, setBybitKey] = useState('');
  const [bybitSecret, setBybitSecret] = useState('');
  const [bybitMarketType, setBybitMarketType] = useState<MarketType>('futures');
  const [bybitIsTestnet, setBybitIsTestnet] = useState(false);
  const [bybitEnabled, setBybitEnabled] = useState(true);
  const [showBybitSecret, setShowBybitSecret] = useState(false);

  // Testing & Status
  const [isTestingExchange, setIsTestingExchange] = useState(false);
  const [exchangeTestStatus, setExchangeTestStatus] = useState<{
    [key in ExchangeId]?: {
      success: boolean;
      message: string;
      balance?: number;
      testedAt?: number;
    };
  }>({});

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Telegram test & auto-detect state
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isDetectingChatId, setIsDetectingChatId] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || user?.displayName || '');
      setTelegramBotToken(profile.telegramBotToken || '');
      setTelegramChatId(profile.telegramChatId || '');
      setDefaultExchange(profile.defaultExchange || 'all');
      setDefaultMarketType(profile.defaultMarketType || 'all');
      setDefaultTimeframe(profile.defaultTimeframe || '1h');
      setSoundAlertsEnabled(profile.soundAlertsEnabled !== undefined ? profile.soundAlertsEnabled : true);

      // Load Binance credentials
      const savedBinance = profile.exchangeApiKeys?.binance || getLocalExchangeCredentials('binance');
      if (savedBinance) {
        setBinanceKey(savedBinance.apiKey || '');
        setBinanceSecret(savedBinance.apiSecret || '');
        setBinanceMarketType(savedBinance.marketType || 'futures');
        setBinanceIsTestnet(!!savedBinance.isTestnet);
        setBinanceEnabled(savedBinance.enabled !== false);
        if (savedBinance.lastTestStatus) {
          setExchangeTestStatus((prev) => ({
            ...prev,
            binance: {
              success: savedBinance.lastTestStatus === 'success',
              message: savedBinance.lastTestMessage || 'Збережено',
              testedAt: savedBinance.lastTestedAt,
            },
          }));
        }
      }

      // Load Bybit credentials
      const savedBybit = profile.exchangeApiKeys?.bybit || getLocalExchangeCredentials('bybit');
      if (savedBybit) {
        setBybitKey(savedBybit.apiKey || '');
        setBybitSecret(savedBybit.apiSecret || '');
        setBybitMarketType(savedBybit.marketType || 'futures');
        setBybitIsTestnet(!!savedBybit.isTestnet);
        setBybitEnabled(savedBybit.enabled !== false);
        if (savedBybit.lastTestStatus) {
          setExchangeTestStatus((prev) => ({
            ...prev,
            bybit: {
              success: savedBybit.lastTestStatus === 'success',
              message: savedBybit.lastTestMessage || 'Збережено',
              testedAt: savedBybit.lastTestedAt,
            },
          }));
        }
      }
    } else {
      // Local fallbacks if profile not yet loaded
      const savedBinance = getLocalExchangeCredentials('binance');
      if (savedBinance) {
        setBinanceKey(savedBinance.apiKey || '');
        setBinanceSecret(savedBinance.apiSecret || '');
        setBinanceMarketType(savedBinance.marketType || 'futures');
        setBinanceIsTestnet(!!savedBinance.isTestnet);
        setBinanceEnabled(savedBinance.enabled !== false);
      }
      const savedBybit = getLocalExchangeCredentials('bybit');
      if (savedBybit) {
        setBybitKey(savedBybit.apiKey || '');
        setBybitSecret(savedBybit.apiSecret || '');
        setBybitMarketType(savedBybit.marketType || 'futures');
        setBybitIsTestnet(!!savedBybit.isTestnet);
        setBybitEnabled(savedBybit.enabled !== false);
      }
    }
  }, [profile, user]);

  if (!isOpen || !user) return null;

  // Test Exchange API connection
  const handleTestExchangeConnection = async (exchangeId: ExchangeId) => {
    setIsTestingExchange(true);
    setErrorMessage(null);

    const creds: ExchangeApiCredentials =
      exchangeId === 'binance'
        ? {
            exchange: 'binance',
            apiKey: binanceKey.trim(),
            apiSecret: binanceSecret.trim(),
            marketType: binanceMarketType,
            isTestnet: binanceIsTestnet,
            enabled: binanceEnabled,
          }
        : {
            exchange: 'bybit',
            apiKey: bybitKey.trim(),
            apiSecret: bybitSecret.trim(),
            marketType: bybitMarketType,
            isTestnet: bybitIsTestnet,
            enabled: bybitEnabled,
          };

    if (!creds.apiKey || !creds.apiSecret) {
      setErrorMessage(`Введіть API Key та Secret Key для ${exchangeId === 'binance' ? 'Binance' : 'Bybit'}`);
      setIsTestingExchange(false);
      return;
    }

    try {
      const result = await testExchangeApiKeys(creds);
      setExchangeTestStatus((prev) => ({
        ...prev,
        [exchangeId]: {
          success: result.success,
          message: result.message,
          balance: result.balance?.availableBalance,
          testedAt: Date.now(),
        },
      }));
    } catch (err: any) {
      setExchangeTestStatus((prev) => ({
        ...prev,
        [exchangeId]: {
          success: false,
          message: `Помилка: ${err?.message || err}`,
          testedAt: Date.now(),
        },
      }));
    } finally {
      setIsTestingExchange(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    setSaveSuccess(false);

    try {
      // Build exchange API credentials
      const exchangeApiKeys: Partial<Record<ExchangeId, ExchangeApiCredentials>> = {};

      if (binanceKey.trim() && binanceSecret.trim()) {
        const binanceCreds: ExchangeApiCredentials = {
          exchange: 'binance',
          apiKey: binanceKey.trim(),
          apiSecret: binanceSecret.trim(),
          marketType: binanceMarketType,
          isTestnet: binanceIsTestnet,
          enabled: binanceEnabled,
          lastTestedAt: exchangeTestStatus.binance?.testedAt || Date.now(),
          lastTestStatus: exchangeTestStatus.binance?.success ? 'success' : 'error',
          lastTestMessage: exchangeTestStatus.binance?.message,
        };
        exchangeApiKeys.binance = binanceCreds;
        saveLocalExchangeCredentials(binanceCreds);
      } else {
        removeLocalExchangeCredentials('binance');
      }

      if (bybitKey.trim() && bybitSecret.trim()) {
        const bybitCreds: ExchangeApiCredentials = {
          exchange: 'bybit',
          apiKey: bybitKey.trim(),
          apiSecret: bybitSecret.trim(),
          marketType: bybitMarketType,
          isTestnet: bybitIsTestnet,
          enabled: bybitEnabled,
          lastTestedAt: exchangeTestStatus.bybit?.testedAt || Date.now(),
          lastTestStatus: exchangeTestStatus.bybit?.success ? 'success' : 'error',
          lastTestMessage: exchangeTestStatus.bybit?.message,
        };
        exchangeApiKeys.bybit = bybitCreds;
        saveLocalExchangeCredentials(bybitCreds);
      } else {
        removeLocalExchangeCredentials('bybit');
      }

      await updateProfileData({
        displayName: displayName.trim() || user.email?.split('@')[0] || 'Користувач',
        telegramBotToken: telegramBotToken.trim(),
        telegramChatId: telegramChatId.trim(),
        defaultExchange,
        defaultMarketType,
        defaultTimeframe,
        soundAlertsEnabled,
        exchangeApiKeys,
      });

      saveStoredPreferences({
        defaultExchange,
        defaultMarketType,
        defaultTimeframe,
        soundAlertsEnabled,
      });

      // Notify other components like ScalperDOMWidget
      window.dispatchEvent(
        new CustomEvent('exchange_credentials_updated', {
          detail: { exchangeApiKeys },
        })
      );

      // Sync alerts with backend
      fetch('/api/alerts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          telegramBotToken: telegramBotToken.trim(),
          telegramChatId: telegramChatId.trim(),
          alerts,
        }),
      }).catch(() => {});

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Не вдалося зберегти профіль');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoDetectChatId = async () => {
    const cleanToken = telegramBotToken.trim();
    if (!cleanToken) {
      setErrorMessage('Спочатку введіть Bot Token вашого Telegram бота');
      return;
    }

    setIsDetectingChatId(true);
    setErrorMessage(null);
    setTestResult(null);

    try {
      const res = await fetch('/api/telegram/detect-chat-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: cleanToken }),
      });
      const data = await res.json();
      if (data.success && data.chatId) {
        setTelegramChatId(String(data.chatId));
        setTestResult({
          success: true,
          message: `✅ Знайдено Chat ID: ${data.chatId}${data.username ? ` (@${data.username})` : ''}`,
        });
      } else {
        setErrorMessage(
          data.error ||
            'Не знайдено активних повідомлень. Відкрийте бота в Telegram, натисніть START або надішліть будь-яке повідомлення і повторіть пошук.'
        );
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Помилка виявлення Chat ID');
    } finally {
      setIsDetectingChatId(false);
    }
  };

  const handleSendTestNotification = async () => {
    const cleanToken = telegramBotToken.trim();
    const cleanChatId = telegramChatId.trim();

    if (!cleanToken || !cleanChatId) {
      setErrorMessage('Введіть і збережіть Bot Token та Chat ID перед тестуванням');
      return;
    }

    setIsTestingTelegram(true);
    setErrorMessage(null);
    setTestResult(null);

    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: cleanToken,
          chatId: cleanChatId,
          customMessage: `🔔 Привіт, ${displayName || 'Трейдер'}!\nЦе тестове сповіщення з вашого особистого профілю SignalHook.\nВсі налаштування збережено!`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          message: '✅ Тестове сповіщення успішно надіслано у ваш Telegram чат!',
        });
      } else {
        setErrorMessage(data.error || 'Не вдалося доставити тестове повідомлення');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Помилка надсилання тестового сповіщення');
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    onClose();
  };

  const initialLetter = (displayName || user.email || 'U')[0].toUpperCase();
  const hasConnectedExchanges = Boolean((binanceKey && binanceSecret) || (bybitKey && bybitSecret));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl shadow-cyan-950/20 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-800/80 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-cyan-950/30">
              {initialLetter}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wide">
                  {displayName || 'Особистий профіль'}
                </h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  ПРОФІЛЬ
                </span>
                {hasConnectedExchanges && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>API АКТИВНО</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 pt-3 border-b border-slate-800 bg-slate-950/30 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'general'
                ? 'text-cyan-400 border-cyan-400 bg-slate-900/60'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Загальні & Сповіщення</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('exchange_api')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'exchange_api'
                ? 'text-amber-400 border-amber-400 bg-slate-900/60'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Підключення бірж (API ключі)</span>
            {hasConnectedExchanges && (
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            )}
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
          {/* Feedback messages */}
          {saveSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Зміни профілю та API-ключі успішно збережено!</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2 animate-in fade-in ${
                testResult.success
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{testResult.message}</span>
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-5">
            {activeTab === 'general' ? (
              <>
                {/* Quick Metrics Bar */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                  <div
                    onClick={() => {
                      onClose();
                      onOpenAlerts?.();
                    }}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-slate-700 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Мої сповіщення</span>
                      <Bell className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-xl font-bold font-mono text-white">
                        {alerts.length}
                      </span>
                      <span className="text-[11px] text-emerald-400">
                        ({activeAlertsCount} активних)
                      </span>
                    </div>
                  </div>

                  <div
                    onClick={() => {
                      onClose();
                      onOpenArchive?.();
                    }}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-purple-500/50 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Архів формацій</span>
                      <FolderArchive className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-xl font-bold font-mono text-white">
                        {archiveCount}
                      </span>
                      <span className="text-[11px] text-purple-400">збережено</span>
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveTab('exchange_api')}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-amber-500/50 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Торгові API</span>
                      <Key className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {hasConnectedExchanges ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          <span className="text-xs font-semibold text-emerald-400">
                            Біржі підключено
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-amber-400" />
                          <span className="text-xs font-semibold text-amber-400">
                            Налаштувати API
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 1: User Identity */}
                <div className="space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Дані профілю</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Ім'я або нікнейм
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Ваш позивний трейдера"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Електронна пошта
                      </label>
                      <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2 text-xs text-slate-400">
                        <Mail className="w-3.5 h-3.5 text-slate-500" />
                        <span className="truncate">{user.email}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 2: Telegram Notifications */}
                <div className="space-y-3 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-sky-400" />
                      <span>Індивідуальні Telegram-сповіщення</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Цілодобовий моніторинг
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Telegram Bot Token
                      </label>
                      <input
                        type="password"
                        value={telegramBotToken}
                        onChange={(e) => setTelegramBotToken(e.target.value)}
                        placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-sky-500 transition-colors"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-300">
                          Telegram Chat ID
                        </label>
                        <button
                          type="button"
                          onClick={handleAutoDetectChatId}
                          disabled={isDetectingChatId || !telegramBotToken.trim()}
                          className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                        >
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>{isDetectingChatId ? 'Пошук...' : 'Знайти автоматично'}</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={telegramChatId}
                        onChange={(e) => setTelegramChatId(e.target.value)}
                        placeholder="987654321"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-sky-500 transition-colors"
                      />
                    </div>
                  </div>

                  {telegramBotToken && telegramChatId && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={handleSendTestNotification}
                        disabled={isTestingTelegram}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 text-xs font-semibold transition-colors border border-sky-500/30 disabled:opacity-50 cursor-pointer"
                      >
                        <Send className="w-3 h-3" />
                        <span>{isTestingTelegram ? 'Надсилання...' : 'Надіслати тестове сповіщення'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Section 3: Preferences */}
                <div className="space-y-3 pt-2 border-t border-slate-800/80">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Параметри терміналу за замовчуванням</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Біржа за замовчуванням
                      </label>
                      <select
                        value={defaultExchange}
                        onChange={(e) => setDefaultExchange(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                      >
                        <option value="all">Всі біржі</option>
                        <option value="binance">Binance</option>
                        <option value="bybit">Bybit</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Ринок за замовчуванням
                      </label>
                      <select
                        value={defaultMarketType}
                        onChange={(e) => setDefaultMarketType(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                      >
                        <option value="all">Всі ринки</option>
                        <option value="futures">Ф'ючерси (Futures)</option>
                        <option value="spot">Спот (Spot)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Таймфрейм за замовчуванням
                      </label>
                      <select
                        value={defaultTimeframe}
                        onChange={(e) => setDefaultTimeframe(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                      >
                        <option value="5m">5 хвилин</option>
                        <option value="15m">15 хвилин</option>
                        <option value="1h">1 година</option>
                        <option value="4h">4 години</option>
                        <option value="1d">1 день</option>
                      </select>
                    </div>
                  </div>

                  {/* Sound toggle */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <Bell className="w-4 h-4 text-cyan-400" />
                      <div>
                        <span className="text-xs font-semibold text-white block">
                          Звукові сповіщення в браузері
                        </span>
                        <span className="text-[11px] text-slate-400 block">
                          Відтворювати звуковий сигнал при спрацюванні алерту
                        </span>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={soundAlertsEnabled}
                      onChange={(e) => setSoundAlertsEnabled(e.target.checked)}
                      className="w-4 h-4 rounded text-cyan-500 focus:ring-0 bg-slate-900 border-slate-700 cursor-pointer"
                    />
                  </div>
                </div>
              </>
            ) : (
              /* ================= EXCHANGE API KEYS TAB ================= */
              <div className="space-y-4">
                {/* Security info banner */}
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200/90 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <Shield className="w-4 h-4" />
                    <span>Безпека API ключів для торгівлі у стакані</span>
                  </div>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    Підключення API ключів дозволяє надсилати <strong>реальні заявки</strong> (лімітні, ринкові, стоп-лос, тейк-профіт) прямо зі стакану заявок (Scalper DOM).
                    Створюйте API-ключі з правами <strong>тільки на читання (Read) та торгівлю (Futures/Trade)</strong>. 
                    <span className="underline font-bold text-amber-200 ml-1">НІКОЛИ не вмикайте дозвіл на виведення коштів (Withdrawal)!</span>
                  </p>
                </div>

                {/* Exchange sub-selector */}
                <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSelectedExchange('binance')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      selectedExchange === 'binance'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span>Binance</span>
                    {binanceKey && binanceSecret && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        Підключено
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedExchange('bybit')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      selectedExchange === 'bybit'
                        ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-orange-400" />
                    <span>Bybit V5</span>
                    {bybitKey && bybitSecret && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        Підключено
                      </span>
                    )}
                  </button>
                </div>

                {/* BINANCE CONFIGURATION */}
                {selectedExchange === 'binance' && (
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">Налаштування Binance API</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                          HMAC-SHA256
                        </span>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={binanceEnabled}
                          onChange={(e) => setBinanceEnabled(e.target.checked)}
                          className="w-4 h-4 rounded text-amber-500 bg-slate-900 border-slate-700 cursor-pointer"
                        />
                        <span>Увімкнено для торгівлі</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Binance API Key
                      </label>
                      <input
                        type="text"
                        value={binanceKey}
                        onChange={(e) => setBinanceKey(e.target.value)}
                        placeholder="Вставте ваш Binance API Key"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-amber-500 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Binance Secret Key
                      </label>
                      <div className="relative">
                        <input
                          type={showBinanceSecret ? 'text' : 'password'}
                          value={binanceSecret}
                          onChange={(e) => setBinanceSecret(e.target.value)}
                          placeholder="Вставте ваш Binance Secret Key"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-3 pr-10 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-amber-500 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBinanceSecret(!showBinanceSecret)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                        >
                          {showBinanceSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Тип ринку для ордерів
                        </label>
                        <select
                          value={binanceMarketType}
                          onChange={(e) => setBinanceMarketType(e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                        >
                          <option value="futures">USDT-M Ф'ючерси (fapi.binance.com)</option>
                          <option value="spot">Спотовий ринок (api.binance.com)</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 mt-auto">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-white">Режим Testnet</span>
                          <span className="text-[10px] text-slate-400">Демо-мережа Binance</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={binanceIsTestnet}
                          onChange={(e) => setBinanceIsTestnet(e.target.checked)}
                          className="w-4 h-4 rounded text-amber-500 bg-slate-800 border-slate-700 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Test connection & balance feedback */}
                    <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => handleTestExchangeConnection('binance')}
                        disabled={isTestingExchange || !binanceKey.trim() || !binanceSecret.trim()}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition-all disabled:opacity-40 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isTestingExchange ? 'animate-spin' : ''}`} />
                        <span>{isTestingExchange ? 'Перевірка з’єднання...' : 'Перевірити з’єднання та баланс'}</span>
                      </button>

                      {exchangeTestStatus.binance && (
                        <div className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 ${
                          exchangeTestStatus.binance.success
                            ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-300'
                            : 'bg-rose-950/60 border-rose-600/60 text-rose-300'
                        }`}>
                          {exchangeTestStatus.binance.success ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          )}
                          <span className="truncate max-w-xs">{exchangeTestStatus.binance.message}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* BYBIT CONFIGURATION */}
                {selectedExchange === 'bybit' && (
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">Налаштування Bybit V5 API</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                          Unified Account V5
                        </span>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bybitEnabled}
                          onChange={(e) => setBybitEnabled(e.target.checked)}
                          className="w-4 h-4 rounded text-orange-500 bg-slate-900 border-slate-700 cursor-pointer"
                        />
                        <span>Увімкнено для торгівлі</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Bybit API Key
                      </label>
                      <input
                        type="text"
                        value={bybitKey}
                        onChange={(e) => setBybitKey(e.target.value)}
                        placeholder="Вставте ваш Bybit API Key"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-orange-500 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Bybit API Secret
                      </label>
                      <div className="relative">
                        <input
                          type={showBybitSecret ? 'text' : 'password'}
                          value={bybitSecret}
                          onChange={(e) => setBybitSecret(e.target.value)}
                          placeholder="Вставте ваш Bybit API Secret"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-3 pr-10 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-orange-500 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBybitSecret(!showBybitSecret)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                        >
                          {showBybitSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Категорія Bybit
                        </label>
                        <select
                          value={bybitMarketType}
                          onChange={(e) => setBybitMarketType(e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                        >
                          <option value="futures">USDT Безстрокові (Linear Futures)</option>
                          <option value="spot">Спотовий ринок (Spot)</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 mt-auto">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-white">Режим Testnet</span>
                          <span className="text-[10px] text-slate-400">Демо-мережа Bybit</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={bybitIsTestnet}
                          onChange={(e) => setBybitIsTestnet(e.target.checked)}
                          className="w-4 h-4 rounded text-orange-500 bg-slate-800 border-slate-700 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Test connection & balance feedback */}
                    <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => handleTestExchangeConnection('bybit')}
                        disabled={isTestingExchange || !bybitKey.trim() || !bybitSecret.trim()}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 text-orange-300 text-xs font-bold transition-all disabled:opacity-40 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isTestingExchange ? 'animate-spin' : ''}`} />
                        <span>{isTestingExchange ? 'Перевірка Bybit...' : 'Перевірити з’єднання та баланс'}</span>
                      </button>

                      {exchangeTestStatus.bybit && (
                        <div className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 ${
                          exchangeTestStatus.bybit.success
                            ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-300'
                            : 'bg-rose-950/60 border-rose-600/60 text-rose-300'
                        }`}>
                          {exchangeTestStatus.bybit.success ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          )}
                          <span className="truncate max-w-xs">{exchangeTestStatus.bybit.message}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Save & Action Buttons */}
            <div className="pt-3 flex items-center justify-between gap-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900 text-slate-400 hover:text-rose-400 text-xs font-semibold transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Вийти з акаунту</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 font-semibold transition-colors cursor-pointer"
                >
                  Закрити
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/30 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Збереження...' : 'Зберегти налаштування'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
