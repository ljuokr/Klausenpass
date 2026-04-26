
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
    { id: "612", name: "Gotthardpass" },
    { id: "614", name: "Grimselpass" },
    { id: "615", name: "Sustenpass" },
    { id: "616", name: "Furkapass" },
    { id: "618", name: "Oberalppass" },
    { id: "1063", name: "Flüelapass" },
    { id: "1062", name: "Albulapass" },
    { id: "1061", name: "Julierpass" },
  ];

  // Capture loop
  setInterval(async () => {
    if (!db) return;
    try {
      const now = new Date().toISOString();
      console.log(`[${now}] Starting capture cycle for ${PASSES.length} passes...`);
      const nowMs = Date.now();
      
      const capturePromises = PASSES.map(async (pass) => {
        const camUrl = `https://webcams.meteonews.net/webcams/standard/640x480/${pass.id}.jpg`;
        const imageUrl = `${camUrl}?t=${nowMs}`;
        console.log(`- Queuing capture for ${pass.name} (${pass.id})`);
        return addDoc(collection(db, "captures"), {
          passId: pass.id,
          passName: pass.name,
          imageUrl: imageUrl,
          timestamp: serverTimestamp(),
        });
      });

      await Promise.all(capturePromises);
      console.log(`[${now}] Successfully stored ${PASSES.length} captures`);
    } catch (err) {
      console.error("Capture cycle failed:", err);
    }
  }, 60000); // 1 minute

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
