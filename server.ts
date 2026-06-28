import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import fs from "fs";
import jwt from "jsonwebtoken";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();
app.set("trust proxy", 1);
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "lisans-super-secret-key-123";

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for Vite development, in prod should be strict
  crossOriginEmbedderPolicy: false
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: "Too many requests from this IP, please try again after 15 minutes" },
  validate: false
});

const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 login requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again after an hour" },
  validate: false
});

app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit JSON body size to prevent payload exhaustion


// Ensure .data directory exists
const dataDir = path.join(process.cwd(), ".data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize Database
const dbPath = path.join(dataDir, "lisans.db");
const db = new Database(dbPath);

// Execute schema
try {
  const schemaPath = path.join(process.cwd(), "schema.sql");
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schema);
    console.log("Database schema initialized.");
  }
} catch (err) {
  console.error("Error executing schema:", err);
}

// Enable WAL mode for better performance
db.pragma("journal_mode = WAL");

// Setup simple admin auth middleware
const authenticateAdmin = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// --- API Routes ---

app.use("/api/", apiLimiter);

app.post("/api/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;
  // Hardcoded admin for this example, should be in DB in real scenario
  if (username === "admin" && password === "admin123") {
    const token = jwt.sign({ username: "admin", role: "admin" }, JWT_SECRET, {
      expiresIn: "1d",
    });
    return res.json({ token });
  }
  return res.status(401).json({ error: "Invalid credentials" });
});

// Dashboard stats
app.get("/api/stats", authenticateAdmin, (req, res) => {
  const totalCompanies = db.prepare('SELECT COUNT(*) as count FROM "Companies"').get() as { count: number };
  const totalLicenses = db.prepare('SELECT COUNT(*) as count FROM "Licenses"').get() as { count: number };
  const activeLicenses = db.prepare('SELECT COUNT(*) as count FROM "Licenses" WHERE Status = 1').get() as { count: number };
  const recentErrors = db.prepare('SELECT COUNT(*) as count FROM "ErrorLogs" WHERE IsResolved = 0').get() as { count: number };

  res.json({
    totalCompanies: totalCompanies.count,
    totalLicenses: totalLicenses.count,
    activeLicenses: activeLicenses.count,
    recentErrors: recentErrors.count,
  });
});

// Companies
app.get("/api/companies", authenticateAdmin, (req, res) => {
  const companies = db.prepare('SELECT * FROM "Companies" ORDER BY CreatedAt DESC').all();
  res.json(companies);
});

app.post("/api/companies", authenticateAdmin, (req, res) => {
  const { Name, Code, Email, Phone, Address, ContactPerson } = req.body;
  try {
    const stmt = db.prepare(`
      INSERT INTO "Companies" (Name, Code, Email, Phone, Address, ContactPerson, CreatedAt, IsActive)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1)
    `);
    const result = stmt.run(Name, Code, Email, Phone, Address, ContactPerson);
    res.json({ id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Licenses
app.get("/api/licenses", authenticateAdmin, (req, res) => {
  const licenses = db.prepare(`
    SELECT L.*, C.Name as CompanyName 
    FROM "Licenses" L
    JOIN "Companies" C ON L.CompanyId = C.Id
    ORDER BY L.CreatedAt DESC
  `).all();
  res.json(licenses);
});

app.post("/api/licenses", authenticateAdmin, (req, res) => {
  const { CompanyId, Type, StartDate, ExpiryDate, MaxUsers, MaxDevices, EnableOfflineMode, EnableSync } = req.body;
  
  // Generate random license key
  const LicenseKey = require('crypto').randomBytes(16).toString('hex').toUpperCase().match(/.{1,4}/g)?.join('-') || "INVALID-KEY";
  
  try {
    const stmt = db.prepare(`
      INSERT INTO "Licenses" (LicenseKey, CompanyId, Type, Status, StartDate, ExpiryDate, CreatedAt, MaxUsers, MaxDevices, EnableOfflineMode, EnableSync)
      VALUES (?, ?, ?, 1, ?, ?, datetime('now'), ?, ?, ?, ?)
    `);
    const result = stmt.run(LicenseKey, CompanyId, Type, StartDate, ExpiryDate, MaxUsers, MaxDevices, EnableOfflineMode, EnableSync);
    res.json({ id: result.lastInsertRowid, LicenseKey });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/licenses/:id/status", authenticateAdmin, (req, res) => {
  const { Status } = req.body;
  try {
    const stmt = db.prepare('UPDATE "Licenses" SET Status = ? WHERE Id = ?');
    stmt.run(Status, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// API Keys
app.get("/api/apikeys", authenticateAdmin, (req, res) => {
  const keys = db.prepare(`
    SELECT A.*, C.Name as CompanyName 
    FROM "ApiKeys" A
    JOIN "Companies" C ON A.CompanyId = C.Id
    ORDER BY A.CreatedAt DESC
  `).all();
  res.json(keys);
});

app.post("/api/apikeys", authenticateAdmin, (req, res) => {
  const { CompanyId, Name, ExpiryDate } = req.body;
  
  const Key = 'ak_' + require('crypto').randomBytes(32).toString('hex');
  
  try {
    const stmt = db.prepare(`
      INSERT INTO "ApiKeys" (Key, CompanyId, Name, Status, CreatedAt, ExpiryDate)
      VALUES (?, ?, ?, 1, datetime('now'), ?)
    `);
    const result = stmt.run(Key, CompanyId, Name, ExpiryDate);
    res.json({ id: result.lastInsertRowid, Key });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/apikeys/:id/status", authenticateAdmin, (req, res) => {
  const { Status } = req.body;
  try {
    const stmt = db.prepare('UPDATE "ApiKeys" SET Status = ? WHERE Id = ?');
    stmt.run(Status, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Error Logs
app.get("/api/logs", authenticateAdmin, (req, res) => {
  const logs = db.prepare(`
    SELECT E.*, C.Name as CompanyName 
    FROM "ErrorLogs" E
    LEFT JOIN "Companies" C ON E.CompanyId = C.Id
    ORDER BY E.Timestamp DESC
    LIMIT 100
  `).all();
  res.json(logs);
});

app.put("/api/logs/:id/resolve", authenticateAdmin, (req, res) => {
  try {
    const stmt = db.prepare(`
      UPDATE "ErrorLogs" 
      SET IsResolved = 1, ResolvedAt = datetime('now'), ResolvedBy = 'Admin' 
      WHERE Id = ?
    `);
    stmt.run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Client API Routes for Android App ---

// Client authentication middleware
const authenticateClient = (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (!apiKey) return res.status(401).json({ error: "API Key required. Please provide 'x-api-key' header." });

  try {
    const keyRecord = db.prepare(`
      SELECT * FROM "ApiKeys" 
      WHERE Key = ? AND Status = 1 
      AND (ExpiryDate IS NULL OR ExpiryDate > datetime('now'))
    `).get(apiKey) as any;

    if (!keyRecord) {
      return res.status(401).json({ error: "Invalid, inactive, or expired API Key" });
    }

    req.client = { CompanyId: keyRecord.CompanyId };
    next();
  } catch (err: any) {
    return res.status(500).json({ error: "Internal server error during authentication" });
  }
};

// 0. Verify Key
app.get("/api/client/verify", authenticateClient, (req: any, res: any) => {
  const company = db.prepare('SELECT Name FROM "Companies" WHERE Id = ?').get(req.client.CompanyId) as any;
  res.json({
    valid: true,
    companyId: req.client.CompanyId,
    companyName: company?.Name
  });
});

// 1. Get Cari Hesaplar (Customers)
app.get("/api/client/carihesaplar", authenticateClient, (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const since = req.query.since; 

  try {
    let query = 'SELECT * FROM "CariHesaplar" WHERE CompanyId = ?';
    let params: any[] = [companyId];

    if (since) {
      query += ' AND LastSyncAt > ?';
      params.push(since);
    }

    const records = db.prepare(query).all(...params);
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Stok Kartlar (Products)
app.get("/api/client/stokkartlar", authenticateClient, (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const since = req.query.since; 

  try {
    let query = 'SELECT * FROM "StokKartlar" WHERE CompanyId = ?';
    let params: any[] = [companyId];

    if (since) {
      query += ' AND LastSyncAt > ?';
      params.push(since);
    }

    const records = db.prepare(query).all(...params);
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Sync/Push local orders from Android to Server Queue
app.post("/api/client/siparisler/sync", authenticateClient, (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const orders = req.body.orders; 

  if (!Array.isArray(orders)) {
    return res.status(400).json({ error: "Expected 'orders' array in body" });
  }

  const insertQueue = db.prepare(`
    INSERT INTO "SyncQueue" (CompanyId, DocumentType, ExternalId, DocumentDate, Payload, Status, QueuedAt)
    VALUES (?, 'SIPARIS', ?, ?, ?, 0, datetime('now'))
  `);

  try {
    const transaction = db.transaction((ordersToSync) => {
      for (const order of ordersToSync) {
        // Siparişi doğrudan ERP'ye atmıyoruz, SyncQueue tablosuna JSON (Payload) olarak atıyoruz.
        // Masaüstü servisiniz bu kuyruktan okuyup Mikro'ya basacak.
        insertQueue.run(
          companyId, 
          order.EvrakNo, 
          order.EvrakTarihi || new Date().toISOString(),
          JSON.stringify(order)
        );
      }
    });
    
    transaction(orders);
    res.json({ success: true, syncedCount: orders.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Log errors from Android app
app.post("/api/client/logs", authenticateClient, (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const { AppVersion, DeviceId, Level, Source, Message, StackTrace } = req.body;

  try {
    const stmt = db.prepare(`
      INSERT INTO "ErrorLogs" (CompanyId, AppVersion, MachineName, Level, Source, Message, Details, Timestamp, IsResolved)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)
    `);
    stmt.run(companyId, AppVersion, DeviceId, Level || 3, Source, Message, StackTrace);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ERP / Windows Sync Service API Routes ---

// 1. Bulk Upsert Cari Hesaplar (Customers) from Windows ERP
app.post("/api/erp/carihesaplar/bulk", authenticateClient, (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const items = req.body.items; // Expecting array of { CariKodu, CariAdi, VergiDairesi, VergiNumarasi, Bakiye }

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "Expected 'items' array in body" });
  }

  const upsertStmt = db.prepare(`
    INSERT INTO "CariHesaplar" (CompanyId, CariKodu, CariAdi, VergiDairesi, VergiNumarasi, Bakiye, LastSyncAt)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(CompanyId, CariKodu) DO UPDATE SET
      CariAdi = excluded.CariAdi,
      VergiDairesi = excluded.VergiDairesi,
      VergiNumarasi = excluded.VergiNumarasi,
      Bakiye = excluded.Bakiye,
      LastSyncAt = datetime('now')
  `);

  try {
    const transaction = db.transaction((data) => {
      for (const item of data) {
        upsertStmt.run(
          companyId,
          item.CariKodu,
          item.CariAdi,
          item.VergiDairesi || null,
          item.VergiNumarasi || null,
          parseFloat(item.Bakiye) || 0.0
        );
      }
    });

    transaction(items);
    res.json({ success: true, processedCount: items.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Bulk Upsert Stok Kartları (Products) from Windows ERP
app.post("/api/erp/stokkartlar/bulk", authenticateClient, (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const items = req.body.items; // Expecting array of { StokKodu, StokAdi, Birim, Barkod, SatisFiyati1 }

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "Expected 'items' array in body" });
  }

  const upsertStmt = db.prepare(`
    INSERT INTO "StokKartlar" (CompanyId, StokKodu, StokAdi, Birim, Barkod, SatisFiyati1, LastSyncAt)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(CompanyId, StokKodu) DO UPDATE SET
      StokAdi = excluded.StokAdi,
      Birim = excluded.Birim,
      Barkod = excluded.Barkod,
      SatisFiyati1 = excluded.SatisFiyati1,
      LastSyncAt = datetime('now')
  `);

  try {
    const transaction = db.transaction((data) => {
      for (const item of data) {
        upsertStmt.run(
          companyId,
          item.StokKodu,
          item.StokAdi,
          item.Birim || null,
          item.Barkod || null,
          parseFloat(item.SatisFiyati1) || 0.0
        );
      }
    });

    transaction(items);
    res.json({ success: true, processedCount: items.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get Pending Orders from Queue (Windows ERP polls this)
app.get("/api/erp/queue", authenticateClient, (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  try {
    // Fetch pending orders (Status = 0)
    const pendingItems = db.prepare(`
      SELECT Id, DocumentType, ExternalId, DocumentDate, Payload, QueuedAt 
      FROM "SyncQueue" 
      WHERE CompanyId = ? AND Status = 0
      ORDER BY Priority DESC, QueuedAt ASC
    `).all(companyId);

    // Automatically mark retrieved items as "Processing" (Status = 3) to prevent double retrieval
    if (pendingItems.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE "SyncQueue" 
        SET Status = 3, ProcessingStartedAt = datetime('now') 
        WHERE Id = ?
      `);
      const transaction = db.transaction((items) => {
        for (const item of items) {
          updateStmt.run(item.Id);
        }
      });
      transaction(pendingItems);
    }

    res.json(pendingItems);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update Queue Status (Windows ERP posts the result of processing)
app.post("/api/erp/queue/status", authenticateClient, (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const { Id, Status, LastError, MikroRecno } = req.body; // Status: 1 = Completed, 2 = Failed

  if (!Id || Status === undefined) {
    return res.status(400).json({ error: "Missing required fields: Id, Status" });
  }

  try {
    const stmt = db.prepare(`
      UPDATE "SyncQueue"
      SET Status = ?, 
          LastError = ?, 
          MikroRecno = ?, 
          CompletedAt = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
          RetryCount = CASE WHEN ? = 2 THEN RetryCount + 1 ELSE RetryCount END
      WHERE Id = ? AND CompanyId = ?
    `);
    
    const result = stmt.run(Status, LastError || null, MikroRecno || null, Status, Status, Id, companyId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Queue item not found or unauthorized" });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
