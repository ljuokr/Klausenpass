
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Firebase setup
  let db: any = null;
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (firebaseConfig.apiKey) {
      const firebaseApp = initializeApp(firebaseConfig);
      db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
      console.log("Firebase initialized");
    } else {
      console.log("Firebase config found but empty. Capturing will not start.");
    }
  } else {
    console.log("Firebase config not found. Capturing will not start.");
  }

  // Camera URLs for different passes
  const PASSES = [
    { id: "613", name: "Klausenpass" },
    { id: "838", name: "Gotthardpass" },
    { id: "614", name: "Grimselpass" },
    { id: "615", name: "Sustenpass" },
    { id: "616", name: "Furkapass" },
    { id: "618", name: "Oberalppass" },
    { id: "619", name: "Nufenenpass" },
    { id: "813", name: "San Bernardino" },
    { id: "621", name: "Simplonpass" },
    { id: "610", name: "Brünigpass" },
    { id: "611", name: "Jaunpass" },
    { id: "608", name: "Col des Mosses" },
    { id: "609", name: "Saanenmöser" },
    { id: "607", name: "Col de la Forclaz" },
    { id: "625", name: "Gr. St. Bernhard" },
    { id: "1063", name: "Flüelapass" },
    { id: "1062", name: "Albulapass" },
    { id: "1061", name: "Julierpass" },
    { id: "1060", name: "Ofenpass" },
    { id: "1059", name: "Berninapass" },
    { id: "1058", name: "Malojapass" },
    { id: "1064", name: "Lukmanierpass" },
    { id: "1069", name: "Splügenpass" },
  ];

  // Function to run capture cycle
  const runCaptureCycle = async () => {
    if (!db) return;
    try {
      const now = new Date().toISOString();
      console.log(`[${now}] Starting capture cycle for ${PASSES.length} passes...`);
      const nowMs = Date.now();
      
      const capturePromises = PASSES.map(async (pass) => {
        // Try multiple URL variants
        const urls = [
          `https://webcam.meteonews.ch/standard/640x480/${pass.id}.jpg`,
          `https://webcams.meteonews.net/webcams/standard/640x480/${pass.id}.jpg`
        ];
        
        for (const camUrl of urls) {
          const imageUrl = `${camUrl}?t=${nowMs}`;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

            const response = await fetch(imageUrl, { 
              method: 'GET',
              signal: controller.signal,
              headers: { 'Range': 'bytes=0-1023' } // Only first 1KB
            });
            
            clearTimeout(timeoutId);

            if (response.ok) {
              const contentType = response.headers.get('content-type');
              const contentLength = response.headers.get('content-length');
              
              // If size is very small (e.g. < 15KB), it might be a placeholder
              const size = contentLength ? parseInt(contentLength) : 0;
              if (size > 0 && size < 12000) {
                console.warn(`- Placeholder detected for ${pass.name} (${pass.id}) on ${camUrl} (size: ${size})`);
                continue; // Try next URL
              }

              if (contentType && contentType.startsWith('image/')) {
                console.log(`- Storing capture for ${pass.name} (${pass.id}) from ${camUrl}`);
                return addDoc(collection(db, "captures"), {
                  passId: pass.id,
                  passName: pass.name,
                  imageUrl: imageUrl, // Store full URL with timestamp
                  timestamp: serverTimestamp(),
                });
              }
            }
          } catch (fetchErr: any) {
            // ignore and try next
          }
        }
        console.warn(`- No valid source found for ${pass.name} (${pass.id})`);
        return null;
      });

      const results = await Promise.all(capturePromises);
      const storedCount = results.filter(r => r !== null).length;
      console.log(`[${now}] Successfully stored ${storedCount} of ${PASSES.length} captures`);
    } catch (err) {
      console.error("Capture cycle failed:", err);
    }
  };

  // Capture loop
  runCaptureCycle(); // Start immediately
  setInterval(runCaptureCycle, 60000); // And every minute

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", firebaseEnabled: !!db });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
