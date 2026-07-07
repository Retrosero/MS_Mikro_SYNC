import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { db, initializeSchema } from "./db";

const app = express();
app.set("trust proxy", 1);
const parsedPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
const PORT = Number.isFinite(parsedPort) ? parsedPort : 3000;
const JWT_SECRET = process.env.JWT_SECRET || "lisans-super-secret-key-123";
const isProduction = process.env.NODE_ENV === "production";
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || process.env.SYNC_JSON_LIMIT || "25mb";
let databaseStatus: "initializing" | "ready" | "error" = "initializing";
let databaseError: string | null = null;

function getDatabaseHealth() {
  return {
    database: databaseStatus,
    ...(databaseStatus === "error" && !isProduction ? { databaseError } : {})
  };
}

function pickFirst(source: any, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function normalizeString(source: any, keys: string[], maxLength?: number) {
  const value = pickFirst(source, keys);
  if (value === undefined) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  return maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizeNumber(source: any, keys: string[], fallback = 0) {
  const value = pickFirst(source, keys);
  if (value === undefined) return fallback;

  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const numberValue = Number.parseFloat(normalized);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function getBulkItems(req: any) {
  if (Array.isArray(req.body)) return req.body;
  if (Array.isArray(req.body?.items)) return req.body.items;
  if (Array.isArray(req.body?.Items)) return req.body.Items;
  return null;
}

function normalizeCari(item: any) {
  return {
    CariKodu: normalizeString(item, ["CariKodu", "cariKodu", "CariKod", "cariKod", "cari_kod", "CARIKODU", "Kod", "kod"], 50),
    CariAdi: normalizeString(item, ["CariAdi", "cariAdi", "CariAd", "cariAd", "cari_unvan1", "cari_unvan2", "CARIADI", "Adi", "ad", "Name"], 255),
    VergiDairesi: normalizeString(item, ["VergiDairesi", "vergiDairesi", "cari_vdaire_adi"], 100),
    VergiNumarasi: normalizeString(item, ["VergiNumarasi", "vergiNumarasi", "cari_vdaire_no", "VergiNo", "Tckn"], 50),
    Bakiye: normalizeNumber(item, ["Bakiye", "bakiye", "Balance", "balance"], 0),
  };
}

function normalizeStok(item: any) {
  return {
    StokKodu: normalizeString(item, ["StokKodu", "stokKodu", "StokKod", "stokKod", "sto_kod", "STOKKODU", "Kod", "kod"], 50),
    StokAdi: normalizeString(item, ["StokAdi", "stokAdi", "StokAd", "stokAd", "sto_isim", "STOKADI", "Adi", "ad", "Name"], 255),
    Birim: normalizeString(item, ["Birim", "birim", "sto_birim1_ad", "BirimAdi"], 50),
    Barkod: normalizeString(item, ["Barkod", "barkod", "bar_kodu", "Barcode"], 100),
    SatisFiyati1: normalizeNumber(item, ["SatisFiyati1", "satisFiyati1", "Fiyat", "fiyat", "Price", "price"], 0),
  };
}

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
  validate: false,
  skip: (req) => req.originalUrl.startsWith("/api/erp/") || req.originalUrl.startsWith("/api/agent/")
});

const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.SYNC_RATE_LIMIT_MAX || "2000", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sync requests from this IP, please try again later" },
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
app.use(express.json({ limit: jsonBodyLimit }));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    ...getDatabaseHealth(),
    uptime: process.uptime()
  });
});

app.get("/ready", (req, res) => {
  if (databaseStatus !== "ready") {
    return res.status(503).json({
      status: "not_ready",
      ...getDatabaseHealth()
    });
  }

  res.status(200).json({ status: "ready" });
});

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
app.use("/api/erp/", syncLimiter);
app.use("/api/agent/", syncLimiter);
app.use("/agent/v1/", syncLimiter);
app.use("/api/agent/v1/", syncLimiter);

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
    : `tnt_${crypto.randomBytes(6).toString('hex')}`;

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
  const LicenseKey = crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{1,4}/g)?.join('-') || "INVALID-KEY";
  
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

  const Key = 'ak_' + crypto.randomBytes(32).toString('hex');

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

    // Bridge webhook: Sync Adapter'a tenant + key'i aktar.
    // Fire-and-forget; hata loglanir ama INSERT'i engellemez.
    const syncAdapterUrl = process.env.SYNC_ADAPTER_URL;
    const bridgeSecret = process.env.SYNC_ADAPTER_BRIDGE_SECRET;
    if (syncAdapterUrl) {
      const company = await db("Companies").where({ Id: CompanyId }).first();
      if (company) {
        const tenantId = company.TenantId || `tnt_${CompanyId}`;
        fetch(`${syncAdapterUrl.replace(/\/+$/, "")}/api/v1/tenants/import`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Bridge-Secret": bridgeSecret || "",
          },
          body: JSON.stringify({
            tenant_id: tenantId,
            api_key: Key,
            company_name: company.Name,
            label: Name,
          }),
        })
          .then((r) => {
            if (!r.ok) console.error(`[bridge] Sync Adapter import HTTP ${r.status}`);
            else console.log(`[bridge] tenant ${tenantId} -> Sync Adapter OK`);
          })
          .catch((err) =>
            console.error("[bridge] Sync Adapter webhook failed:", err.message)
          );
      }
    }

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

    await db("ApiKeys")
      .where({ Id: keyRecord.Id })
      .update({
        LastUsedAt: new Date().toISOString(),
        LastUsedIp: req.ip,
        RequestCount: db.raw("RequestCount + 1"),
      });

    req.client = { CompanyId: keyRecord.CompanyId };
    next();
  } catch (err: any) {
    console.error("Auth client error:", err);
    return res.status(500).json({ error: "Internal server error during authentication" });
  }
};

async function getActiveApiKeyRecord(apiKey: string) {
  return await db("ApiKeys")
    .where({ Key: apiKey, Status: 1 })
    .andWhere(function() {
      this.whereNull("ExpiryDate").orWhere("ExpiryDate", ">", new Date().toISOString());
    })
    .first();
}

async function touchApiKey(keyId: any, req: any) {
  await db("ApiKeys")
    .where({ Id: keyId })
    .update({
      LastUsedAt: new Date().toISOString(),
      LastUsedIp: req.ip,
      RequestCount: db.raw("RequestCount + 1"),
    });
}

async function getCompanyById(companyId: any) {
  return await db("Companies").where({ Id: companyId }).first();
}

async function getActiveLicense(companyId: any) {
  return await db("Licenses")
    .where({ CompanyId: companyId, Status: 1 })
    .andWhere("ExpiryDate", ">", new Date().toISOString())
    .orderBy("ExpiryDate", "desc")
    .first();
}

async function resolveAgentAuth(req: any) {
  const authHeader = req.headers.authorization || "";
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (bearer) {
    const decoded: any = jwt.verify(bearer, JWT_SECRET);
    if (decoded?.type !== "sync-agent") {
      throw new Error("invalid_agent_token");
    }

    return {
      CompanyId: decoded.company_id || decoded.CompanyId,
      TenantId: decoded.tenant_id || decoded.TenantId,
      DeviceId: decoded.device_id || decoded.DeviceId,
      ApiKeyId: decoded.api_key_id || decoded.ApiKeyId,
    };
  }

  const apiKey = req.headers["x-api-key"] || req.query.apiKey;
  if (!apiKey) {
    throw new Error("missing_agent_token");
  }

  const keyRecord = await getActiveApiKeyRecord(String(apiKey));
  if (!keyRecord) {
    throw new Error("invalid_api_key");
  }

  const company = await getCompanyById(keyRecord.CompanyId);
  return {
    CompanyId: keyRecord.CompanyId,
    TenantId: company?.TenantId || `tnt_${keyRecord.CompanyId}`,
    DeviceId: req.headers["x-device-id"] || null,
    ApiKeyId: keyRecord.Id,
  };
}

const authenticateAgent = async (req: any, res: any, next: any) => {
  try {
    req.agent = await resolveAgentAuth(req);
    next();
  } catch (err: any) {
    return res.status(401).json({
      error: "unauthorized",
      message: err?.message || "Invalid agent token",
    });
  }
};

function toAgentConfig(tenantId: string) {
  return {
    tenant_id: tenantId,
    config_version: 1,
    mikro_version: process.env.MIKRO_VERSION || "V15",
    allowed_document_types: [
      "SIPARIS",
      "SATIS",
      "TAHSILAT",
      "IADE",
      "ALIS",
      "STOK",
      "CARI",
    ],
    bootstrap_kinds: [
      "customers",
      "stocks",
      "prices",
      "warehouses",
      "cash_accounts",
      "bank_accounts",
    ],
    settings: {
      queue_mode: "pull",
      api_surface: "ms_mikro_sync_compat",
      batch_size: "500",
    },
    server_time: new Date().toISOString(),
  };
}

function normalizeAgentDataItem(item: any) {
  if (item?.payload_json) {
    try {
      return JSON.parse(item.payload_json);
    } catch {
      return item;
    }
  }

  if (item?.payloadJson) {
    try {
      return JSON.parse(item.payloadJson);
    } catch {
      return item;
    }
  }

  return item?.payload || item;
}

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

// 4b. Log errors from Sync Adapter Agent (Bridge: Serhan'in tum musterilerini tek panelden izlemesi icin)
// authenticateClient zaten api_key uzerinden CompanyId'yi set ediyor.
app.post("/api/agent/logs", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const {
    AppVersion,
    DeviceId,
    Level,
    Source,
    Message,
    StackTrace,
    CorrelationId,
    EventType,
  } = req.body;

  try {
    await db("ErrorLogs").insert({
      CompanyId: companyId,
      AppVersion: AppVersion || "SyncAdapter.Agent",
      MachineName: DeviceId,
      Level: Level || 3,
      Source: Source || "SyncAdapter.Agent",
      Message,
      Details: StackTrace,
      CorrelationId: CorrelationId || null,
      EventType: EventType || "sync",
      Timestamp: new Date().toISOString(),
      IsResolved: 0,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Sync Adapter Central API compatibility routes ---

const agentRouter = express.Router();

agentRouter.get("/health", (req, res) => {
  res.json({
    status: databaseStatus === "ready" ? "ok" : "not_ready",
    ...getDatabaseHealth(),
    server_time: new Date().toISOString(),
  });
});

agentRouter.post("/activate", async (req: any, res) => {
  const apiKey = req.body?.api_key || req.body?.ApiKey || req.body?.apiKey;
  const requestedTenantId = req.body?.tenant_id || req.body?.TenantId || req.body?.tenantId;
  const machineFingerprint = req.body?.machine_fingerprint || req.body?.MachineFingerprint || req.body?.machineFingerprint;
  const agentVersion = req.body?.agent_version || req.body?.AgentVersion || req.body?.agentVersion;

  if (!apiKey) {
    return res.status(400).json({
      activated: false,
      error_code: "missing_api_key",
      error_message: "api_key is required",
    });
  }

  try {
    const keyRecord = await getActiveApiKeyRecord(String(apiKey));
    if (!keyRecord) {
      return res.status(401).json({
        activated: false,
        error_code: "invalid_api_key",
        error_message: "Invalid, inactive, or expired API key",
      });
    }

    const company = await getCompanyById(keyRecord.CompanyId);
    if (!company || company.IsActive === 0) {
      return res.status(403).json({
        activated: false,
        error_code: "company_inactive",
        error_message: "Company is inactive",
      });
    }

    const activeLicense = await getActiveLicense(keyRecord.CompanyId);
    if (!activeLicense) {
      return res.status(403).json({
        activated: false,
        error_code: "license_inactive",
        error_message: "No active license found for this company",
      });
    }

    const tenantId = company.TenantId || requestedTenantId || `tnt_${keyRecord.CompanyId}`;
    const expiresAt = new Date(activeLicense.ExpiryDate).toISOString();
    const tokenPayload = {
      type: "sync-agent",
      company_id: keyRecord.CompanyId,
      tenant_id: tenantId,
      api_key_id: keyRecord.Id,
      device_id: machineFingerprint || null,
      agent_version: agentVersion || null,
    };
    const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "12h" });
    const refreshToken = jwt.sign({ ...tokenPayload, token_kind: "refresh" }, JWT_SECRET, { expiresIn: "30d" });

    await touchApiKey(keyRecord.Id, req);

    res.json({
      activated: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      config_version: 1,
    });
  } catch (err: any) {
    res.status(500).json({
      activated: false,
      error_code: "activation_error",
      error_message: err.message,
    });
  }
});

agentRouter.post("/heartbeat", authenticateAgent, async (req: any, res) => {
  try {
    const activeLicense = await getActiveLicense(req.agent.CompanyId);
    const status = activeLicense ? "Valid" : "Disabled";
    const expiresAt = activeLicense?.ExpiryDate ? new Date(activeLicense.ExpiryDate).toISOString() : null;

    if (req.agent.ApiKeyId) {
      await touchApiKey(req.agent.ApiKeyId, req);
    }

    res.json({
      license_status: status,
      expires_at: expiresAt,
      config_version: 1,
      commands: [],
    });
  } catch (err: any) {
    res.status(500).json({
      license_status: "Unknown",
      error_code: "heartbeat_error",
      error_message: err.message,
    });
  }
});

agentRouter.get("/config", authenticateAgent, async (req: any, res) => {
  res.json(toAgentConfig(req.agent.TenantId || `tnt_${req.agent.CompanyId}`));
});

agentRouter.get("/jobs", authenticateAgent, async (req: any, res) => {
  const limit = Math.max(1, Math.min(Number.parseInt(String(req.query.limit || "25"), 10) || 25, 200));
  const companyId = req.agent.CompanyId;

  try {
    const pendingItems = await db("SyncQueue")
      .select("Id", "DocumentType", "ExternalId", "DocumentDate", "Payload", "QueuedAt")
      .where({ CompanyId: companyId, Status: 0 })
      .orderBy("Priority", "desc")
      .orderBy("QueuedAt", "asc")
      .limit(limit);

    if (pendingItems.length > 0) {
      await db("SyncQueue")
        .whereIn("Id", pendingItems.map((item: any) => item.Id))
        .update({
          Status: 3,
          ProcessingStartedAt: new Date().toISOString(),
        });
    }

    res.json({
      jobs: pendingItems.map((item: any) => ({
        job_id: String(item.Id),
        tenant_id: req.agent.TenantId || `tnt_${companyId}`,
        entity_type: "document",
        operation: "upsert",
        document_type: item.DocumentType,
        external_id: item.ExternalId,
        payload_version: 1,
        payload_json: typeof item.Payload === "string" ? item.Payload : JSON.stringify(item.Payload),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

agentRouter.post("/jobs/:jobId/ack", authenticateAgent, async (req: any, res) => {
  const jobId = req.params.jobId;
  const statusText = String(req.body?.status || req.body?.Status || "").toLowerCase();
  const success = ["completed", "complete", "success", "succeeded", "ok", "1"].includes(statusText);
  const failed = ["failed", "fail", "error", "2"].includes(statusText);

  if (!success && !failed) {
    return res.status(400).json({ error: "Invalid ack status" });
  }

  try {
    const mikro = req.body?.mikro || req.body?.Mikro || {};
    const updatedRows = await db("SyncQueue")
      .where({ Id: jobId, CompanyId: req.agent.CompanyId })
      .update({
        Status: success ? 1 : 2,
        LastError: failed ? (req.body?.error || req.body?.Error || "Agent failed") : null,
        MikroRecno: mikro?.rec_no || mikro?.recNo || mikro?.MikroRecno || null,
        ...(success ? { CompletedAt: new Date().toISOString() } : { RetryCount: db.raw("RetryCount + 1") }),
      });

    if (updatedRows === 0) {
      return res.status(404).json({ error: "Queue item not found or unauthorized" });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

agentRouter.post("/bootstrap", authenticateAgent, async (req: any, res) => {
  res.json({
    accepted: true,
    count: Array.isArray(req.body?.items) ? req.body.items.length : 0,
    pushed_at: new Date().toISOString(),
  });
});

agentRouter.post("/data/push", authenticateAgent, async (req: any, res) => {
  const kind = String(req.body?.kind || req.body?.Kind || "").toLowerCase();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const companyId = req.agent.CompanyId;

  try {
    const normalizedItems = items.map(normalizeAgentDataItem);
    const now = new Date().toISOString();

    if (["customers", "customer", "cari", "cariler", "carihesaplar"].includes(kind)) {
      await db.transaction(async (trx) => {
        for (const item of normalizedItems) {
          const cari = normalizeCari(item);
          if (!cari.CariKodu || !cari.CariAdi) continue;

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
            `, [companyId, cari.CariKodu, cari.CariAdi, cari.VergiDairesi, cari.VergiNumarasi, cari.Bakiye, now]);
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
            `, [companyId, cari.CariKodu, cari.CariAdi, cari.VergiDairesi, cari.VergiNumarasi, cari.Bakiye, now]);
          }
        }
      });
    }

    if (["stocks", "stock", "stok", "stoklar", "stokkartlar", "prices"].includes(kind)) {
      await db.transaction(async (trx) => {
        for (const item of normalizedItems) {
          const stok = normalizeStok(item);
          if (!stok.StokKodu || !stok.StokAdi) continue;

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
            `, [companyId, stok.StokKodu, stok.StokAdi, stok.Birim, stok.Barkod, stok.SatisFiyati1, now]);
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
            `, [companyId, stok.StokKodu, stok.StokAdi, stok.Birim, stok.Barkod, stok.SatisFiyati1, now]);
          }
        }
      });
    }

    res.json({
      accepted: true,
      kind,
      count: items.length,
      pushed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      accepted: false,
      kind,
      count: 0,
      error: err.message,
    });
  }
});

agentRouter.get("/data/:kind", authenticateAgent, async (req: any, res) => {
  const kind = String(req.params.kind || "").toLowerCase();
  const companyId = req.agent.CompanyId;
  const sinceTimestamp = req.query.sinceTimestamp ? Number.parseInt(String(req.query.sinceTimestamp), 10) : null;
  const sinceIso = sinceTimestamp ? new Date(sinceTimestamp * 1000).toISOString() : null;

  try {
    let rows: any[] = [];
    if (["customers", "customer", "cari", "cariler", "carihesaplar"].includes(kind)) {
      let query = db("CariHesaplar").where({ CompanyId: companyId });
      if (sinceIso) query = query.andWhere("LastSyncAt", ">", sinceIso);
      rows = await query;
      return res.json({
        success: true,
        kind,
        count: rows.length,
        items: rows.map((row: any) => ({
          key: row.CariKodu,
          payload: row,
          captured_at: row.LastSyncAt || new Date().toISOString(),
        })),
        server_time: new Date().toISOString(),
      });
    }

    if (["stocks", "stock", "stok", "stoklar", "stokkartlar", "prices"].includes(kind)) {
      let query = db("StokKartlar").where({ CompanyId: companyId });
      if (sinceIso) query = query.andWhere("LastSyncAt", ">", sinceIso);
      rows = await query;
      return res.json({
        success: true,
        kind,
        count: rows.length,
        items: rows.map((row: any) => ({
          key: row.StokKodu,
          payload: row,
          captured_at: row.LastSyncAt || new Date().toISOString(),
        })),
        server_time: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      kind,
      count: 0,
      items: [],
      server_time: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      kind,
      count: 0,
      error: err.message,
      server_time: new Date().toISOString(),
    });
  }
});

app.use("/agent/v1", agentRouter);
app.use("/api/agent/v1", agentRouter);

// --- ERP / Windows Sync Service API Routes ---

// 1. Bulk Upsert Cari Hesaplar (Customers) from Windows ERP
app.post("/api/erp/carihesaplar/bulk", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const items = getBulkItems(req);

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "Expected 'items' array in body, or a raw JSON array" });
  }

  try {
    const invalidItems: Array<{ index: number; reason: string }> = [];

    await db.transaction(async (trx) => {
      for (const [index, item] of items.entries()) {
        const cari = normalizeCari(item);
        if (!cari.CariKodu || !cari.CariAdi) {
          invalidItems.push({ index, reason: "CariKodu/CariAdi missing" });
          continue;
        }

        const now = new Date().toISOString();

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
          `, [companyId, cari.CariKodu, cari.CariAdi, cari.VergiDairesi, cari.VergiNumarasi, cari.Bakiye, now]);
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
          `, [companyId, cari.CariKodu, cari.CariAdi, cari.VergiDairesi, cari.VergiNumarasi, cari.Bakiye, now]);
        }
      }
    });

    res.json({
      success: invalidItems.length === 0,
      processedCount: items.length - invalidItems.length,
      skippedCount: invalidItems.length,
      ...(invalidItems.length > 0 ? { invalidItems: invalidItems.slice(0, 20) } : {}),
    });
  } catch (err: any) {
    console.error("Bulk cari error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Bulk Upsert Stok Kartları (Products) from Windows ERP
app.post("/api/erp/stokkartlar/bulk", authenticateClient, async (req: any, res: any) => {
  const companyId = req.client.CompanyId;
  const items = getBulkItems(req);

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "Expected 'items' array in body, or a raw JSON array" });
  }

  try {
    const invalidItems: Array<{ index: number; reason: string }> = [];

    await db.transaction(async (trx) => {
      for (const [index, item] of items.entries()) {
        const stok = normalizeStok(item);
        if (!stok.StokKodu || !stok.StokAdi) {
          invalidItems.push({ index, reason: "StokKodu/StokAdi missing" });
          continue;
        }

        const now = new Date().toISOString();

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
          `, [companyId, stok.StokKodu, stok.StokAdi, stok.Birim, stok.Barkod, stok.SatisFiyati1, now]);
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
          `, [companyId, stok.StokKodu, stok.StokAdi, stok.Birim, stok.Barkod, stok.SatisFiyati1, now]);
        }
      }
    });

    res.json({
      success: invalidItems.length === 0,
      processedCount: items.length - invalidItems.length,
      skippedCount: invalidItems.length,
      ...(invalidItems.length > 0 ? { invalidItems: invalidItems.slice(0, 20) } : {}),
    });
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

async function initializeDatabase() {
  try {
    await initializeSchema();
    databaseStatus = "ready";
    databaseError = null;
  } catch (err) {
    console.error("Failed to initialize database schema:", err);
    databaseStatus = "error";
    databaseError = err instanceof Error ? err.message : String(err);
  }
}

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

  void initializeDatabase();
}

startServer();
