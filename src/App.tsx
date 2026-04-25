
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  Timestamp 
} from "firebase/firestore";
import { motion, AnimatePresence } from "motion/react";
import { Camera, Clock, History, Maximize2, RefreshCw, AlertCircle } from "lucide-react";
import { db } from "./firebase";

interface Capture {
  id: string;
  imageUrl: string;
  timestamp: Timestamp;
}

export default function App() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isFirebaseReady, setIsFirebaseReady] = useState(false);
  const CAM_URL = "https://webcams.meteonews.net/webcams/standard/640x480/613.jpg";

  const [refreshKey, setRefreshKey] = useState(Date.now());

  const refreshImage = () => {
    setRefreshKey(Date.now());
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

    const q = query(
      collection(db, "captures"), 
      orderBy("timestamp", "desc"), 
      limit(24)
    );

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const docs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Capture[];
        setCaptures(docs);
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
  }, [isFirebaseReady]);

  const latestCapture = captures[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-8 selection:bg-blue-500/30">
      <header className="max-w-6xl mx-auto mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-blue-400 mb-2 font-mono text-sm tracking-widest uppercase"
          >
            <Camera className="w-4 h-4" />
            <span>Live Archive</span>
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-2"
          >
            Klausenpass <span className="text-slate-500 font-light">Webcam</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ delay: 0.2 }}
            className="max-w-md text-slate-400"
          >
            Minütliches Archiv des Klausenpasses (1,948 m ü. M.). 
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

      <main className="max-w-6xl mx-auto space-y-12">
        {/* Latest Hero */}
        <section className="relative group">
          <motion.div 
            layoutId="latest-hero"
            className="relative aspect-video w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"
          >
            {latestCapture || !loading ? (
              <img 
                src={latestCapture?.imageUrl || `${CAM_URL}?t=${refreshKey}`} 
                alt="Latest Klausenpass Webcam"
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                referrerPolicy="no-referrer"
              />
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
                  />
                  <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 className="w-6 h-6" />
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

      <footer className="max-w-6xl mx-auto mt-24 py-12 border-t border-slate-800 text-center">
        <p className="text-slate-600 text-sm italic">
          Datenquelle: meteonews.ch &bull; Webcam W613 Klausenpass
        </p>
      </footer>
    </div>
  );
}
