
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { motion, AnimatePresence } from "motion/react";
import {
  Camera,
  Clock,
  History,
  Maximize2,
  RefreshCw,
  AlertCircle,
  Play,
  Pause,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { db } from "./firebase";

interface Capture {
  id: string;
  imageUrl: string;
  timestamp: Timestamp;
  passId: string;
}

interface Pass {
  id: string;
  name: string;
  altitude: string;
}

const REGIONS: { name: string; passes: Pass[] }[] = [
  {
    name: "Zentralschweiz",
    passes: [
      { id: "613", name: "Klausenpass", altitude: "1'948 m" },
      { id: "615", name: "Sustenpass", altitude: "2'224 m" },
      { id: "616", name: "Furkapass", altitude: "2'429 m" },
      { id: "838", name: "Gotthardpass", altitude: "2'106 m" },
      { id: "618", name: "Oberalppass", altitude: "2'044 m" },
      { id: "610", name: "Brünigpass", altitude: "1'008 m" },
    ],
  },
  {
    name: "Wallis",
    passes: [
      { id: "614", name: "Grimselpass", altitude: "2'164 m" },
      { id: "619", name: "Nufenenpass", altitude: "2'478 m" },
      { id: "621", name: "Simplonpass", altitude: "2'008 m" },
      { id: "625", name: "Gr. St. Bernhard", altitude: "2'469 m" },
      { id: "607", name: "Col de la Forclaz", altitude: "1'527 m" },
    ],
  },
  {
    name: "Berner Oberland & Waadt",
    passes: [
      { id: "611", name: "Jaunpass", altitude: "1'509 m" },
      { id: "608", name: "Col des Mosses", altitude: "1'445 m" },
      { id: "609", name: "Saanenmöser", altitude: "1'279 m" },
    ],
  },
  {
    name: "Graubünden",
    passes: [
      { id: "1064", name: "Lukmanierpass", altitude: "1'915 m" },
      { id: "813", name: "San Bernardino", altitude: "2'066 m" },
      { id: "1069", name: "Splügenpass", altitude: "2'115 m" },
      { id: "1063", name: "Flüelapass", altitude: "2'383 m" },
      { id: "1062", name: "Albulapass", altitude: "2'312 m" },
      { id: "1061", name: "Julierpass", altitude: "2'284 m" },
      { id: "1060", name: "Ofenpass", altitude: "2'149 m" },
      { id: "1059", name: "Berninapass", altitude: "2'328 m" },
      { id: "1058", name: "Malojapass", altitude: "1'815 m" },
    ],
  },
];

const ALL_PASSES: Pass[] = REGIONS.flatMap((r) => r.passes);

const TL_SPEEDS = [0.5, 1, 2, 4] as const;
type TlSpeed = (typeof TL_SPEEDS)[number];
const TL_FRAME_BASE_MS = 300;

function readPassFromHash(): string {
  if (typeof window === "undefined") return ALL_PASSES[0].id;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const id = params.get("pass");
  return ALL_PASSES.some((p) => p.id === id) ? id! : ALL_PASSES[0].id;
}

export default function App() {
  const [selectedPassId, setSelectedPassId] = useState<string>(readPassFromHash);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCaptureIndex, setSelectedCaptureIndex] = useState<number | null>(null);
  const [isFirebaseReady, setIsFirebaseReady] = useState(false);
  const [isTimeLapseActive, setIsTimeLapseActive] = useState(false);
  const [isPreloading, setIsPreloading] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [timeLapseIndex, setTimeLapseIndex] = useState(0);
  const [tlPaused, setTlPaused] = useState(false);
  const [tlSpeed, setTlSpeed] = useState<TlSpeed>(1);
  const [heroErrored, setHeroErrored] = useState(false);

  const selectedPass = useMemo(
    () => ALL_PASSES.find((p) => p.id === selectedPassId) || ALL_PASSES[0],
    [selectedPassId],
  );
  const [refreshKey, setRefreshKey] = useState(Date.now());

  const refreshImage = useCallback(() => {
    setRefreshKey(Date.now());
    setHeroErrored(false);
  }, []);

  // Sync pass selection to URL hash for shareable links.
  useEffect(() => {
    const next = `#pass=${selectedPassId}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [selectedPassId]);

  // React to back/forward navigation that changes the hash.
  useEffect(() => {
    const onHash = () => {
      const id = readPassFromHash();
      setSelectedPassId((prev) => (prev === id ? prev : id));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Reset hero error state whenever the active pass changes.
  useEffect(() => {
    setHeroErrored(false);
  }, [selectedPassId]);

  // Time-lapse playback ticker. The frame interval scales with tlSpeed.
  useEffect(() => {
    if (!isTimeLapseActive || tlPaused || captures.length < 2) return;
    const id = setInterval(
      () => setTimeLapseIndex((prev) => (prev + 1) % captures.length),
      TL_FRAME_BASE_MS / tlSpeed,
    );
    return () => clearInterval(id);
  }, [isTimeLapseActive, tlPaused, tlSpeed, captures.length]);

  const startTimeLapse = useCallback(async () => {
    if (captures.length < 2) return;

    setIsPreloading(true);
    setPreloadProgress(0);

    let loadedCount = 0;
    const totalCount = captures.length;
    const imagesToLoad = [...captures].reverse();

    const loadPromises = imagesToLoad.map((cap) => {
      return new Promise<boolean>((resolve) => {
        const img = new Image();
        const timeout = setTimeout(() => {
          loadedCount++;
          setPreloadProgress(Math.round((loadedCount / totalCount) * 100));
          resolve(false);
        }, 5000);

        img.referrerPolicy = "no-referrer";
        img.onload = () => {
          clearTimeout(timeout);
          loadedCount++;
          setPreloadProgress(Math.round((loadedCount / totalCount) * 100));
          resolve(true);
        };
        img.onerror = () => {
          clearTimeout(timeout);
          loadedCount++;
          setPreloadProgress(Math.round((loadedCount / totalCount) * 100));
          resolve(false);
        };
        img.src = cap.imageUrl;
      });
    });

    await Promise.all(loadPromises);

    setIsPreloading(false);
    setTimeLapseIndex(0);
    setTlPaused(false);
    setTlSpeed(1);
    setIsTimeLapseActive(true);
  }, [captures]);

  useEffect(() => {
    try {
      if (db) {
        setIsFirebaseReady(true);
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseReady) return;

    setLoading(true);
    const q = query(
      collection(db, "captures"),
      orderBy("timestamp", "desc"),
      limit(200),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const allDocs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Capture[];

        const filteredDocs = allDocs.filter((cap) => cap.passId === selectedPassId);
        setCaptures(filteredDocs.slice(0, 24));
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching captures:", err);
        setError("Bitte stelle sicher, dass Firebase korrekt konfiguriert ist.");
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [isFirebaseReady, selectedPassId]);

  const latestCapture = captures[0];
  const selectedCapture =
    selectedCaptureIndex !== null ? captures[selectedCaptureIndex] : null;

  const closeLightbox = useCallback(() => setSelectedCaptureIndex(null), []);
  const stepLightbox = useCallback(
    (delta: number) => {
      setSelectedCaptureIndex((prev) => {
        if (prev === null || captures.length === 0) return prev;
        const next = (prev + delta + captures.length) % captures.length;
        return next;
      });
    },
    [captures.length],
  );

  // Global keyboard shortcuts for lightbox + time-lapse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selectedCaptureIndex !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeLightbox();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          stepLightbox(1); // older capture
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          stepLightbox(-1); // newer capture
        }
        return;
      }
      if (isTimeLapseActive) {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsTimeLapseActive(false);
        } else if (e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          setTlPaused((p) => !p);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setTimeLapseIndex((i) => (i - 1 + captures.length) % captures.length);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setTimeLapseIndex((i) => (i + 1) % captures.length);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCaptureIndex, isTimeLapseActive, captures.length, closeLightbox, stepLightbox]);

  const heroSrc = latestCapture?.imageUrl
    ?? `https://webcams.meteonews.net/webcams/standard/640x480/${selectedPass.id}.jpg?t=${refreshKey}`;
  const showHeroOffline = heroErrored;

  const tlFrame = isTimeLapseActive && captures.length > 0
    ? captures[captures.length - 1 - timeLapseIndex]
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-8 selection:bg-blue-500/30">
      <header className="max-w-6xl mx-auto mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 text-blue-400 font-mono text-sm tracking-widest uppercase"
            >
              <Camera className="w-4 h-4" />
              <span>Live Archive</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex items-center gap-2 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-500 uppercase tracking-tighter"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {ALL_PASSES.length} Cloud Scrapers Active
            </motion.div>
          </div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            key={selectedPass.name}
            className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-2"
          >
            {selectedPass.name} <span className="text-slate-500 font-light">Webcam</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ delay: 0.2 }}
            className="max-w-md text-slate-400"
          >
            Minütliches Archiv des Passes ({selectedPass.altitude} ü. M.).
            Verfolge die Wetterveränderungen in Echtzeit.
          </motion.p>
          {!isFirebaseReady && !loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500 text-xs"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>Die Archivierung ist deaktiviert. Bitte schließe die Firebase-Konfiguration ab, um Bilder zu speichern.</span>
            </motion.div>
          )}
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <motion.button
            whileHover={!isPreloading && captures.length >= 2 ? { scale: 1.05 } : {}}
            whileTap={!isPreloading && captures.length >= 2 ? { scale: 0.95 } : {}}
            onClick={startTimeLapse}
            disabled={captures.length < 2 || isPreloading}
            className="relative flex items-center gap-2 px-4 py-2 bg-blue-600 border border-blue-500 rounded-xl text-sm font-medium hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 overflow-hidden"
          >
            {isPreloading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Preloading {preloadProgress}%</span>
                <motion.div
                  className="absolute bottom-0 left-0 h-1 bg-white/30"
                  initial={{ width: 0 }}
                  animate={{ width: `${preloadProgress}%` }}
                />
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Time-Lapse abspielen
              </>
            )}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={refreshImage}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${!latestCapture && "animate-spin"}`} />
            Aktualisieren
          </motion.button>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-4 rounded-2xl flex items-center gap-4"
          >
            <div className="bg-blue-500/10 p-3 rounded-full text-blue-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase font-bold tracking-tighter">
                {latestCapture ? "Letzte Aufnahme" : "Live-Bild"}
              </div>
              <div className="text-sm font-medium">
                {latestCapture
                  ? latestCapture.timestamp?.toDate().toLocaleTimeString("de-CH")
                  : "Wird gerade gestreamt"}
              </div>
            </div>
          </motion.div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto mb-8 space-y-4">
        {REGIONS.map((region) => (
          <div key={region.name}>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
              {region.name}
            </div>
            <div className="flex flex-wrap gap-2">
              {region.passes.map((pass) => {
                const active = selectedPassId === pass.id;
                return (
                  <motion.button
                    key={pass.id}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setSelectedPassId(pass.id)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all border ${
                      active
                        ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {pass.name}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <main className="max-w-6xl mx-auto space-y-12">
        {/* Latest Hero */}
        <section className="relative group">
          <motion.div
            layoutId="latest-hero"
            className="relative aspect-video w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"
          >
            {(latestCapture || !loading) ? (
              <>
                <button
                  type="button"
                  onClick={() => latestCapture && setSelectedCaptureIndex(0)}
                  className="block w-full h-full cursor-zoom-in"
                  aria-label={latestCapture ? "Vergrößern" : undefined}
                  disabled={!latestCapture}
                >
                  <img
                    key={heroSrc}
                    src={heroSrc}
                    alt={`${selectedPass.name} Webcam`}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                    onLoad={() => setHeroErrored(false)}
                    onError={() => setHeroErrored(true)}
                    style={showHeroOffline ? { visibility: "hidden" } : undefined}
                  />
                </button>

                {showHeroOffline && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-slate-700 flex flex-col items-center gap-4">
                      <Camera className="w-16 h-16 opacity-30" />
                      <span className="text-sm uppercase tracking-[0.3em] font-bold opacity-50">
                        Camera Temporarily Offline
                      </span>
                    </div>
                  </div>
                )}

                <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between pointer-events-none">
                  <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs font-mono text-white/90">
                      {latestCapture?.timestamp
                        ? latestCapture.timestamp.toDate().toLocaleString("de-CH", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                        : "LIVE FEED"}
                    </span>
                  </div>
                  <div className="flex gap-2 pointer-events-auto">
                    <button
                      onClick={refreshImage}
                      className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors"
                      aria-label="Aktualisieren"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    {latestCapture && (
                      <button
                        onClick={() => setSelectedCaptureIndex(0)}
                        className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors"
                        aria-label="Vergrößern"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="absolute top-6 left-6 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 pointer-events-none">
                  <span className="bg-red-500 w-2 h-2 rounded-full animate-pulse shadow-red-500/50 shadow-lg" />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-white/90">
                    Live Feed
                  </span>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                <p className="text-slate-500 animate-pulse">Lade neuesten Capture...</p>
              </div>
            )}
          </motion.div>
        </section>

        {/* History Grid */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <History className="w-5 h-5 text-slate-500" />
            <h2 className="text-xl font-semibold">
              Letzte {Math.max(0, captures.length - 1) || 24} Aufnahmen
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
            {loading && captures.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={`skeleton-${i}`}
                    className="aspect-square rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden relative"
                  >
                    <div className="absolute inset-0 bg-linear-to-r from-transparent via-slate-800/40 to-transparent animate-pulse" />
                  </div>
                ))
              : (
                <AnimatePresence>
                  {captures.slice(1).map((capture, gridIndex) => {
                    const captureIndex = gridIndex + 1;
                    return (
                      <motion.button
                        key={capture.id}
                        type="button"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: gridIndex * 0.05 }}
                        whileHover={{ y: -4 }}
                        onClick={() => setSelectedCaptureIndex(captureIndex)}
                        className="aspect-square relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 cursor-pointer group text-left"
                        aria-label={`Aufnahme ${capture.timestamp?.toDate().toLocaleString("de-CH")}`}
                      >
                        <img
                          src={capture.imageUrl}
                          alt=""
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/40">
                          <Maximize2 className="w-6 h-6" />
                        </div>
                        <div className="absolute bottom-2 left-2 right-2 bg-slate-950/80 backdrop-blur-sm px-2 py-1 rounded-lg text-[10px] font-mono text-center">
                          {capture.timestamp?.toDate().toLocaleTimeString("de-CH")}
                        </div>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              )}
          </div>

          {!loading && captures.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <AlertCircle className="w-12 h-12 text-slate-700" />
              <p className="text-slate-600 text-center px-8">
                Noch keine archivierten Bilder für diesen Pass.
              </p>
            </div>
          )}
        </section>
      </main>

      {/* Lightbox */}
      <AnimatePresence>
        {selectedCapture && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeLightbox}
            className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-12 cursor-zoom-out"
          >
            <motion.img
              key={selectedCapture.id}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              src={selectedCapture.imageUrl}
              alt=""
              className="max-w-full max-h-full rounded-2xl shadow-2xl"
              referrerPolicy="no-referrer"
              onClick={(e) => e.stopPropagation()}
            />

            {captures.length > 1 && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    stepLightbox(1);
                  }}
                  className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur border border-white/10 text-white transition-colors"
                  aria-label="Älteres Bild"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    stepLightbox(-1);
                  }}
                  className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur border border-white/10 text-white transition-colors"
                  aria-label="Neueres Bild"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                closeLightbox();
              }}
              className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur border border-white/10 text-white transition-colors"
              aria-label="Schliessen"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="absolute top-6 left-6 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-xs font-mono text-white/90 pointer-events-none">
              {selectedCapture.timestamp?.toDate().toLocaleString("de-CH")}
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-slate-400 text-xs pointer-events-none">
              ESC zum Schliessen · ← → blättern
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time-Lapse Modal */}
      <AnimatePresence>
        {isTimeLapseActive && tlFrame && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center p-4"
          >
            <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-black">
              <img
                src={tlFrame.imageUrl}
                alt="Time-lapse Frame"
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />

              <div className="absolute top-4 right-4 flex gap-2">
                <button
                  onClick={() => setTlPaused((p) => !p)}
                  className="bg-slate-900/80 hover:bg-slate-800 backdrop-blur p-2 rounded-full transition-colors"
                  aria-label={tlPaused ? "Wiedergabe" : "Pause"}
                >
                  {tlPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => setIsTimeLapseActive(false)}
                  className="bg-slate-900/80 hover:bg-slate-800 backdrop-blur p-2 rounded-full transition-colors"
                  aria-label="Schliessen"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 bg-linear-to-t from-black/90 to-transparent">
                <div className="flex justify-between items-end gap-4 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-xl font-bold text-white truncate">
                      {selectedPass.name} – Zeitraffer
                    </h3>
                    <p className="text-slate-400 font-mono text-sm">
                      {tlFrame.timestamp?.toDate().toLocaleString("de-CH")}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-900/70 border border-slate-800 rounded-full p-1">
                    {TL_SPEEDS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setTlSpeed(s)}
                        className={`text-xs font-mono px-2.5 py-1 rounded-full transition-colors ${
                          tlSpeed === s
                            ? "bg-blue-600 text-white"
                            : "text-slate-400 hover:text-white"
                        }`}
                        aria-pressed={tlSpeed === s}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>

                  <div className="text-slate-500 font-mono text-xs whitespace-nowrap">
                    {timeLapseIndex + 1} / {captures.length}
                  </div>
                </div>

                <button
                  type="button"
                  className="w-full h-2 bg-slate-800 rounded-full overflow-hidden cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                    setTimeLapseIndex(
                      Math.min(captures.length - 1, Math.floor(ratio * captures.length)),
                    );
                  }}
                  aria-label="Zeitraffer-Position"
                >
                  <motion.div
                    className="h-full bg-blue-500 pointer-events-none"
                    initial={false}
                    animate={{ width: `${((timeLapseIndex + 1) / captures.length) * 100}%` }}
                  />
                </button>

                <div className="mt-3 text-center text-[10px] uppercase tracking-widest text-slate-500">
                  Leertaste: Pause · ← → Bild · ESC schliessen
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="max-w-6xl mx-auto mt-24 py-12 border-t border-slate-800 text-center">
        <p className="text-slate-600 text-sm italic">
          Datenquelle:{" "}
          <a
            href="https://meteonews.net"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-400 transition-colors not-italic"
          >
            meteonews.net
          </a>{" "}
          &bull; Webcam {selectedPass.name}
        </p>
      </footer>
    </div>
  );
}
