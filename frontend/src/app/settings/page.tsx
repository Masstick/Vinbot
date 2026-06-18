'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Settings, Send, Bot, Check, AlertCircle, Info, ChevronRight, Terminal, Play, Pause } from 'lucide-react';

export default function SettingsPage() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function testTelegram() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.telegram.test();
      setTestResult(res);
    } catch {
      setTestResult({ ok: false, error: 'Impossible de joindre l\'API' });
    } finally {
      setTesting(false);
    }
  }

  // ─── Contrôle du scraper (pause / reprise persistante) ───
  const [scraperPaused, setScraperPaused] = useState<boolean | null>(null);
  const [togglingScraper, setTogglingScraper] = useState(false);

  useEffect(() => {
    api.scraper
      .status()
      .then(s => setScraperPaused(Boolean(s?.paused)))
      .catch(() => setScraperPaused(null));
  }, []);

  async function toggleScraper() {
    if (scraperPaused === null) return;
    setTogglingScraper(true);
    try {
      const res = scraperPaused ? await api.scraper.resume() : await api.scraper.pause();
      setScraperPaused(res.paused);
    } catch {
      // garde l'état courant en cas d'échec réseau
    } finally {
      setTogglingScraper(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-2">
          <Settings className="text-indigo-400" size={26} />
          Réglages & Configuration
        </h1>
        <p className="text-sm text-zinc-400 mt-1">Configurez vos alertes de notifications et apprenez-en plus sur le robot.</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Telegram Notifications Panel */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 space-y-5 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="bg-sky-500/10 text-sky-400 p-2 rounded-xl border border-sky-500/20">
              <Send size={18} />
            </div>
            <div>
              <h2 className="font-bold text-white text-base">Notifications Telegram</h2>
              <p className="text-xs text-zinc-500">Recevez des alertes instantanées dès qu'une opportunité est détectée.</p>
            </div>
          </div>

          <p className="text-sm text-zinc-400 leading-relaxed">
            Les variables d'environnement <code className="bg-zinc-950 text-indigo-400 px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-800">TELEGRAM_BOT_TOKEN</code> et{' '}
            <code className="bg-zinc-950 text-indigo-400 px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-800">TELEGRAM_CHAT_ID</code> doivent être définies dans votre fichier <code className="bg-zinc-950 text-indigo-400 px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-800">.env</code> au démarrage du serveur de l'API.
          </p>

          {/* Config snippet */}
          <div className="bg-zinc-950 border border-zinc-850 rounded-xl p-4 space-y-1 font-mono text-xs text-zinc-300">
            <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-semibold uppercase tracking-wider mb-2 border-b border-zinc-900 pb-1.5">
              <Terminal size={12} />
              Configuration .env
            </div>
            <p className="text-zinc-500"># Token du bot Telegram fourni par @BotFather</p>
            <p className="text-sky-400"><span className="text-zinc-400">TELEGRAM_BOT_TOKEN</span>=1234567890:ABCdefGhIjkLmNoPqRsTuVwXyZ</p>
            <p className="text-zinc-500"># ID de votre canal ou chat Telegram privé</p>
            <p className="text-sky-400"><span className="text-zinc-400">TELEGRAM_CHAT_ID</span>=-1001234567890</p>
          </div>

          {/* Steps */}
          <div className="space-y-3 bg-zinc-950/40 border border-zinc-850 p-4 rounded-xl">
            <p className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Comment configurer le bot :</p>
            <ol className="space-y-2.5 text-xs text-zinc-400">
              <li className="flex items-start gap-2">
                <span className="bg-zinc-800 text-zinc-200 w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-bold font-mono">1</span>
                <span>Ouvrez l'application Telegram et recherchez le contact <strong>@BotFather</strong>.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-zinc-800 text-zinc-200 w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-bold font-mono">2</span>
                <span>Envoyez la commande <code>/newbot</code> et suivez les instructions pour lui donner un nom.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-zinc-800 text-zinc-200 w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-bold font-mono">3</span>
                <span>Copiez le jeton (token) HTTP API généré et collez-le dans <code>TELEGRAM_BOT_TOKEN</code>.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-zinc-800 text-zinc-200 w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-bold font-mono">4</span>
                <span>Démarrez une conversation avec votre bot (cliquez sur /start), puis visitez <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> pour obtenir votre <code>chat_id</code>.</span>
              </li>
            </ol>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center gap-4">
            <button
              onClick={testTelegram}
              disabled={testing}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-md glow-indigo disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Send size={13} className={testing ? 'animate-bounce' : ''} />
              {testing ? 'Test en cours…' : 'Envoyer un message de test'}
            </button>
            <span className="text-[11px] text-zinc-500">
              Permet de valider que la liaison avec le canal Telegram fonctionne.
            </span>
          </div>

          {testResult && (
            <div
              className={`flex items-center gap-2.5 text-xs p-4 rounded-xl border animate-fadeIn ${
                testResult.ok
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              {testResult.ok ? (
                <>
                  <Check size={16} className="shrink-0" />
                  <span>Le message test a été envoyé avec succès à votre chat Telegram !</span>
                </>
              ) : (
                <>
                  <AlertCircle size={16} className="shrink-0" />
                  <span>Échec de l'envoi : {testResult.error}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Scraper Control Panel */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 space-y-5 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl border ${
                scraperPaused
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}
            >
              {scraperPaused ? <Pause size={18} /> : <Play size={18} />}
            </div>
            <div>
              <h2 className="font-bold text-white text-base">Contrôle du scraper</h2>
              <p className="text-xs text-zinc-500">
                Mettez les scans Vinted en pause ou relancez-les. Le choix est conservé même après un redémarrage.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-950/40 border border-zinc-850 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  scraperPaused === null
                    ? 'bg-zinc-600'
                    : scraperPaused
                    ? 'bg-amber-400'
                    : 'bg-emerald-400 animate-pulse'
                }`}
              />
              <span className="text-sm font-medium text-zinc-200">
                {scraperPaused === null
                  ? 'État inconnu'
                  : scraperPaused
                  ? 'En pause'
                  : 'Actif'}
              </span>
            </div>
            <button
              onClick={toggleScraper}
              disabled={togglingScraper || scraperPaused === null}
              className={`flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
                scraperPaused
                  ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  : 'bg-amber-700 hover:bg-amber-600 text-white'
              }`}
            >
              {scraperPaused ? <Play size={14} /> : <Pause size={14} />}
              {togglingScraper
                ? '…'
                : scraperPaused
                ? 'Relancer le scraper'
                : 'Mettre en pause'}
            </button>
          </div>
        </div>

        {/* About Scraper Panel */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 space-y-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-500/10 text-indigo-400 p-2 rounded-xl border border-indigo-500/20">
              <Bot size={18} />
            </div>
            <h2 className="font-bold text-white text-base">À propos du scraper</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-zinc-400">
            {[
              "Le scraper s'exécute de façon autonome dans le conteneur API de Vinbot.",
              "Un délai obligatoire de 5 secondes est appliqué entre chaque mot-clé pour éviter le bannissement d'adresse IP.",
              "En cas de blocage d'accès 403 (détection Vinted), le scraper attend 60 secondes en sécurité avant de réitérer.",
              "Les alertes Telegram sont limitées à un message unique toutes les 24h par annonce pour éviter le spam.",
            ].map((text, idx) => (
              <div key={idx} className="bg-zinc-950/30 border border-zinc-850 p-3 rounded-xl flex items-start gap-2.5">
                <Info size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
