
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

  // Curated list of winter passes — must stay aligned with REGIONS in
  // src/App.tsx. The Firestore documents are queried by `passId`, which
  // matches each Pass's `archiveId` on the frontend. Klausenpass and San
  // Bernardino keep their legacy meteonews IDs (613, 813) so existing
  // captures remain readable; new passes use slugs.
  const PASSES = [
    { id: "613",            name: "Klausenpass",      url: "https://webcams.meteonews.net/webcams/standard/640x480/613.jpg" },
    { id: "sustenpass",     name: "Sustenpass",       url: "https://livecam.sustenpass.ch/Sustenpass000M.jpg" },
    { id: "furkapass",      name: "Furkapass",        url: "https://webcam.dieselcrew.ch/tiefenbach.jpg" },
    { id: "grimselpass",    name: "Grimselpass",      url: "https://images.bergfex.at/webcams/?id=22208&format=4" },
    { id: "gotthardpass",   name: "Gotthardpass",     url: "https://webcam.afbn.ch/H_SCH_002,542_N_KAM_001_Nord.jpg" },
    { id: "oberalppass",    name: "Oberalppass",      url: "https://images.bergfex.at/webcams/?id=365&format=4" },
    { id: "nufenenpass",    name: "Nufenenpass",      url: "https://webcams.meteonews.net/webcams/standard/640x480/12270.jpg" },
    { id: "gr-st-bernhard", name: "Gr. St. Bernhard", url: "https://images.bergfex.at/webcams/?id=25197&format=4" },
    { id: "813",            name: "San Bernardino",   url: "https://images.bergfex.at/webcams/?id=5676&format=4" },
    { id: "spluegenpass",   name: "Splügenpass",      url: "https://webcams.meteonews.net/webcams/standard/640x480/14003.jpg" },
    { id: "albulapass",     name: "Albulapass",       url: "https://webcams.meteonews.net/webcams/standard/640x480/11546.jpg" },
    { id: "fluelapass",     name: "Flüelapass",       url: "https://webcams.meteonews.net/webcams/standard/640x480/13501.jpg" },
    { id: "umbrailpass",    name: "Umbrailpass",      url: "https://images.bergfex.at/webcams/?id=4771&format=4" },
  ];

  // Function to run capture cycle
  const runCaptureCycle = async () => {
    if (!db) return;
    try {
      const now = new Date().toISOString();
      console.log(`[${now}] Starting capture cycle for ${PASSES.length} passes...`);
      const nowMs = Date.now();

      const capturePromises = PASSES.map(async (pass) => {
        const sep = pass.url.includes("?") ? "&" : "?";
        const imageUrl = `${pass.url}${sep}t=${nowMs}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        try {
          // HEAD-style probe: ask only for the first 1 KB to validate
          // type + size cheaply. Some servers ignore Range and return 200
          // with the full body; both are fine because we only use
          // headers here.
          const response = await fetch(imageUrl, {
            method: "GET",
            signal: controller.signal,
            headers: { Range: "bytes=0-1023" },
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            console.warn(`- ${pass.name} (${pass.id}): HTTP ${response.status}`);
            return null;
          }

          const contentType = response.headers.get("content-type") || "";
          if (!contentType.startsWith("image/")) {
            console.warn(`- ${pass.name} (${pass.id}): not an image (${contentType})`);
            return null;
          }

          // Heuristic: tiny payloads are usually "out of service" stubs
          // or 404 fallbacks. If the server returned a partial Range
          // response, Content-Length is 1024 — fine. We only flag when
          // the server returned the full body and it's suspiciously small.
          const ranged = response.status === 206;
          const len = parseInt(response.headers.get("content-length") || "0");
          if (!ranged && len > 0 && len < 5000) {
            console.warn(`- ${pass.name} (${pass.id}): suspicious size ${len} B`);
            return null;
          }

          console.log(`- Storing capture for ${pass.name} (${pass.id})`);
          return addDoc(collection(db, "captures"), {
            passId: pass.id,
            passName: pass.name,
            imageUrl,
            timestamp: serverTimestamp(),
          });
        } catch (err) {
          clearTimeout(timeoutId);
          console.warn(`- ${pass.name} (${pass.id}): fetch failed`);
          return null;
        }
      });

      const results = await Promise.all(capturePromises);
      const storedCount = results.filter((r) => r !== null).length;
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
