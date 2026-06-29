-- LisansSunucu SQLite Veritabanı Şeması

-- Şirketler
CREATE TABLE IF NOT EXISTS "Companies" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_Companies" PRIMARY KEY AUTOINCREMENT,
    "Name" TEXT NOT NULL,
    "Code" TEXT NOT NULL,
    "TenantId" TEXT NULL,
    "Address" TEXT NULL,
    "Phone" TEXT NULL,
    "Email" TEXT NULL,
    "ContactPerson" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "LastSyncAt" TEXT NULL,
    "IsActive" INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "IX_Companies_Code" ON "Companies" ("Code");
CREATE INDEX IF NOT EXISTS "IX_Companies_Email" ON "Companies" ("Email");

-- Lisanslar
CREATE TABLE IF NOT EXISTS "Licenses" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_Licenses" PRIMARY KEY AUTOINCREMENT,
    "LicenseKey" TEXT NOT NULL,
    "CompanyId" INTEGER NOT NULL,
    "Type" INTEGER NOT NULL,
    "Status" INTEGER NOT NULL,
    "StartDate" TEXT NOT NULL,
    "ExpiryDate" TEXT NOT NULL,
    "MachineFingerprint" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "ActivatedAt" TEXT NULL,
    "Notes" TEXT NULL,
    "MaxUsers" INTEGER NOT NULL,
    "MaxDevices" INTEGER NOT NULL,
    "EnableOfflineMode" INTEGER NOT NULL DEFAULT 0,
    "EnableSync" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "FK_Licenses_Companies_CompanyId" FOREIGN KEY ("CompanyId") REFERENCES "Companies" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IX_Licenses_LicenseKey" ON "Licenses" ("LicenseKey");
CREATE INDEX IF NOT EXISTS "IX_Licenses_CompanyId_Status" ON "Licenses" ("CompanyId", "Status");

-- API Anahtarları
CREATE TABLE IF NOT EXISTS "ApiKeys" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_ApiKeys" PRIMARY KEY AUTOINCREMENT,
    "Key" TEXT NOT NULL,
    "CompanyId" INTEGER NOT NULL,
    "Name" TEXT NOT NULL,
    "Status" INTEGER NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "ExpiryDate" TEXT NULL,
    "LastUsedAt" TEXT NULL,
    "LastUsedIp" TEXT NULL,
    "RequestCount" INTEGER NOT NULL DEFAULT 0,
    "Permissions" TEXT NULL,
    CONSTRAINT "FK_ApiKeys_Companies_CompanyId" FOREIGN KEY ("CompanyId") REFERENCES "Companies" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IX_ApiKeys_Key" ON "ApiKeys" ("Key");
CREATE INDEX IF NOT EXISTS "IX_ApiKeys_CompanyId_Status" ON "ApiKeys" ("CompanyId", "Status");

-- Hata Logları
CREATE TABLE IF NOT EXISTS "ErrorLogs" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_ErrorLogs" PRIMARY KEY AUTOINCREMENT,
    "CompanyId" INTEGER NULL,
    "Source" TEXT NOT NULL,
    "Level" INTEGER NOT NULL,
    "Message" TEXT NOT NULL,
    "Details" TEXT NULL,
    "MachineName" TEXT NULL,
    "AppVersion" TEXT NULL,
    "CorrelationId" TEXT NULL,
    "EventType" TEXT NULL,
    "Timestamp" TEXT NOT NULL,
    "IsResolved" INTEGER NOT NULL DEFAULT 0,
    "ResolvedAt" TEXT NULL,
    "ResolvedBy" TEXT NULL,
    CONSTRAINT "FK_ErrorLogs_Companies_CompanyId" FOREIGN KEY ("CompanyId") REFERENCES "Companies" ("Id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_CompanyId" ON "ErrorLogs" ("CompanyId");
CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_CorrelationId" ON "ErrorLogs" ("CorrelationId");
CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_IsResolved_Timestamp" ON "ErrorLogs" ("IsResolved", "Timestamp");
CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_Level" ON "ErrorLogs" ("Level");
CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_Timestamp" ON "ErrorLogs" ("Timestamp");

-- Senkronizasyon Kuyruğu
CREATE TABLE IF NOT EXISTS "SyncQueue" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_SyncQueue" PRIMARY KEY AUTOINCREMENT,
    "CompanyId" INTEGER NOT NULL,
    "DocumentType" TEXT NOT NULL,
    "ExternalId" TEXT NOT NULL,
    "DocumentNumber" TEXT NULL,
    "DocumentDate" TEXT NOT NULL,
    "Payload" TEXT NOT NULL,
    "Status" INTEGER NOT NULL,
    "RetryCount" INTEGER NOT NULL DEFAULT 0,
    "MaxRetries" INTEGER NOT NULL DEFAULT 3,
    "LastError" TEXT NULL,
    "MikroRecno" INTEGER NULL,
    "Priority" INTEGER NOT NULL DEFAULT 0,
    "QueuedAt" TEXT NOT NULL,
    "ProcessingStartedAt" TEXT NULL,
    "CompletedAt" TEXT NULL,
    "DeviceId" TEXT NULL,
    "UserId" TEXT NULL,
    CONSTRAINT "FK_SyncQueue_Companies_CompanyId" FOREIGN KEY ("CompanyId") REFERENCES "Companies" ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IX_SyncQueue_CompanyId_ExternalId" ON "SyncQueue" ("CompanyId", "ExternalId");
CREATE INDEX IF NOT EXISTS "IX_SyncQueue_DocumentType" ON "SyncQueue" ("DocumentType");
CREATE INDEX IF NOT EXISTS "IX_SyncQueue_Status" ON "SyncQueue" ("Status");
CREATE INDEX IF NOT EXISTS "IX_SyncQueue_Status_Priority_QueuedAt" ON "SyncQueue" ("Status", "Priority", "QueuedAt");

-- Cari Hesaplar (Müşteriler)
CREATE TABLE IF NOT EXISTS "CariHesaplar" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_CariHesaplar" PRIMARY KEY AUTOINCREMENT,
    "CompanyId" INTEGER NOT NULL,
    "CariKodu" TEXT NOT NULL,
    "CariAdi" TEXT NOT NULL,
    "VergiDairesi" TEXT NULL,
    "VergiNumarasi" TEXT NULL,
    "Bakiye" REAL NOT NULL DEFAULT 0.0,
    "LastSyncAt" TEXT NOT NULL,
    CONSTRAINT "FK_CariHesaplar_Companies_CompanyId" FOREIGN KEY ("CompanyId") REFERENCES "Companies" ("Id") ON DELETE CASCADE,
    CONSTRAINT "UQ_CariHesaplar_Company_Code" UNIQUE ("CompanyId", "CariKodu")
);

-- Stok Kartları (Ürünler)
CREATE TABLE IF NOT EXISTS "StokKartlar" (
    "Id" INTEGER NOT NULL CONSTRAINT "PK_StokKartlar" PRIMARY KEY AUTOINCREMENT,
    "CompanyId" INTEGER NOT NULL,
    "StokKodu" TEXT NOT NULL,
    "StokAdi" TEXT NOT NULL,
    "Birim" TEXT NULL,
    "Barkod" TEXT NULL,
    "SatisFiyati1" REAL NOT NULL DEFAULT 0.0,
    "LastSyncAt" TEXT NOT NULL,
    CONSTRAINT "FK_StokKartlar_Companies_CompanyId" FOREIGN KEY ("CompanyId") REFERENCES "Companies" ("Id") ON DELETE CASCADE,
    CONSTRAINT "UQ_StokKartlar_Company_Code" UNIQUE ("CompanyId", "StokKodu")
);

-- Insert a default company for testing if none exists
INSERT INTO "Companies" ("Name", "Code", "CreatedAt", "IsActive") 
SELECT 'Ana Şirket', 'ADMIN', datetime('now'), 1 
WHERE NOT EXISTS (SELECT 1 FROM "Companies" WHERE "Code" = 'ADMIN');
