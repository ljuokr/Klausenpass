
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  Map as MapIcon,
  List,
  CalendarDays,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { db } from "./firebase";

interface Capture {
  id: string;
  imageUrl: string;
  timestamp: Timestamp;
  passId: string;
}

type RoadStatus =
  | { state: "closed"; opening?: string }
  | { state: "partial"; until: string }
  | { state: "open" };

interface PassHistory {
  // Source: alpen-paesse.ch yearly Wintersperre table, 10 most recent
  // years with both an opening and closing date recorded (typically
  // 2016–2025).
  avg: string;       // "19.05."
  earliest: string;  // "02.05."
  latest: string;    // "05.06."
  last: string;      // "02.05." (most recent year)
}

interface Pass {
  id: string;
  name: string;
  altitude: string;
  coords: [number, number];   // [lat, lng]
  liveUrl: string;
  source: { label: string; href: string };
  status: RoadStatus;
  // ISO date for the 2026 forecast opening — drives the map's
  // "öffnet < 2 Wochen" categorisation. Closed passes only.
  forecastDate?: string;
  history: PassHistory;
  note?: string;
  archiveId?: string;
}

type CyclingStatus = "open" | "soon" | "later";

function cyclingStatus(pass: Pass, today: Date): CyclingStatus {
  if (pass.status.state === "open" || pass.status.state === "partial") return "open";
  if (!pass.forecastDate) return "later";
  const days = Math.round(
    (new Date(pass.forecastDate).getTime() - today.getTime()) / 86_400_000,
  );
  return days <= 14 ? "soon" : "later";
}

function cyclingMarker(s: CyclingStatus): string {
  if (s === "open") return "#10b981";   // emerald-500
  if (s === "soon") return "#fbbf24";   // amber-400
  return "#ef4444";                     // red-500
}

function cyclingDot(s: CyclingStatus): string {
  if (s === "open") return "bg-emerald-500";
  if (s === "soon") return "bg-amber-400";
  return "bg-red-500";
}

// Curated list of winter-closed passes — focused on cycling: cams that
// show the actual road, not just panoramic mountain views.
// Year-round-open passes (Brünig, Forclaz, Jaun, Mosses, Saanenmöser,
// Simplon, Julier, Maloja, Ofen, Bernina, Lukmanier) intentionally
// excluded.
// archiveId matches the meteonews cam IDs the Firestore scraper has
// historically used (613, 813); other passes have no archive yet.
const REGIONS: { name: string; passes: Pass[] }[] = [
  {
    name: "Zentralschweiz",
    passes: [
      {
        id: "klausenpass",
        name: "Klausenpass",
        altitude: "1'948 m",
        coords: [46.87, 8.86],
        liveUrl: "https://webcams.meteonews.net/webcams/standard/640x480/613.jpg",
        source: { label: "meteonews.ch", href: "https://meteonews.ch/de/Webcam/W613/Klausenpass" },
        status: { state: "closed", opening: "Mitte Mai" },
        forecastDate: "2026-05-15",
        history: { avg: "19.05.", earliest: "02.05.", latest: "05.06.", last: "02.05." },
        note: "Baustelle Urnerboden bis 12. Juni",
        archiveId: "613",
      },
      {
        id: "sustenpass",
        name: "Sustenpass",
        altitude: "2'224 m",
        coords: [46.73, 8.45],
        liveUrl: "https://livecam.sustenpass.ch/SteinPTZ000M.jpg",
        source: { label: "sustenpass.ch · Steingletscher PTZ", href: "https://sustenpass.ch/de/Info/Livecam" },
        status: { state: "partial", until: "Steingletscher" },
        history: { avg: "15.06.", earliest: "03.06.", latest: "28.06.", last: "06.06." },
      },
      {
        id: "furkapass",
        name: "Furkapass",
        altitude: "2'429 m",
        coords: [46.57, 8.41],
        liveUrl: "https://webcam.dieselcrew.ch/tiefenbach.jpg",
        source: { label: "Hotel Tiefenbach", href: "https://www.hotel-tiefenbach.ch/" },
        status: { state: "closed", opening: "Anfang Juni" },
        forecastDate: "2026-06-03",
        history: { avg: "05.06.", earliest: "24.05.", latest: "21.06.", last: "28.05." },
      },
      {
        id: "grimselpass",
        name: "Grimselpass",
        altitude: "2'164 m",
        coords: [46.56, 8.34],
        liveUrl: "https://images.bergfex.at/webcams/?id=22208&format=4",
        source: { label: "bergfex.ch · Hotel Grimsel", href: "https://www.bergfex.ch/obergoms/webcams/c22208/" },
        status: { state: "partial", until: "Räterichsboden" },
        history: { avg: "05.06.", earliest: "25.05.", latest: "14.06.", last: "28.05." },
      },
      {
        id: "gotthardpass",
        name: "Gotthardpass (Tremola)",
        altitude: "2'106 m",
        coords: [46.56, 8.56],
        // The Tremola-side cams (Galleria dei Banchi, Hospiz) are
        // currently "ausser Betrieb"; Schöllenen (Andermatt approach)
        // is the live AFBN cam on the cycling route.
        liveUrl: "https://webcam.afbn.ch/H_SCH_002,542_N_KAM_001_Nord.jpg",
        source: { label: "afbn.ch · Schöllenen", href: "https://www.afbn.ch/verkehr-und-baustellen/webcams" },
        status: { state: "closed", opening: "Mitte Mai" },
        forecastDate: "2026-05-15",
        history: { avg: "22.05.", earliest: "16.05.", latest: "30.05.", last: "16.05." },
      },
      {
        id: "oberalppass",
        name: "Oberalppass",
        altitude: "2'044 m",
        coords: [46.66, 8.67],
        liveUrl: "https://images.bergfex.at/webcams/?id=365&format=4",
        source: { label: "bergfex.ch · Alpsu", href: "https://www.bergfex.ch/andermatt-oberalp-sedrun/webcams/c365/" },
        status: { state: "closed", opening: "13. Mai 2026" },
        forecastDate: "2026-05-13",
        history: { avg: "25.04.", earliest: "13.04.", latest: "02.05.", last: "25.04." },
      },
    ],
  },
  {
    name: "Wallis & Tessin",
    passes: [
      {
        id: "nufenenpass",
        name: "Nufenenpass",
        altitude: "2'478 m",
        coords: [46.48, 8.39],
        liveUrl: "https://webcams.meteonews.net/webcams/standard/640x480/12270.jpg",
        source: { label: "meteonews.ch · Ulrichen Goms", href: "https://meteonews.ch/de/Webcam/W12270/Ulrichen" },
        status: { state: "partial", until: "All'Acqua" },
        history: { avg: "08.06.", earliest: "25.05.", latest: "21.06.", last: "28.05." },
      },
      {
        id: "gr-st-bernhard",
        name: "Gr. St. Bernhard",
        altitude: "2'472 m",
        coords: [45.87, 7.17],
        liveUrl: "https://images.bergfex.at/webcams/?id=25197&format=4",
        source: { label: "bergfex.ch · Tunnel Süd", href: "https://www.bergfex.ch/sommer/saint-bernard/webcams/c25197/" },
        status: { state: "closed", opening: "Anfang Juni" },
        forecastDate: "2026-06-03",
        history: { avg: "03.06.", earliest: "29.05.", latest: "13.06.", last: "06.06." },
      },
    ],
  },
  {
    name: "Graubünden",
    passes: [
      {
        id: "san-bernardino",
        name: "San Bernardino",
        altitude: "2'066 m",
        coords: [46.49, 9.17],
        // meteonews W813 currently mislabelled (returns Beckenried);
        // bergfex 5676 is the canonical San Bernardino village/pass cam.
        liveUrl: "https://images.bergfex.at/webcams/?id=5676&format=4",
        source: { label: "bergfex · San Bernardino", href: "https://www.bergfex.com/sanbernardino/webcams/c5676/" },
        status: { state: "closed", opening: "Mitte Mai" },
        forecastDate: "2026-05-15",
        history: { avg: "15.05.", earliest: "28.04.", latest: "28.05.", last: "28.05." },
        archiveId: "813",
      },
      {
        id: "spluegenpass",
        name: "Splügenpass",
        altitude: "2'113 m",
        coords: [46.51, 9.33],
        liveUrl: "https://webcams.meteonews.net/webcams/standard/640x480/14003.jpg",
        source: { label: "meteonews.ch", href: "https://meteonews.ch/de/Webcam/W14003/Spl%C3%BCgenpass" },
        status: { state: "closed", opening: "Anfang Mai" },
        forecastDate: "2026-05-03",
        history: { avg: "02.05.", earliest: "21.04.", latest: "15.06.", last: "25.04." },
      },
      {
        id: "albulapass",
        name: "Albulapass",
        altitude: "2'312 m",
        coords: [46.58, 9.83],
        liveUrl: "https://webcams.meteonews.net/webcams/standard/640x480/11546.jpg",
        source: { label: "meteonews.ch · Bergün", href: "https://meteonews.ch/de/Webcam/W11546/Albulapass" },
        status: { state: "closed", opening: "Mitte Mai" },
        forecastDate: "2026-05-15",
        history: { avg: "20.05.", earliest: "28.04.", latest: "13.06.", last: "09.05." },
      },
      {
        id: "fluelapass",
        name: "Flüelapass",
        altitude: "2'383 m",
        coords: [46.75, 9.94],
        liveUrl: "https://webcams.meteonews.net/webcams/standard/640x480/13501.jpg",
        source: { label: "meteonews.ch", href: "https://meteonews.ch/de/Webcam/W13501/Fl%C3%BCelapass" },
        status: { state: "closed", opening: "Ende April" },
        forecastDate: "2026-04-28",
        history: { avg: "30.04.", earliest: "06.04.", latest: "04.06.", last: "16.04." },
      },
      {
        id: "umbrailpass",
        name: "Umbrailpass",
        altitude: "2'501 m",
        coords: [46.54, 10.43],
        liveUrl: "https://images.bergfex.at/webcams/?id=4771&format=4",
        source: { label: "bergfex · Stilfserjoch", href: "https://www.bergfex.com/stilfser-joch-ortler/webcams/c4771/" },
        status: { state: "closed", opening: "Ende Mai" },
        forecastDate: "2026-05-28",
        history: { avg: "29.05.", earliest: "20.05.", latest: "15.06.", last: "23.05." },
      },
    ],
  },
];

const ALL_PASSES: Pass[] = REGIONS.flatMap((r) => r.passes);

function statusLabel(s: RoadStatus): string {
  if (s.state === "open") return "Offen";
  if (s.state === "partial") return `Offen bis ${s.until}`;
  return s.opening ? `Wintersperre · öffnet ${s.opening}` : "Wintersperre";
}

function statusColors(s: RoadStatus): { dot: string; pill: string } {
  if (s.state === "open") {
    return { dot: "bg-emerald-500", pill: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" };
  }
  if (s.state === "partial") {
    return { dot: "bg-amber-400", pill: "bg-amber-400/10 border-amber-400/30 text-amber-300" };
  }
  return { dot: "bg-rose-500", pill: "bg-rose-500/10 border-rose-500/30 text-rose-400" };
}

function cacheBust(url: string, t: number): string {
  return url + (url.includes("?") ? "&" : "?") + "_t=" + t;
}

const TL_SPEEDS = [0.5, 1, 2, 4] as const;
type TlSpeed = (typeof TL_SPEEDS)[number];
const TL_FRAME_BASE_MS = 300;

function readPassFromHash(): string {
  if (typeof window === "undefined") return ALL_PASSES[0].id;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const id = params.get("pass");
  return ALL_PASSES.some((p) => p.id === id) ? id! : ALL_PASSES[0].id;
}

function PassMap({
  passes,
  selectedId,
  today,
  onSelect,
}: {
  passes: Pass[];
  selectedId: string;
  today: Date;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<globalThis.Map<string, L.CircleMarker>>(new globalThis.Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [46.7, 9.0],
      zoom: 8,
      minZoom: 7,
      maxZoom: 12,
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://openstreetmap.org">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    // Fit bounds to all passes so the whole alpine arc is visible.
    const bounds = L.latLngBounds(passes.map((p) => p.coords));
    map.fitBounds(bounds, { padding: [30, 30] });

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render markers and keep the active one highlighted.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    for (const pass of passes) {
      const isActive = pass.id === selectedId;
      const cs = cyclingStatus(pass, today);
      const color = cyclingMarker(cs);
      const marker = L.circleMarker(pass.coords, {
        radius: isActive ? 12 : 8,
        fillColor: color,
        color: isActive ? "#ffffff" : "#0f172a",
        weight: isActive ? 3 : 2,
        fillOpacity: 0.95,
      }).addTo(map);

      const sub =
        cs === "open"
          ? "Webcam zeigt offen"
          : cs === "soon"
          ? "Öffnet < 2 Wochen"
          : "Öffnet später";
      marker.bindTooltip(
        `<b>${pass.name}</b><br/><span style="opacity:.7">${pass.altitude} · ${sub}</span>`,
        { direction: "top", offset: [0, -8], opacity: 0.95, className: "pass-tip" },
      );
      marker.on("click", () => onSelectRef.current(pass.id));
      markersRef.current.set(pass.id, marker);
    }
  }, [passes, selectedId, today]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[420px] rounded-2xl border border-slate-800 overflow-hidden"
      style={{ background: "#0b1220" }}
    />
  );
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
  const [view, setView] = useState<"list" | "map">(() => {
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("passView") as "list" | "map") ?? "list";
  });

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("passView", view);
  }, [view]);

  // Frozen at component mount — fine for a session; refresh recomputes.
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

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
    const archiveId = selectedPass.archiveId;
    if (!archiveId) {
      setCaptures([]);
      setLoading(false);
      return;
    }

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

        const filteredDocs = allDocs.filter((cap) => cap.passId === archiveId);
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
  }, [isFirebaseReady, selectedPass.archiveId]);

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

  const heroSrc = latestCapture?.imageUrl ?? cacheBust(selectedPass.liveUrl, refreshKey);
  const showHeroOffline = heroErrored;
  const status = selectedPass.status;
  const statusText = statusLabel(status);
  const statusColor = statusColors(status);

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
              key={selectedPassId + statusText}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className={`flex items-center gap-2 px-2 py-1 rounded-full border text-[10px] font-bold uppercase tracking-tighter ${statusColor.pill}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${statusColor.dot} ${status.state === "closed" ? "" : "animate-pulse"}`}></span>
              {statusText}
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
            {selectedPass.altitude} ü. M. · Strassenzustand und Velo-Frequenz beobachten.
            {selectedPass.note && (
              <span className="block mt-1 text-amber-400/80 text-sm">⚠ {selectedPass.note}</span>
            )}
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

      <section className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
            Pass auswählen
          </div>
          <div className="inline-flex bg-slate-900 border border-slate-800 rounded-full p-1 text-xs font-medium">
            <button
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
                view === "list" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Liste
            </button>
            <button
              onClick={() => setView("map")}
              aria-pressed={view === "map"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
                view === "map" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              Karte
            </button>
          </div>
        </div>

        {view === "map" ? (
          <div className="space-y-3">
            <PassMap
              passes={ALL_PASSES}
              selectedId={selectedPassId}
              today={today}
              onSelect={setSelectedPassId}
            />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400 px-2">
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                Webcam zeigt offene Passstrasse
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                Öffnet innerhalb 2 Wochen
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                Öffnet später
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {REGIONS.map((region) => (
              <div key={region.name}>
                <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
                  {region.name}
                </div>
                <div className="flex flex-wrap gap-2">
                  {region.passes.map((pass) => {
                    const active = selectedPassId === pass.id;
                    const dot = cyclingDot(cyclingStatus(pass, today));
                    return (
                      <motion.button
                        key={pass.id}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setSelectedPassId(pass.id)}
                        aria-pressed={active}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all border ${
                          active
                            ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                        {pass.name}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <main className="max-w-6xl mx-auto space-y-12">
        {/* Opening dates strip — context for cyclists planning the season */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              <CalendarDays className="w-3 h-3" />
              <span>Voraussichtlich 2026</span>
            </div>
            <div className="text-xl font-semibold text-white">
              {selectedPass.status.state === "open"
                ? "Offen"
                : selectedPass.status.state === "partial"
                ? `bis ${selectedPass.status.until}`
                : selectedPass.status.opening ?? "—"}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              Ø Öffnung (10 J.)
            </div>
            <div className="text-xl font-semibold text-white">
              {selectedPass.history.avg}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              Spannweite
            </div>
            <div className="text-xl font-semibold text-white">
              {selectedPass.history.earliest}<span className="text-slate-600 mx-1">–</span>{selectedPass.history.latest}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              Geöffnet 2025
            </div>
            <div className="text-xl font-semibold text-white">
              {selectedPass.history.last}
            </div>
          </div>
        </section>

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

        {/* History Grid — only for passes with a Firestore archive. */}
        {selectedPass.archiveId && (
        <section>
          <div className="flex items-center gap-3 mb-8">
            <History className="w-5 h-5 text-slate-500" />
            <h2 className="text-xl font-semibold">
              Letzte {Math.max(0, captures.length - 1)} Aufnahmen
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
        )}
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

      <footer className="max-w-6xl mx-auto mt-24 py-12 border-t border-slate-800 text-center space-y-2">
        <p className="text-slate-500 text-sm">
          Webcam {selectedPass.name} · Datenquelle:{" "}
          <a
            href={selectedPass.source.href}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300 underline-offset-4 hover:underline transition-colors"
          >
            {selectedPass.source.label}
          </a>
        </p>
        <p className="text-slate-700 text-xs">
          Status- und Öffnungsdaten:{" "}
          <a
            href="https://alpen-paesse.ch/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-500 underline-offset-4 hover:underline transition-colors"
          >
            alpen-paesse.ch
          </a>
        </p>
      </footer>
    </div>
  );
}
