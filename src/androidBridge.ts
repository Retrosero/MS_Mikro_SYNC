/**
 * AndroidBridge — Android saha satış uygulamasının beklediği SaaS sözleşmesi.
 *
 * Android (saha-satış) istemcisi `MultiTenantInterceptor` aracılığıyla
 *   GET  /api/v1/sync/<entity>   →  POST /api/v1/android/sync/<entity>
 *   POST /api/v1/sync/push      →  POST /api/v1/android/push
 * çağrısı yapar. Body'de tenant_id + api_key + device_id + agent_version
 * standarttır. Bu router o sözleşmeyi karşılar.
 *
 * Auth: tenant_id + api_key → ApiKeys tablosundan CompanyId çözümlemesi,
 *       ardından tenant_id eşleşmesi (varsa) ve company aktiflik kontrolü.
 *
 * DTO'lar Android'in `FieldOpsApiService.kt` ile birebir uyumludur:
 *   - `CariDto`           ← CariHesaplar
 *   - `UrunDto`           ← StokKartlar
 *   - `StokSeviyeDto`     ← (Faz 1b) StokSeviyeleri
 *   - Diğer entity'ler    ← (Faz 1b) ilgili tablolar
 *
 * Envelope (Android `FieldOpsSyncResponse<T>`):
 *   { success, entity, page, pageSize, total, since, watermark, items, server_time }
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import crypto from "node:crypto";

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface AndroidAgentContext {
  CompanyId: number;
  TenantId: string;
  ApiKeyId: number;
  DeviceId: string | null;
  AgentVersion: string | null;
}

declare global {
  namespace Express {
    interface Request {
      androidAgent?: AndroidAgentContext;
    }
  }
}

interface BridgeEnvelope<T> {
  success: true;
  entity: string;
  page: number;
  pageSize: number;
  total: number;
  since: string | null;
  watermark: string | null;
  items: T[];
  server_time: string;
}

interface AndroidRequestBody {
  tenant_id?: string;
  api_key?: string;
  device_id?: string;
  agent_version?: string;
  entity?: string;
  since?: string | null;
  page?: number;
  pageSize?: number;
  payload?: Record<string, unknown>;
}

// ─── Yardımcılar ────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function parseSince(req: Request): string | null {
  const raw = (req.body as AndroidRequestBody | undefined)?.since;
  if (!raw) return null;
  return String(raw);
}

function parsePagination(req: Request): { page: number; pageSize: number } {
  const page = Math.max(1, Number((req.body as AndroidRequestBody | undefined)?.page) || 1);
  const requestedSize = Number((req.body as AndroidRequestBody | undefined)?.pageSize) || 200;
  const pageSize = Math.min(500, Math.max(1, requestedSize));
  return { page, pageSize };
}

function computeWatermark(rows: any[], since: string | null): string | null {
  if (rows.length === 0) return since;
  let max: string | null = null;
  for (const r of rows) {
    const v = r.LastSyncAt;
    if (v && (!max || v > max)) max = v;
  }
  return max;
}

function mapEntityToDocumentType(entity: string): string {
  const map: Record<string, string> = {
    siparis: "SIPARIS",
    satis: "SATIS",
    tahsilat: "TAHSILAT",
    iade: "IADE",
    alis: "ALIS",
    order: "SIPARIS",
    siparis_satis: "SIPARIS",
    invoice: "FATURA",
    collection: "TAHSILAT",
    payment: "TEDIYE",
    document: "DOCUMENT",
  };
  return map[entity.toLowerCase()] || entity.toUpperCase();
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────

export async function resolveAndroidAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = (req.body || {}) as AndroidRequestBody;
    const tenantId = body.tenant_id;
    const apiKey = body.api_key;
    const deviceId = body.device_id;
    const agentVersion = body.agent_version;

    if (!apiKey || typeof apiKey !== "string") {
      return res.status(401).json({
        success: false,
        error: "unauthorized",
        message: "api_key is required in request body",
      });
    }

    const keyRecord = await db("ApiKeys")
      .where({ Key: apiKey, Status: 1 })
      .andWhere(function () {
        this.whereNull("ExpiryDate").orWhere(
          "ExpiryDate",
          ">",
          new Date().toISOString()
        );
      })
      .first();

    if (!keyRecord) {
      return res.status(401).json({
        success: false,
        error: "unauthorized",
        message: "Invalid, inactive, or expired API key",
      });
    }

    const company = await db("Companies")
      .where({ Id: keyRecord.CompanyId })
      .first();

    if (!company || company.IsActive === 0) {
      return res.status(403).json({
        success: false,
        error: "company_inactive",
        message: "Company is inactive or not found",
      });
    }

    // tenant_id doğrulaması: client belirtti ise DB'deki ile eşleşmeli.
    if (
      tenantId &&
      company.TenantId &&
      tenantId !== company.TenantId
    ) {
      return res.status(403).json({
        success: false,
        error: "tenant_mismatch",
        message: "tenant_id does not match this api_key's company",
      });
    }

    // ApiKey kullanım sayaçlarını güncelle (touch).
    await db("ApiKeys")
      .where({ Id: keyRecord.Id })
      .update({
        LastUsedAt: nowIso(),
        LastUsedIp: req.ip,
        RequestCount: db.raw("RequestCount + 1"),
      });

    const resolvedTenantId =
      company.TenantId || tenantId || `tnt_${keyRecord.CompanyId}`;

    req.androidAgent = {
      CompanyId: keyRecord.CompanyId,
      TenantId: resolvedTenantId,
      ApiKeyId: keyRecord.Id,
      DeviceId: deviceId || null,
      AgentVersion: agentVersion || null,
    };

    next();
  } catch (err: any) {
    console.error("[androidBridge.auth]", err);
    return res.status(500).json({
      success: false,
      error: "auth_error",
      message: err?.message || "Internal server error during authentication",
    });
  }
}

// ─── DTO Mapping (CariHesaplar → CariDto) ────────────────────────────────────

function mapCari(row: any) {
  return {
    id: String(row.Id),
    erpRef: String(row.Id),
    erpKod: row.CariKodu ?? null,
    cariKod: row.CariKodu ?? null,
    erp: "mikro",
    unvan: row.CariAdi ?? null,
    cariUnvan: row.CariAdi ?? null,
    cariTip: null,
    vergiNo: row.VergiNumarasi ?? null,
    vergiDairesi: row.VergiDairesi ?? null,
    tcKimlikNo: null,
    adres: null,
    il: null,
    ilce: null,
    telefon: null,
    email: null,
    musteri: true,
    updatedAt: row.LastSyncAt ?? nowIso(),
    createdAt: row.LastSyncAt ?? nowIso(),
    isDeleted: false,
    paraBirimi: "TRY",
    bakiye: Number(row.Bakiye ?? 0),
    balance: Number(row.Bakiye ?? 0),
    netBakiye: Number(row.Bakiye ?? 0),
    hareketler: null,
    transactions: null,
  };
}

// ─── DTO Mapping (StokKartlar → UrunDto) ─────────────────────────────────────

function mapUrun(row: any) {
  return {
    id: String(row.Id),
    erpRef: String(row.Id),
    erpKod: row.StokKodu ?? null,
    urunKod: row.StokKodu ?? null,
    erp: "mikro",
    ad: row.StokAdi ?? null,
    urunAd: row.StokAdi ?? null,
    urunTip: null,
    birim: row.Birim ?? null,
    barkod: row.Barkod ?? null,
    kdvOrani: null,
    alisFiyat: null,
    satisFiyat: Number(row.SatisFiyati1 ?? 0),
    listeFiyati: Number(row.SatisFiyati1 ?? 0),
    paraBirimi: "TRY",
    kategori: null,
    marka: null,
    aktif: true,
    updatedAt: row.LastSyncAt ?? nowIso(),
    createdAt: row.LastSyncAt ?? nowIso(),
    isDeleted: false,
    miktar: null,
    stok: null,
    quantity: null,
    stock: null,
    miktarDepo: null,
    stockByWarehouse: null,
    bayiFiyati: null,
    toptanFiyati: null,
    customPrices: null,
  };
}

// ─── Yardımcı route handler'ları ─────────────────────────────────────────────

function envelope<T>(
  res: Response,
  entity: string,
  page: number,
  pageSize: number,
  total: number,
  since: string | null,
  watermark: string | null,
  items: T[]
): void {
  const body: BridgeEnvelope<T> = {
    success: true,
    entity,
    page,
    pageSize,
    total,
    since,
    watermark,
    items,
    server_time: nowIso(),
  };
  res.json(body);
}

function errorResponse(res: Response, err: any) {
  console.error("[androidBridge]", err);
  res.status(500).json({
    success: false,
    error: err?.message || "Internal server error",
    server_time: nowIso(),
  });
}

// ─── Router Factory ──────────────────────────────────────────────────────────

export function createAndroidBridgeRouter() {
  const router = express.Router();

  // Tüm endpoint'ler auth gerektirir (router seviyesinde).
  router.use(resolveAndroidAuth);

  // ── 1. POST /sync/cari ────────────────────────────────────────────────────
  router.post("/sync/cari", async (req: Request, res: Response) => {
    try {
      const agent = req.androidAgent!;
      const since = parseSince(req);
      const { page, pageSize } = parsePagination(req);

      let query = db("CariHesaplar").where({ CompanyId: agent.CompanyId });
      if (since) query = query.andWhere("LastSyncAt", ">", since);

      const totalRow = await query
        .clone()
        .count({ count: "*" })
        .first();
      const total = Number(totalRow?.count || 0);

      const rows = await query
        .orderBy("CariKodu", "asc")
        .offset((page - 1) * pageSize)
        .limit(pageSize);

      envelope(
        res,
        "cari",
        page,
        pageSize,
        total,
        since,
        computeWatermark(rows, since),
        rows.map(mapCari)
      );
    } catch (err) {
      errorResponse(res, err);
    }
  });

  // ── 2. POST /sync/urun ────────────────────────────────────────────────────
  router.post("/sync/urun", async (req: Request, res: Response) => {
    try {
      const agent = req.androidAgent!;
      const since = parseSince(req);
      const { page, pageSize } = parsePagination(req);

      let query = db("StokKartlar").where({ CompanyId: agent.CompanyId });
      if (since) query = query.andWhere("LastSyncAt", ">", since);

      const totalRow = await query
        .clone()
        .count({ count: "*" })
        .first();
      const total = Number(totalRow?.count || 0);

      const rows = await query
        .orderBy("StokKodu", "asc")
        .offset((page - 1) * pageSize)
        .limit(pageSize);

      envelope(
        res,
        "urun",
        page,
        pageSize,
        total,
        since,
        computeWatermark(rows, since),
        rows.map(mapUrun)
      );
    } catch (err) {
      errorResponse(res, err);
    }
  });

  // ── 3. POST /license/status ───────────────────────────────────────────────
  router.post("/license/status", async (req: Request, res: Response) => {
    try {
      const agent = req.androidAgent!;
      const license = await db("Licenses")
        .where({ CompanyId: agent.CompanyId, Status: 1 })
        .andWhere("ExpiryDate", ">", nowIso())
        .orderBy("ExpiryDate", "desc")
        .first();
      const company = await db("Companies")
        .where({ Id: agent.CompanyId })
        .first();

      if (!license) {
        return res.json({
          success: true,
          state: "Expired",
          reason: "No active license",
          lastCheckedAt: nowIso(),
          expiresAt: null,
          daysUntilExpiry: 0,
          daysRemaining: 0,
          enabledErps: [],
          erpAllowed: [],
          licensee: company?.Name ?? null,
          machineFingerprint: agent.DeviceId,
          allowsSync: false,
        });
      }

      const expiry = new Date(license.ExpiryDate);
      const days = Math.ceil(
        (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      res.json({
        success: true,
        state: "Active",
        reason: null,
        lastCheckedAt: nowIso(),
        expiresAt: expiry.toISOString(),
        daysUntilExpiry: days,
        daysRemaining: days,
        enabledErps: ["mikro"],
        erpAllowed: ["mikro"],
        licensee: company?.Name ?? null,
        machineFingerprint: agent.DeviceId,
        allowsSync: license.EnableSync === 1,
      });
    } catch (err) {
      errorResponse(res, err);
    }
  });

  // ── 4. POST /bootstrap ─────────────────────────────────────────────────────
  router.post("/bootstrap", async (req: Request, res: Response) => {
    try {
      const agent = req.androidAgent!;
      const company = await db("Companies")
        .where({ Id: agent.CompanyId })
        .first();
      const license = await db("Licenses")
        .where({ CompanyId: agent.CompanyId, Status: 1 })
        .andWhere("ExpiryDate", ">", nowIso())
        .orderBy("ExpiryDate", "desc")
        .first();

      const allowedErps = license ? ["mikro"] : [];
      const activeModules = license
        ? [
            "customers",
            "stocks",
            "prices",
            "warehouses",
            "cash_accounts",
            "bank_accounts",
          ]
        : [];

      res.json({
        success: true,
        message: license
          ? "Tenant bootstrapped successfully"
          : "Tenant has no active license",
        tenant_name: company?.Name ?? `tenant_${agent.CompanyId}`,
        tenant_id: agent.TenantId,
        allowed_erps: allowedErps,
        active_modules: activeModules,
        config_version: 1,
        server_time: nowIso(),
      });
    } catch (err) {
      errorResponse(res, err);
    }
  });

  // ── 5. POST /sync/status ──────────────────────────────────────────────────
  router.post("/sync/status", async (req: Request, res: Response) => {
    try {
      const agent = req.androidAgent!;
      const [cariLast, stokLast, queueDepthRow] = await Promise.all([
        db("CariHesaplar")
          .where({ CompanyId: agent.CompanyId })
          .max("LastSyncAt as wm")
          .first(),
        db("StokKartlar")
          .where({ CompanyId: agent.CompanyId })
          .max("LastSyncAt as wm")
          .first(),
        db("SyncQueue")
          .where({ CompanyId: agent.CompanyId, Status: 0 })
          .count({ count: "*" })
          .first(),
      ]);

      res.json({
        success: true,
        erp: "mikro",
        syncInProgress: false,
        syncStartedAt: null,
        syncEntity: null,
        watermarks: [
          {
            entity: "cari",
            lastSyncAt: cariLast?.wm ?? null,
            totalSynced: 0,
            mode: "pull",
          },
          {
            entity: "urun",
            lastSyncAt: stokLast?.wm ?? null,
            totalSynced: 0,
            mode: "pull",
          },
        ],
        isRunning: false,
        lastRunAt: null,
        lastRunEntity: null,
        progress: 0,
        queueDepth: Number(queueDepthRow?.count || 0),
        server_time: nowIso(),
      });
    } catch (err) {
      errorResponse(res, err);
    }
  });

  // ── 6. POST /push → SyncQueue'ya delege ───────────────────────────────────
  router.post("/push", async (req: Request, res: Response) => {
    try {
      const agent = req.androidAgent!;
      const body = (req.body || {}) as AndroidRequestBody;
      const entity = String(body.entity ?? "document").toLowerCase();
      const payload = (body.payload ?? {}) as Record<string, unknown>;

      const externalId = String(
        (payload as any).id ??
          (payload as any).externalId ??
          (payload as any).EvrakNo ??
          crypto.randomUUID()
      );
      const documentType = mapEntityToDocumentType(entity);
      const documentDate =
        (payload as any).tarih ??
        (payload as any).documentDate ??
        (payload as any).EvrakTarihi ??
        nowIso();
      const documentNumber =
        (payload as any).evrakNo ??
        (payload as any).documentNumber ??
        externalId;

      // Idempotent insert: CompanyId+ExternalId unique. Çakışırsa güncelle.
      const existing = await db("SyncQueue")
        .where({ CompanyId: agent.CompanyId, ExternalId: externalId })
        .first();

      if (existing) {
        await db("SyncQueue")
          .where({ Id: existing.Id })
          .update({
            Payload: JSON.stringify(payload),
            DocumentDate: documentDate,
            DocumentNumber: documentNumber,
            Status: 0,
            QueuedAt: nowIso(),
            RetryCount: 0,
            LastError: null,
            DeviceId: agent.DeviceId,
          });
      } else {
        await db("SyncQueue").insert({
          CompanyId: agent.CompanyId,
          DocumentType: documentType,
          ExternalId: externalId,
          DocumentNumber: documentNumber,
          DocumentDate: documentDate,
          Payload: JSON.stringify(payload),
          Status: 0,
          QueuedAt: nowIso(),
          Priority: 5,
          RetryCount: 0,
          MaxRetries: 3,
          DeviceId: agent.DeviceId,
        });
      }

      res.json({
        success: true,
        message: existing
          ? "Document re-queued (idempotent update)"
          : "Document queued for sync",
        requestId: externalId,
        status: "queued",
        entity,
        server_time: nowIso(),
      });
    } catch (err) {
      errorResponse(res, err);
    }
  });

  // ── 7. POST /pull → generic delta pull ────────────────────────────────────
  router.post("/pull", async (req: Request, res: Response) => {
    try {
      const agent = req.androidAgent!;
      const body = (req.body || {}) as AndroidRequestBody;
      const entity = String(body.entity ?? "").toLowerCase();
      const since = parseSince(req);
      const { page, pageSize } = parsePagination(req);

      let rows: any[] = [];
      let total = 0;
      let mapper: ((row: any) => any) | null = null;
      let envelopeEntity = entity;

      switch (entity) {
        case "cari":
        case "customers":
        case "carihesaplar": {
          let q = db("CariHesaplar").where({ CompanyId: agent.CompanyId });
          if (since) q = q.andWhere("LastSyncAt", ">", since);
          total = Number(
            (await q.clone().count({ count: "*" }).first())?.count || 0
          );
          rows = await q
            .orderBy("CariKodu", "asc")
            .offset((page - 1) * pageSize)
            .limit(pageSize);
          mapper = mapCari;
          envelopeEntity = "cari";
          break;
        }
        case "urun":
        case "stocks":
        case "stokkartlar": {
          let q = db("StokKartlar").where({ CompanyId: agent.CompanyId });
          if (since) q = q.andWhere("LastSyncAt", ">", since);
          total = Number(
            (await q.clone().count({ count: "*" }).first())?.count || 0
          );
          rows = await q
            .orderBy("StokKodu", "asc")
            .offset((page - 1) * pageSize)
            .limit(pageSize);
          mapper = mapUrun;
          envelopeEntity = "urun";
          break;
        }
        default:
          return res.json({
            success: true,
            message: `Unknown entity '${entity}', returning empty`,
            entity,
            watermark: since,
            items: [],
            server_time: nowIso(),
          });
      }

      const items = mapper ? rows.map(mapper) : rows;
      envelope(
        res,
        envelopeEntity,
        page,
        pageSize,
        total,
        since,
        computeWatermark(rows, since),
        items
      );
    } catch (err) {
      errorResponse(res, err);
    }
  });

  // ── 8. Faz 1b placeholder endpoint'leri (tabloları yok) ───────────────────
  // Bunlar şimdilik boş döner; tablolar eklendiğinde Faz 1b'de doldurulacak.
  const placeholderEntities = [
    "stokSeviye",
    "cariHareketleri",
    "faturaHareket",
    "stokSatisFiyatListeTanimlari",
    "stokSatisFiyatListeleri",
    "bankalar",
    "kasalar",
    "kasaYonetim",
  ];

  for (const ent of placeholderEntities) {
    router.post(`/sync/${ent}`, async (req: Request, res: Response) => {
      envelope(res, ent, 1, 0, 0, parseSince(req), null, []);
    });
  }

  return router;
}