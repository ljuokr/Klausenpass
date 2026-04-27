
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Firebase setup
  let db: any = null;
  let storage: any = null;
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (firebaseConfig.apiKey) {
      const firebaseApp = initializeApp(firebaseConfig);
      db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
      storage = getStorage(firebaseApp);
      // Anonymous auth so we can write to Storage and delete old captures
      // from Firestore. Requires Anonymous sign-in to be enabled in
      // Firebase Console → Authentication → Sign-in method.
      try {
        const auth = getAuth(firebaseApp);
        const cred = await signInAnonymously(auth);
        console.log(`Firebase initialized (anonymous uid: ${cred.user.uid})`);
      } catch (e: any) {
        console.error(
          "Anonymous sign-in failed — enable Anonymous auth in Firebase Console.",
          e?.message,
        );
        storage = null;
      }
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

  // We keep at most KEEP_PER_PASS captures per pass so Firebase Storage
  // (5 GB free tier) doesn't fill up. The frontend renders 24 frames
  // (1 hero + 23 grid), so 24 is the sensible minimum.
  const KEEP_PER_PASS = 24;

  // Function to run capture cycle
  const runCaptureCycle = async () => {
    if (!db || !storage) return;
    try {
      const now = new Date().toISOString();
      console.log(`[${now}] Starting capture cycle for ${PASSES.length} passes...`);
      const nowMs = Date.now();

      const capturePromises = PASSES.map(async (pass) => {
        const sep = pass.url.includes("?") ? "&" : "?";
        const sourceUrl = `${pass.url}${sep}t=${nowMs}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        try {
          // Full image fetch: we now archive the bytes in Firebase
          // Storage so time-lapse plays real history, not "current image
          // 24 times".
          const response = await fetch(sourceUrl, {
            method: "GET",
            signal: controller.signal,
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

          const buf = Buffer.from(await response.arrayBuffer());
          if (buf.byteLength < 5000) {
            console.warn(`- ${pass.name} (${pass.id}): suspicious size ${buf.byteLength} B (likely placeholder)`);
            return null;
          }

          // Upload to Firebase Storage at captures/<passId>/<ts>.jpg
          const storagePath = `captures/${pass.id}/${nowMs}.jpg`;
          const sRef = storageRef(storage, storagePath);
          await uploadBytes(sRef, buf, { contentType });
          const imageUrl = await getDownloadURL(sRef);

          console.log(`- Stored ${pass.name} (${pass.id}): ${buf.byteLength} B`);
          return addDoc(collection(db, "captures"), {
            passId: pass.id,
            passName: pass.name,
            imageUrl,
            storagePath,
            timestamp: serverTimestamp(),
          });
        } catch (err: any) {
          clearTimeout(timeoutId);
          console.warn(`- ${pass.name} (${pass.id}): ${err?.message ?? "fetch failed"}`);
          return null;
        }
      });

      const results = await Promise.all(capturePromises);
      const storedCount = results.filter((r) => r !== null).length;
      console.log(`[${now}] Successfully stored ${storedCount} of ${PASSES.length} captures`);

      // Cleanup: per pass, delete everything beyond the most recent
      // KEEP_PER_PASS captures (Firestore doc + Storage object).
      try {
        const recent = await getDocs(
          query(collection(db, "captures"), orderBy("timestamp", "desc"), limit(800)),
        );
        const counts = new Map<string, number>();
        let pruned = 0;
        for (const d of recent.docs) {
          const data = d.data() as { passId?: string; storagePath?: string };
          if (!data.passId) continue;
          const c = counts.get(data.passId) ?? 0;
          counts.set(data.passId, c + 1);
          if (c >= KEEP_PER_PASS) {
            if (data.storagePath) {
              try {
                await deleteObject(storageRef(storage, data.storagePath));
              } catch {
                // Object may already be gone; ignore.
              }
            }
            await deleteDoc(d.ref);
            pruned++;
          }
        }
        if (pruned > 0) console.log(`  ⤷ pruned ${pruned} old captures`);
      } catch (err: any) {
        console.warn("Cleanup failed:", err?.message ?? err);
      }
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
