import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { db, initializeSchema } from "./db";

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
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
app.get("/api/stats", authenticateAdmin, async (req, res) => {
  try {
    const totalCompanies = await db("Companies").count({ count: "*" }).first();
    const totalLicenses = await db("Licenses").count({ count: "*" }).first();
    const activeLicenses = await db("Licenses").where({ Status: 1 }).count({ count: "*" }).first();
    const recentErrors = await db("ErrorLogs").where({ IsResolved: 0 }).count({ count: "*" }).first();

    res.json({
      totalCompanies: Number(totalCompanies?.count || 0),
      totalLicenses: Number(totalLicenses?.count || 0),
      activeLicenses: Number(activeLicenses?.count || 0),
      recentErrors: Number(recentErrors?.count || 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Companies
app.get("/api/companies", authenticateAdmin, async (req, res) => {
  try {
    const companies = await db("Companies").orderBy("CreatedAt", "desc");
    res.json(companies);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/companies", authenticateAdmin, async (req, res) => {
  const { Name, Code, Email, Phone, Address, ContactPerson, TenantId } = req.body;
  
  // Generate random tenant ID if not provided
  const finalTenantId = TenantId && TenantId.trim() !== "" 
    ? TenantId.trim() 
    : `tnt_${require('crypto').randomBytes(6).toString('hex')}`;

  try {
    const result = await db("Companies").insert({
      Name,
      Code,
      TenantId: finalTenantId,
      Email,
      Phone,
      Address,
      ContactPerson,
      CreatedAt: new Date().toISOString(),
      IsActive: 1
    }).returning("Id");
    
    const id = result[0]?.Id || result[0]?.id || result[0];
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Licenses
app.get("/api/licenses", authenticateAdmin, async (req, res) => {
  try {
    const licenses = await db("Licenses as L")
      .select("L.*", "C.Name as CompanyName")
      .join("Companies as C", "L.CompanyId", "C.Id")
      .orderBy("L.CreatedAt", "desc");
    res.json(licenses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/licenses", authenticateAdmin, async (req, res) => {
  const { CompanyId, Type, StartDate, ExpiryDate, MaxUsers, MaxDevices, EnableOfflineMode, EnableSync } = req.body;
  
  // Generate random license key
  const LicenseKey = require('crypto').randomBytes(16).toString('hex').toUpperCase().match(/.{1,4}/g)?.join('-') || "INVALID-KEY";
  
  try {
    const result = await db("Licenses").insert({
      LicenseKey,
      CompanyId,
      Type,
      Status: 1,
      StartDate,
      ExpiryDate,
      CreatedAt: new Date().toISOString(),
      MaxUsers,
      MaxDevices,
      EnableOfflineMode: EnableOfflineMode ? 1 : 0,
      EnableSync: EnableSync ? 1 : 0
    }).returning("Id");
    
    const id = result[0]?.Id || result[0]?.id || result[0];
    res.json({ id, LicenseKey });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/licenses/:id/status", authenticateAdmin, async (req, res) => {
  const { Status } = req.body;
  try {
    await db("Licenses").where({ Id: req.params.id }).update({ Status });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// API Keys
app.get("/api/apikeys", authenticateAdmin, async (req, res) => {
  try {
    const keys = await db("ApiKeys as A")
      .select("A.*", "C.Name as CompanyName")
      .join("Companies as C", "A.CompanyId", "C.Id")
      .orderBy("A.CreatedAt", "desc");
    res.json(keys);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/apikeys", authenticateAdmin, async (req, res) => {
  const { CompanyId, Name, ExpiryDate } = req.body;
  
  const Key = 'ak_' + require('crypto').randomBytes(32).toString('hex');
  
  try {
    const result = await db("ApiKeys").insert({
      Key,
      CompanyId,
      Name,
      Status: 1,
      CreatedAt: new Date().toISOString(),
      ExpiryDate
    }).returning("Id");
    
    const id = result[0]?.Id || result[0]?.id || result[0];
    res.json({ id, Key });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/apikeys/:id/status", authenticateAdmin, async (req, res) => {
  const { Status } = req.body;
  try {
    await db("ApiKeys").where({ Id: req.params.id }).update({ Status });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Error Logs
app.get("/api/logs", authenticateAdmin, async (req, res) => {
  try {
    const logs = await db("ErrorLogs as E")
      .select("E.*", "C.Name as CompanyName")
      .leftJoin("Companies as C", "E.CompanyId", "C.Id")
      .orderBy("E.Timestamp", "desc")
      .limit(100);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/logs/:id/resolve", authenticateAdmin, async (req, res) => {
  try {
    await db("ErrorLogs").where({ Id: req.params.id }).update({
      IsResolved: 1,
      ResolvedAt: new Date().toISOString(),
      ResolvedBy: 'Admin'
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Client API Routes for Android App ---

// Client authentication middleware
const authenticateClient = async (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (!apiKey) return res.status(401).json({ error: "API Key required. Please provide 'x-api-key' header." });

  try {
    const keyRecord = await db("ApiKeys")
      .where({ Key: apiKey, Status: 1 })
      .andWhere(function() {
        this.whereNull("ExpiryDate").orWhere("ExpiryDate", ">", new Date().toISOString());
      })
      .first();

    if (!keyRecord) {
      return res.status(401).json({ error: "Invalid, inactive, or expired API Key" });
    }

    req.client = { CompanyId: keyRecord.CompanyId };
    next();
  } catch (err: any) {
    console.error("Auth client error:", err);
    return res.status(500).json({ error: "Internal server error during authentication" });
  }
};

// 0. Verify Key
app.get("/api/client/verify", authenticateClient, async (req: any, res: any) => {
  try {
    const company = await db("Companies").where({ Id: req.client.CompanyId }).first();
    res.json({
      valid: true,
      companyId: req.client.CompanyId,
      companyName: company?.Name
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Get Cari Hesaplar (Customers)
app.get("/api/client/carihesaplar", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const since = req.query.since; 

  try {
    let query = db("CariHesaplar").where({ CompanyId: companyId });

    if (since) {
      query = query.andWhere("LastSyncAt", ">", since);
    }

    const records = await query;
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Stok Kartlar (Products)
app.get("/api/client/stokkartlar", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const since = req.query.since; 

  try {
    let query = db("StokKartlar").where({ CompanyId: companyId });

    if (since) {
      query = query.andWhere("LastSyncAt", ">", since);
    }

    const records = await query;
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Sync/Push local orders from Android to Server Queue
app.post("/api/client/siparisler/sync", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const orders = req.body.orders; 

  if (!Array.isArray(orders)) {
    return res.status(400).json({ error: "Expected 'orders' array in body" });
  }

  try {
    await db.transaction(async (trx) => {
      for (const order of orders) {
        await trx("SyncQueue").insert({
          CompanyId: companyId,
          DocumentType: 'SIPARIS',
          ExternalId: order.EvrakNo,
          DocumentDate: order.EvrakTarihi || new Date().toISOString(),
          Payload: JSON.stringify(order),
          Status: 0,
          QueuedAt: new Date().toISOString()
        });
      }
    });
    
    res.json({ success: true, syncedCount: orders.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Log errors from Android app
app.post("/api/client/logs", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const { AppVersion, DeviceId, Level, Source, Message, StackTrace } = req.body;

  try {
    await db("ErrorLogs").insert({
      CompanyId: companyId,
      AppVersion,
      MachineName: DeviceId,
      Level: Level || 3,
      Source,
      Message,
      Details: StackTrace,
      Timestamp: new Date().toISOString(),
      IsResolved: 0
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ERP / Windows Sync Service API Routes ---

// 1. Bulk Upsert Cari Hesaplar (Customers) from Windows ERP
app.post("/api/erp/carihesaplar/bulk", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const items = req.body.items; 

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "Expected 'items' array in body" });
  }

  try {
    await db.transaction(async (trx) => {
      for (const item of items) {
        const bakiye = parseFloat(item.Bakiye) || 0.0;
        const now = new Date().toISOString();
        const vergiDairesi = item.VergiDairesi || null;
        const vergiNumarasi = item.VergiNumarasi || null;

        if (db.client.config.client === "mysql2") {
          await trx.raw(`
            INSERT INTO CariHesaplar (CompanyId, CariKodu, CariAdi, VergiDairesi, VergiNumarasi, Bakiye, LastSyncAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              CariAdi = VALUES(CariAdi),
              VergiDairesi = VALUES(VergiDairesi),
              VergiNumarasi = VALUES(VergiNumarasi),
              Bakiye = VALUES(Bakiye),
              LastSyncAt = VALUES(LastSyncAt)
          `, [companyId, item.CariKodu, item.CariAdi, vergiDairesi, vergiNumarasi, bakiye, now]);
        } else {
          await trx.raw(`
            INSERT INTO "CariHesaplar" ("CompanyId", "CariKodu", "CariAdi", "VergiDairesi", "VergiNumarasi", "Bakiye", "LastSyncAt")
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT("CompanyId", "CariKodu") DO UPDATE SET
              "CariAdi" = EXCLUDED."CariAdi",
              "VergiDairesi" = EXCLUDED."VergiDairesi",
              "VergiNumarasi" = EXCLUDED."VergiNumarasi",
              "Bakiye" = EXCLUDED."Bakiye",
              "LastSyncAt" = EXCLUDED."LastSyncAt"
          `, [companyId, item.CariKodu, item.CariAdi, vergiDairesi, vergiNumarasi, bakiye, now]);
        }
      }
    });

    res.json({ success: true, processedCount: items.length });
  } catch (err: any) {
    console.error("Bulk cari error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Bulk Upsert Stok Kartları (Products) from Windows ERP
app.post("/api/erp/stokkartlar/bulk", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const items = req.body.items; 

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "Expected 'items' array in body" });
  }

  try {
    await db.transaction(async (trx) => {
      for (const item of items) {
        const fiyat = parseFloat(item.SatisFiyati1) || 0.0;
        const now = new Date().toISOString();
        const birim = item.Birim || null;
        const barkod = item.Barkod || null;

        if (db.client.config.client === "mysql2") {
          await trx.raw(`
            INSERT INTO StokKartlar (CompanyId, StokKodu, StokAdi, Birim, Barkod, SatisFiyati1, LastSyncAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              StokAdi = VALUES(StokAdi),
              Birim = VALUES(Birim),
              Barkod = VALUES(Barkod),
              SatisFiyati1 = VALUES(SatisFiyati1),
              LastSyncAt = VALUES(LastSyncAt)
          `, [companyId, item.StokKodu, item.StokAdi, birim, barkod, fiyat, now]);
        } else {
          await trx.raw(`
            INSERT INTO "StokKartlar" ("CompanyId", "StokKodu", "StokAdi", "Birim", "Barkod", "SatisFiyati1", "LastSyncAt")
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT("CompanyId", "StokKodu") DO UPDATE SET
              "StokAdi" = EXCLUDED."StokAdi",
              "Birim" = EXCLUDED."Birim",
              "Barkod" = EXCLUDED."Barkod",
              "SatisFiyati1" = EXCLUDED."SatisFiyati1",
              "LastSyncAt" = EXCLUDED."LastSyncAt"
          `, [companyId, item.StokKodu, item.StokAdi, birim, barkod, fiyat, now]);
        }
      }
    });

    res.json({ success: true, processedCount: items.length });
  } catch (err: any) {
    console.error("Bulk stok error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Get Pending Orders from Queue (Windows ERP polls this)
app.get("/api/erp/queue", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  try {
    // Fetch pending orders (Status = 0)
    const pendingItems = await db("SyncQueue")
      .select("Id", "DocumentType", "ExternalId", "DocumentDate", "Payload", "QueuedAt")
      .where({ CompanyId: companyId, Status: 0 })
      .orderBy("Priority", "desc")
      .orderBy("QueuedAt", "asc");

    // Automatically mark retrieved items as "Processing" (Status = 3) to prevent double retrieval
    if (pendingItems.length > 0) {
      await db.transaction(async (trx) => {
        const ids = pendingItems.map(item => item.Id);
        await trx("SyncQueue")
          .whereIn("Id", ids)
          .update({
            Status: 3,
            ProcessingStartedAt: new Date().toISOString()
          });
      });
    }

    res.json(pendingItems);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update Queue Status (Windows ERP posts the result of processing)
app.post("/api/erp/queue/status", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const { Id, Status, LastError, MikroRecno } = req.body; // Status: 1 = Completed, 2 = Failed

  if (!Id || Status === undefined) {
    return res.status(400).json({ error: "Missing required fields: Id, Status" });
  }

  try {
    const updatePayload: any = {
      Status,
      LastError: LastError || null,
      MikroRecno: MikroRecno || null,
    };

    if (Status === 1) {
      updatePayload.CompletedAt = new Date().toISOString();
    }
    
    if (Status === 2) {
      updatePayload.RetryCount = db.raw("RetryCount + 1");
    }

    const updatedRows = await db("SyncQueue")
      .where({ Id, CompanyId: companyId })
      .update(updatePayload);
    
    if (updatedRows === 0) {
      return res.status(404).json({ error: "Queue item not found or unauthorized" });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Vite middleware for development
async function startServer() {
  try {
    await initializeSchema();
  } catch (err) {
    console.error("Failed to initialize database schema:", err);
  }

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
