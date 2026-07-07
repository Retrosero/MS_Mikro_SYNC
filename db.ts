import knex from "knex";
import path from "path";
import fs from "fs";
import crypto from "node:crypto";

// Detect database client and connection parameters
const dbClient = process.env.DB_CLIENT || 
  (process.env.DATABASE_URL?.startsWith("postgres") ? "pg" : 
   process.env.DATABASE_URL?.startsWith("mysql") ? "mysql2" : "better-sqlite3");

let connectionConfig: any;

if (dbClient === "better-sqlite3") {
  const dataDir = path.join(process.cwd(), ".data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  connectionConfig = {
    filename: path.join(dataDir, "lisans.db")
  };
} else {
  if (process.env.DATABASE_URL) {
    connectionConfig = process.env.DATABASE_URL;
  } else {
    connectionConfig = {
      host: process.env.DB_HOST || "127.0.0.1",
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : (dbClient === "pg" ? 5432 : 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false
    };
  }
}

export const db = knex({
  client: dbClient,
  connection: connectionConfig,
  useNullAsDefault: dbClient === "better-sqlite3"
});

async function ensureColumn(
  tableName: string,
  columnName: string,
  addColumn: (table: knex.Knex.CreateTableBuilder) => void
) {
  if (!await db.schema.hasColumn(tableName, columnName)) {
    await db.schema.alterTable(tableName, addColumn);
    console.log(`Column '${columnName}' added to existing '${tableName}' table.`);
  }
}

export async function initializeSchema() {
  console.log(`Initializing schema for database client: ${dbClient}...`);

  // Check Companies table
  if (!await db.schema.hasTable("Companies")) {
    await db.schema.createTable("Companies", (table) => {
      table.increments("Id").primary();
      table.string("Name").notNullable();
      table.string("Code").notNullable().unique();
      table.string("TenantId").nullable();
      table.text("Address").nullable();
      table.string("Phone").nullable();
      table.string("Email").nullable();
      table.string("ContactPerson").nullable();
      table.string("CreatedAt").notNullable();
      table.string("LastSyncAt").nullable();
      table.integer("IsActive").notNullable().defaultTo(1);
    });
    console.log("Table 'Companies' created.");
  } else {
    // If table exists, check and add TenantId column
    await ensureColumn("Companies", "TenantId", (table) => table.string("TenantId").nullable());
  }

  // Check Licenses table
  if (!await db.schema.hasTable("Licenses")) {
    await db.schema.createTable("Licenses", (table) => {
      table.increments("Id").primary();
      table.string("LicenseKey").notNullable().unique();
      table.integer("CompanyId").unsigned().notNullable()
        .references("Id").inTable("Companies").onDelete("CASCADE");
      table.integer("Type").notNullable();
      table.integer("Status").notNullable();
      table.string("StartDate").notNullable();
      table.string("ExpiryDate").notNullable();
      table.string("MachineFingerprint").nullable();
      table.string("CreatedAt").notNullable();
      table.string("ActivatedAt").nullable();
      table.text("Notes").nullable();
      table.integer("MaxUsers").notNullable();
      table.integer("MaxDevices").notNullable();
      table.integer("EnableOfflineMode").notNullable().defaultTo(0);
      table.integer("EnableSync").notNullable().defaultTo(1);
    });
    console.log("Table 'Licenses' created.");
  }

  // Check ApiKeys table
  if (!await db.schema.hasTable("ApiKeys")) {
    await db.schema.createTable("ApiKeys", (table) => {
      table.increments("Id").primary();
      table.string("Key").notNullable().unique();
      table.integer("CompanyId").unsigned().notNullable()
        .references("Id").inTable("Companies").onDelete("CASCADE");
      table.string("Name").notNullable();
      table.integer("Status").notNullable();
      table.string("CreatedAt").notNullable();
      table.string("ExpiryDate").nullable();
      table.string("LastUsedAt").nullable();
      table.string("LastUsedIp").nullable();
      table.integer("RequestCount").notNullable().defaultTo(0);
      table.text("Permissions").nullable();
    });
    console.log("Table 'ApiKeys' created.");
  } else {
    await ensureColumn("ApiKeys", "LastUsedAt", (table) => table.string("LastUsedAt").nullable());
    await ensureColumn("ApiKeys", "LastUsedIp", (table) => table.string("LastUsedIp").nullable());
    await ensureColumn("ApiKeys", "RequestCount", (table) => table.integer("RequestCount").notNullable().defaultTo(0));
    await ensureColumn("ApiKeys", "Permissions", (table) => table.text("Permissions").nullable());
  }

  // Check ErrorLogs table
  if (!await db.schema.hasTable("ErrorLogs")) {
    await db.schema.createTable("ErrorLogs", (table) => {
      table.increments("Id").primary();
      table.integer("CompanyId").unsigned().nullable()
        .references("Id").inTable("Companies").onDelete("SET NULL");
      table.string("Source").notNullable();
      table.integer("Level").notNullable();
      table.string("Message").notNullable();
      table.text("Details").nullable();
      table.string("MachineName").nullable();
      table.string("AppVersion").nullable();
      table.string("CorrelationId").nullable();
      table.string("EventType").nullable();
      table.string("Timestamp").notNullable();
      table.integer("IsResolved").notNullable().defaultTo(0);
      table.string("ResolvedAt").nullable();
      table.string("ResolvedBy").nullable();
    });
    console.log("Table 'ErrorLogs' created.");
  } else {
    await ensureColumn("ErrorLogs", "CorrelationId", (table) => table.string("CorrelationId").nullable());
    await ensureColumn("ErrorLogs", "EventType", (table) => table.string("EventType").nullable());
    await ensureColumn("ErrorLogs", "ResolvedAt", (table) => table.string("ResolvedAt").nullable());
    await ensureColumn("ErrorLogs", "ResolvedBy", (table) => table.string("ResolvedBy").nullable());
  }

  // Check SyncQueue table
  if (!await db.schema.hasTable("SyncQueue")) {
    await db.schema.createTable("SyncQueue", (table) => {
      table.increments("Id").primary();
      table.integer("CompanyId").unsigned().notNullable()
        .references("Id").inTable("Companies").onDelete("CASCADE");
      table.string("DocumentType").notNullable();
      table.string("ExternalId").notNullable();
      table.string("DocumentNumber").nullable();
      table.string("DocumentDate").notNullable();
      table.text("Payload").notNullable();
      table.integer("Status").notNullable();
      table.integer("RetryCount").notNullable().defaultTo(0);
      table.integer("MaxRetries").notNullable().defaultTo(3);
      table.text("LastError").nullable();
      table.integer("MikroRecno").nullable();
      table.integer("Priority").notNullable().defaultTo(0);
      table.string("QueuedAt").notNullable();
      table.string("ProcessingStartedAt").nullable();
      table.string("CompletedAt").nullable();
      table.string("DeviceId").nullable();
      table.string("UserId").nullable();

      table.unique(["CompanyId", "ExternalId"]);
    });
    console.log("Table 'SyncQueue' created.");
  } else {
    await ensureColumn("SyncQueue", "DocumentNumber", (table) => table.string("DocumentNumber").nullable());
    await ensureColumn("SyncQueue", "RetryCount", (table) => table.integer("RetryCount").notNullable().defaultTo(0));
    await ensureColumn("SyncQueue", "MaxRetries", (table) => table.integer("MaxRetries").notNullable().defaultTo(3));
    await ensureColumn("SyncQueue", "LastError", (table) => table.text("LastError").nullable());
    await ensureColumn("SyncQueue", "MikroRecno", (table) => table.integer("MikroRecno").nullable());
    await ensureColumn("SyncQueue", "Priority", (table) => table.integer("Priority").notNullable().defaultTo(0));
    await ensureColumn("SyncQueue", "ProcessingStartedAt", (table) => table.string("ProcessingStartedAt").nullable());
    await ensureColumn("SyncQueue", "CompletedAt", (table) => table.string("CompletedAt").nullable());
    await ensureColumn("SyncQueue", "DeviceId", (table) => table.string("DeviceId").nullable());
    await ensureColumn("SyncQueue", "UserId", (table) => table.string("UserId").nullable());
  }

  // Check CariHesaplar table
  if (!await db.schema.hasTable("CariHesaplar")) {
    await db.schema.createTable("CariHesaplar", (table) => {
      table.increments("Id").primary();
      table.integer("CompanyId").unsigned().notNullable()
        .references("Id").inTable("Companies").onDelete("CASCADE");
      table.string("CariKodu").notNullable();
      table.string("CariAdi").notNullable();
      table.string("VergiDairesi").nullable();
      table.string("VergiNumarasi").nullable();
      table.float("Bakiye").notNullable().defaultTo(0.0);
      table.string("LastSyncAt").notNullable();

      table.unique(["CompanyId", "CariKodu"]);
    });
    console.log("Table 'CariHesaplar' created.");
  } else {
    await ensureColumn("CariHesaplar", "VergiDairesi", (table) => table.string("VergiDairesi").nullable());
    await ensureColumn("CariHesaplar", "VergiNumarasi", (table) => table.string("VergiNumarasi").nullable());
    await ensureColumn("CariHesaplar", "Bakiye", (table) => table.float("Bakiye").notNullable().defaultTo(0.0));
    await ensureColumn("CariHesaplar", "LastSyncAt", (table) => table.string("LastSyncAt").nullable());
  }

  // Check StokKartlar table
  if (!await db.schema.hasTable("StokKartlar")) {
    await db.schema.createTable("StokKartlar", (table) => {
      table.increments("Id").primary();
      table.integer("CompanyId").unsigned().notNullable()
        .references("Id").inTable("Companies").onDelete("CASCADE");
      table.string("StokKodu").notNullable();
      table.string("StokAdi").notNullable();
      table.string("Birim").nullable();
      table.string("Barkod").nullable();
      table.float("SatisFiyati1").notNullable().defaultTo(0.0);
      table.string("LastSyncAt").notNullable();

      table.unique(["CompanyId", "StokKodu"]);
    });
    console.log("Table 'StokKartlar' created.");
  } else {
    await ensureColumn("StokKartlar", "Birim", (table) => table.string("Birim").nullable());
    await ensureColumn("StokKartlar", "Barkod", (table) => table.string("Barkod").nullable());
    await ensureColumn("StokKartlar", "SatisFiyati1", (table) => table.float("SatisFiyati1").notNullable().defaultTo(0.0));
    await ensureColumn("StokKartlar", "LastSyncAt", (table) => table.string("LastSyncAt").nullable());
  }

  // Insert default company
  const defaultCompany = await db("Companies").where({ Code: "ADMIN" }).first();
  if (!defaultCompany) {
    await db("Companies").insert({
      Name: "Ana Şirket",
      Code: "ADMIN",
      TenantId: "tnt_admin",
      CreatedAt: new Date().toISOString(),
      IsActive: 1
    });
    console.log("Default company inserted.");
  } else if (!defaultCompany.TenantId) {
    await db("Companies").where({ Code: "ADMIN" }).update({ TenantId: "tnt_admin" });
    console.log("Default company TenantId updated.");
  }

  // Backfill existing companies with TenantId if they don't have one
  const companiesWithoutTenant = await db("Companies").whereNull("TenantId").orWhere("TenantId", "");
  for (const comp of companiesWithoutTenant) {
    const generatedTenantId = comp.Code === "ADMIN" ? "tnt_admin" : `tnt_${crypto.randomBytes(6).toString('hex')}`;
    await db("Companies").where({ Id: comp.Id }).update({ TenantId: generatedTenantId });
    console.log(`Backfilled TenantId ${generatedTenantId} for company: ${comp.Name}`);
  }
  
  console.log("Database schema initialization finished successfully.");
}
