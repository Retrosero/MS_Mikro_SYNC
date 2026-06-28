export interface Company {
  Id: number;
  Name: string;
  Code: string;
  Email: string;
  Phone: string;
  Address: string;
  ContactPerson: string;
  CreatedAt: string;
  IsActive: number;
}

export interface License {
  Id: number;
  LicenseKey: string;
  CompanyId: number;
  CompanyName?: string;
  Type: number; // e.g., 1=Trial, 2=Basic, 3=Pro, 4=Enterprise
  Status: number; // 0=Inactive, 1=Active, 2=Expired, 3=Suspended
  StartDate: string;
  ExpiryDate: string;
  CreatedAt: string;
  MaxUsers: number;
  MaxDevices: number;
  EnableOfflineMode: number;
  EnableSync: number;
}

export interface ApiKey {
  Id: number;
  Key: string;
  CompanyId: number;
  CompanyName?: string;
  Name: string;
  Status: number; // 0=Inactive, 1=Active
  CreatedAt: string;
  ExpiryDate: string;
  LastUsedAt: string;
}

export interface ErrorLog {
  Id: number;
  CompanyId: number;
  CompanyName?: string;
  Source: string;
  Level: number; // 1=Info, 2=Warning, 3=Error, 4=Critical
  Message: string;
  Details: string;
  Timestamp: string;
  IsResolved: number;
}

export interface DashboardStats {
  totalCompanies: number;
  totalLicenses: number;
  activeLicenses: number;
  recentErrors: number;
}
