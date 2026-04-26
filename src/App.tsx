
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  where,
  orderBy, 
  limit, 
  onSnapshot,
  Timestamp 
} from "firebase/firestore";
import { motion, AnimatePresence } from "motion/react";
import { Camera, Clock, History, Maximize2, RefreshCw, AlertCircle, Play, X } from "lucide-react";
import { db } from "./firebase";

interface Capture {
  id: string;
  imageUrl: string;
  timestamp: Timestamp;
  passId: string;
}

const PASSES = [
  { id: "613", name: "Klausenpass", altitude: "1,948 m" },
  { id: "838", name: "Gotthardpass", altitude: "2,106 m" },
  { id: "614", name: "Grimselpass", altitude: "2,164 m" },
  { id: "615", name: "Sustenpass", altitude: "2,224 m" },
  { id: "616", name: "Furkapass", altitude: "2,429 m" },
  { id: "618", name: "Oberalppass", altitude: "2,044 m" },
  { id: "619", name: "Nufenenpass", altitude: "2,478 m" },
  { id: "813", name: "San Bernardino", altitude: "2,066 m" },
  { id: "621", name: "Simplonpass", altitude: "2,008 m" },
  { id: "610", name: "Brünigpass", altitude: "1,008 m" },
  { id: "611", name: "Jaunpass", altitude: "1,509 m" },
  { id: "608", name: "Col des Mosses", altitude: "1,445 m" },
  { id: "609", name: "Saanenmöser", altitude: "1,279 m" },
  { id: "607", name: "Col de la Forclaz", altitude: "1,527 m" },
  { id: "625", name: "Gr. St. Bernhard", altitude: "2,469 m" },
  { id: "1063", name: "Flüelapass", altitude: "2,383 m" },
  { id: "1062", name: "Albulapass", altitude: "2,312 m" },
  { id: "1061", name: "Julierpass", altitude: "2,284 m" },
  { id: "1060", name: "Ofenpass", altitude: "2,149 m" },
  { id: "1059", name: "Berninapass", altitude: "2,328 m" },
  { id: "1058", name: "Malojapass", altitude: "1,815 m" },
  { id: "1064", name: "Lukmanierpass", altitude: "1,915 m" },
  { id: "1069", name: "Splügenpass", altitude: "2,115 m" },
];

export default function App() {
  const [selectedPassId, setSelectedPassId] = useState(PASSES[0].id);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isFirebaseReady, setIsFirebaseReady] = useState(false);
  const [isTimeLapseActive, setIsTimeLapseActive] = useState(false);
  const [isPreloading, setIsPreloading] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [timeLapseIndex, setTimeLapseIndex] = useState(0);

  const selectedPass = PASSES.find(p => p.id === selectedPassId) || PASSES[0];
  const CAM_URL = `https://webcams.meteonews.net/webcams/standard/640x480/${selectedPassId}.jpg`;

  const [refreshKey, setRefreshKey] = useState(Date.now());

  const refreshImage = () => {
    setRefreshKey(Date.now());
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimeLapseActive && captures.length > 0) {
      interval = setInterval(() => {
        setTimeLapseIndex((prev) => (prev + 1) % captures.length);
      }, 300); // 300ms per frame
    }
    return () => clearInterval(interval);
  }, [isTimeLapseActive, captures.length]);

  const startTimeLapse = async () => {
    if (captures.length < 2) return;
    
    setIsPreloading(true);
    setPreloadProgress(0);
    
    let loadedCount = 0;
    const totalCount = captures.length;
    
    // Reverse array to pre-load from oldest to newest (how we play it)
    const imagesToLoad = [...captures].reverse();
    
    const loadPromises = imagesToLoad.map((cap) => {
      return new Promise((resolve) => {
        const img = new Image();
        const timeout = setTimeout(() => {
          loadedCount++;
          setPreloadProgress(Math.round((loadedCount / totalCount) * 100));
          resolve(false);
        }, 5000); // 5s timeout per image

        img.src = cap.imageUrl;
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
      });
    });

    await Promise.all(loadPromises);
    
    setIsPreloading(false);
    setTimeLapseIndex(0);
    setIsTimeLapseActive(true);
  };

  useEffect(() => {
    // Check if firebase is configured
    try {
      if (db) {
        setIsFirebaseReady(true);
      } else {
        setLoading(false);
      }
    } catch (e) {
      console.log("Firebase not ready yet");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseReady) return;

    setLoading(true);
    const q = query(
      collection(db, "captures"), 
      orderBy("timestamp", "desc"), 
      limit(200) // Fetch more to filter in memory
    );

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const allDocs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Capture[];
        
        // Filter in memory to avoid needing a composite index
        const filteredDocs = allDocs.filter(cap => cap.passId === selectedPassId);
        
        setCaptures(filteredDocs.slice(0, 24));
        setLoading(false);
        setRefreshKey(Date.now()); // Update key when new data arrives
      },
      (err) => {
        console.error("Error fetching captures:", err);
        setError("Bitte stelle sicher, dass Firebase korrekt konfiguriert ist.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [isFirebaseReady, selectedPassId]);

  const latestCapture = captures[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-8 selection:bg-blue-500/30">
      <header className="max-w-6xl mx-auto mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-4 mb-4">
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
              {PASSES.length} Cloud Scrapers Active
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
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <motion.button
            whileHover={!isPreloading ? { scale: 1.05 } : {}}
            whileTap={!isPreloading ? { scale: 0.95 } : {}}
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
                {latestCapture ? latestCapture.timestamp?.toDate().toLocaleTimeString('de-CH') : "Wird gerade gestreamt"}
              </div>
            </div>
          </motion.div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto mb-8">
        <div className="flex flex-wrap items-center gap-3 pb-4">
          {PASSES.map((pass) => (
            <motion.button
              key={pass.id}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setSelectedPassId(pass.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border ${
                selectedPassId === pass.id 
                  ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20" 
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {pass.name}
            </motion.button>
          ))}
        </div>
      </section>

      <main className="max-w-6xl mx-auto space-y-12">
        {/* Latest Hero */}
        <section className="relative group">
          <motion.div 
            layoutId="latest-hero"
            className="relative aspect-video w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"
          >
            {latestCapture || !loading ? (
              <>
                <img 
                  src={latestCapture?.imageUrl || `https://webcams.meteonews.net/webcams/standard/640x480/${selectedPass.id}.jpg?t=${refreshKey}`} 
                  alt={`Latest ${selectedPass.name} Webcam`}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
                
                {/* Timestamp Overlay */}
                <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between">
                  <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs font-mono text-white/90">
                      {latestCapture?.timestamp 
                        ? (latestCapture.timestamp as any).toDate().toLocaleString('de-CH', { 
                            day: '2-digit', month: '2-digit', year: 'numeric', 
                            hour: '2-digit', minute: '2-digit', second: '2-digit' 
                          })
                        : 'LIVE FEED'}
                    </span>
                  </div>
                  <button 
                    onClick={() => setRefreshKey(prev => prev + 1)}
                    className="p-3 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -z-10">
                  <div className="text-slate-800 flex flex-col items-center gap-4">
                    <Camera className="w-16 h-16 opacity-10" />
                    <span className="text-sm uppercase tracking-[0.3em] font-bold opacity-30">Camera Temporarily Offline</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                {loading ? (
                  <>
                    <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                    <p className="text-slate-500 animate-pulse">Lade neuesten Capture...</p>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-12 h-12 text-slate-700" />
                    <p className="text-slate-600 text-center px-8">
                      Keine Daten gefunden. <br/>
                      Stelle sicher, dass Firebase eingerichtet ist und der Server läuft.
                    </p>
                  </>
                )}
              </div>
            )}
            
            {/* Overlays */}
            <div className="absolute inset-x-0 bottom-0 p-6 bg-linear-to-t from-slate-950/80 to-transparent flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
               <div className="flex items-center gap-3">
                 <span className="bg-red-500 w-2 h-2 rounded-full animate-pulse shadow-red-500/50 shadow-lg"></span>
                 <span className="text-xs font-mono uppercase tracking-widest text-white/90">Live Feed</span>
               </div>
               <button 
                onClick={() => latestCapture && setSelectedImage(latestCapture.imageUrl)}
                className="bg-white/10 hover:bg-white/20 backdrop-blur p-2 rounded-full transition-colors"
               >
                 <Maximize2 className="w-5 h-5" />
               </button>
            </div>
          </motion.div>
        </section>

        {/* History Grid */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <History className="w-5 h-5 text-slate-500" />
            <h2 className="text-xl font-semibold">Letzte 24 Aufnahmen</h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
            <AnimatePresence>
              {captures.slice(1).map((capture, index) => (
                <motion.div
                  key={capture.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ y: -4 }}
                  onClick={() => setSelectedImage(capture.imageUrl)}
                  className="aspect-square relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 cursor-pointer group"
                >
                  <img 
                    src={capture.imageUrl} 
                    alt={`Archive ${capture.timestamp?.toDate().toLocaleTimeString()}`}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).parentElement?.classList.add('bg-slate-900');
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Maximize2 className="w-6 h-6" />
                  </div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-slate-700 flex flex-col items-center gap-2 hidden" id={`error-${capture.id}`}>
                      <Camera className="w-8 h-8 opacity-20" />
                      <span className="text-[10px] uppercase tracking-widest font-bold">Offline</span>
                    </div>
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 bg-slate-950/80 backdrop-blur-sm px-2 py-1 rounded-lg text-[10px] font-mono text-center">
                    {capture.timestamp?.toDate().toLocaleTimeString('de-CH')}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      </main>

      {/* Lightbox */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedImage(null)}
            className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-12 cursor-zoom-out"
          >
            <motion.img 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              src={selectedImage} 
              className="max-w-full max-h-full rounded-2xl shadow-2xl"
              referrerPolicy="no-referrer"
            />
            <div className="fixed top-8 right-8 text-slate-400">Esc zum Schliessen</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time-Lapse Modal */}
      <AnimatePresence>
        {isTimeLapseActive && captures.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center p-4"
          >
            <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-black">
              <img 
                src={captures[captures.length - 1 - timeLapseIndex].imageUrl} 
                alt="Time-lapse frame"
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-4 right-4 flex gap-4">
                <button 
                  onClick={() => setIsTimeLapseActive(false)}
                  className="bg-slate-900/80 hover:bg-slate-800 backdrop-blur p-2 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-linear-to-t from-black/80 to-transparent">
                <div className="flex justify-between items-end">
                  <div>
                    <h3 className="text-xl font-bold text-white">Zeitraffer-Wiedergabe</h3>
                    <p className="text-slate-400 font-mono text-sm">
                      {captures[captures.length - 1 - timeLapseIndex].timestamp?.toDate().toLocaleString('de-CH')}
                    </p>
                  </div>
                  <div className="text-slate-500 font-mono text-xs">
                    {timeLapseIndex + 1} / {captures.length}
                  </div>
                </div>
                {/* Progress Bar */}
                <div className="mt-4 w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-blue-500"
                    initial={false}
                    animate={{ width: `${((timeLapseIndex + 1) / captures.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="max-w-6xl mx-auto mt-24 py-12 border-t border-slate-800 text-center">
        <p className="text-slate-600 text-sm italic">
          Datenquelle: meteonews.ch &bull; Webcam {selectedPass.name}
        </p>
      </footer>
    </div>
  );
}
