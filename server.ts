
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

  // Camera URL from test
  const CAM_URL = "https://webcams.meteonews.net/webcams/standard/640x480/613.jpg";

  // Capture loop
  setInterval(async () => {
    if (!db) return;
    try {
      console.log("Capturing image...");
      // In a real scenario, we might want to verify the image exists or fetch it
      // For now, we just record the timestamp and URL
      // MeteoNews usually updates this static URL
      await addDoc(collection(db, "captures"), {
        imageUrl: `${CAM_URL}?t=${Date.now()}`,
        timestamp: serverTimestamp(),
      });
      console.log("Capture stored");
    } catch (err) {
      console.error("Capture failed:", err);
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
