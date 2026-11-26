import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import coursesRoutes from "./routes/courses.js";
import adminRoutes from "./routes/admin.js";
import telegramRoutes from "./routes/telegram.js";
import { attachSessionUser } from "./middleware/auth.js";
import { dataDir, sqlGet, useRemoteDb } from "./db.js";
import { LibsqlSessionStore } from "./lib/libsql-session-store.js";
import { handleLegacyTelegramPost } from "./lib/telegram.js";
import {
  isProtectedLegacyPath,
  checkLegacyPathAccess,
  resolveLegacyFile,
} from "./lib/legacy-static.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..", "..");
const isVercel = Boolean(process.env.VERCEL);

if (!process.env.LMS_PUBLIC_URL && process.env.VERCEL_URL) {
  process.env.LMS_PUBLIC_URL = `https://${process.env.VERCEL_URL}`;
}

const app = express();

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const sessionOptions = {
  secret: process.env.SESSION_SECRET || "megalife-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  name: "megalife.sid",
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
};

let sessionMiddleware;
async function resolveSessionStore() {
  if (isVercel || useRemoteDb()) {
    if (!process.env.TURSO_DATABASE_URL) {
      throw new Error(
        "На Vercel нужны TURSO_DATABASE_URL и TURSO_AUTH_TOKEN (Settings → Environment Variables).",
      );
    }
    return new LibsqlSessionStore();
  }
  const connectSqlite3 = (await import("connect-sqlite3")).default;
  const SQLiteStore = connectSqlite3(session);
  return new SQLiteStore({ dir: dataDir, db: "sessions.sqlite" });
}

app.use((req, res, next) => {
  if (sessionMiddleware) return sessionMiddleware(req, res, next);
  resolveSessionStore()
    .then((store) => {
      sessionMiddleware = session({ ...sessionOptions, store });
      sessionMiddleware(req, res, next);
    })
    .catch(next);
});
app.use(attachSessionUser);

function csrfGuard(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (
    req.path.startsWith("/telegram") ||
    req.originalUrl.startsWith("/api/telegram") ||
    req.originalUrl.endsWith(".php")
  ) {
    return next();
  }
  if (req.path.startsWith("/auth/login") || req.path.startsWith("/auth/register")) {
    return next();
  }
  const token = req.get("x-csrf-token");
  if (!token || token !== req.session?.csrfToken) {
    return res.status(403).json({ error: "Недействительный CSRF-токен." });
  }
  next();
}

app.use("/api", csrfGuard);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Попробуйте позже." },
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/telegram", telegramRoutes);

if (isVercel) {
  app.post("/send_test.php", (req, res) => handleLegacyTelegramPost(req, res, "main"));
  app.post("/send_homework.php", (req, res) => handleLegacyTelegramPost(req, res, "homework"));
  app.post("/send_reading.php", (req, res) => handleLegacyTelegramPost(req, res, "main"));
  app.post("/send_emotional.php", (req, res) => handleLegacyTelegramPost(req, res, "main"));
  app.post("/send_trainer.php", (req, res) => handleLegacyTelegramPost(req, res, "main"));
  app.post("/send_conformity.php", (req, res) => handleLegacyTelegramPost(req, res, "main"));
  app.post("/send_memory.php", (req, res) => handleLegacyTelegramPost(req, res, "main"));
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, vercel: isVercel });
});

app.get("/api/legacy/material-by-path", async (req, res) => {
  if (!req.session?.userId) return res.json({ material: null });
  const p = req.query.path;
  if (!p) return res.json({ material: null });
  const material = await sqlGet(
    `SELECT id, course_id, title FROM materials WHERE content_url = ? AND is_active = 1`,
    [p],
  );
  res.json({ material: material || null });
});

app.get("/", (req, res) => {
  if (req.session?.userId) {
    return res.redirect("/portal/dashboard.html?welcome=1");
  }
  return res.redirect("/portal/login.html");
});

app.use(async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (!isProtectedLegacyPath(req.path)) return next();

  const check = await checkLegacyPathAccess(req.session?.userId, req.path);
  if (!check.allowed) {
    if (check.reason === "login_required") {
      return res.redirect(`/portal/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return res
      .status(403)
      .type("html")
      .send(
        `<!DOCTYPE html><html lang="ru"><meta charset="utf-8"><title>Доступ закрыт</title><body style="font-family:sans-serif;padding:2rem"><h1>Доступ пока закрыт</h1><p>Раздел откроется после подтверждения администратором.</p><p><a href="/portal/dashboard.html">Вернуться в каталог</a></p></body></html>`,
      );
  }

  if (isVercel) {
    const file = resolveLegacyFile(req.path);
    if (file) return res.sendFile(file);
    return res.status(404).send("Not found");
  }
  return next();
});

if (!isVercel) {
  app.use(express.static(rootDir, { index: false }));
}

export default app;