# MikroSync ERP - Windows Entegratör Servisi API Dokümantasyonu

Bu doküman, yerelde (Mikro ERP sunucunuzun yanında) çalışacak olan **Windows Senkronizasyon Servisinin (C# / .NET Core Worker Service)** bu ara bulut sunucusu ile nasıl haberleşeceğini tanımlar.

Windows uygulamasını yazdıracağınız yapay zeka asistanına bu dokümanı girdi olarak vererek tek seferde mükemmel bir entegrasyon servisi kodlatabilirsiniz.

---

## 🏗️ Çalışma Mantığı ve Çift Yönlü Senkronizasyon

Windows Servisi, yereldeki **Mikro MS SQL Veritabanı** ile buluttaki **Node.js Ara Sunucusu** arasında çift yönlü bir köprü görevi görür:

1. **Yukarı Doğru Senkronizasyon (Upstream: Mikro ➔ Bulut)**:
   - Servis yerel SQL Server'dan yeni veya güncellenen **Cari Hesapları** ve **Stok Kartlarını** çeker.
   - Bulut sunucusuna toplu (bulk) olarak gönderir (`POST /api/erp/carihesaplar/bulk`, `POST /api/erp/stokkartlar/bulk`).
2. **Aşağı Doğru Senkronizasyon (Downstream: Bulut ➔ Mikro)**:
   - Servis buluttaki sipariş kuyruğunu sorgular (`GET /api/erp/queue`).
   - Gelen siparişleri yerel Mikro veritabanına yazarak sipariş fişlerini oluşturur.
   - İşlem sonucunu buluta bildirir (`POST /api/erp/queue/status` ➔ Başarılı: 1, Hata: 2).

---

## 🔐 Yetkilendirme (Header)
Tüm isteklerde HTTP Header'ında web yönetim panelinden ürettiğiniz ilgili firmaya ait API Anahtarı gönderilmelidir:
```http
x-api-key: [FİRMA_API_ANAHTARI]
Content-Type: application/json
```

---

## 📥 1. Buluttaki Sipariş Kuyruğunu Dinleme (Poll Queue)

Android cihazlardan gelen siparişler bulut kuyruğunda bekler. Windows servisi periyodik olarak (Örn: her 30 saniyede bir) bu kuyruğu kontrol eder.

*   **Endpoint:** `GET /api/erp/queue`
*   **İşleyiş:** Sunucu kuyruktaki bekleyen siparişleri dönerken, aynı siparişlerin tekrar çekilmesini önlemek için durumlarını otomatik olarak `3` (Processing/İşleniyor) yapar.
*   **Yanıt Yapısı (200 OK):**
    ```json
    [
      {
        "Id": 12,
        "DocumentType": "SIPARIS",
        "ExternalId": "SIP-2024001",
        "DocumentDate": "2026-06-28T14:30:00.000Z",
        "Payload": "{\"EvrakNo\":\"SIP-2024001\",\"CariKodu\":\"120.01.001\",\"EvrakTarihi\":\"2026-06-28T14:30:00Z\",\"GenelToplam\":15000.00,\"Aciklama\":\"Acil teslimat\",\"Kalemler\":[{\"StokKodu\":\"STK-001\",\"Miktar\":1,\"BirimFiyat\":15000.00,\"Tutar\":15000.00}]}",
        "QueuedAt": "2026-06-28T10:28:15.000Z"
      }
    ]
    ```

### ➔ Siparişi Yerel Mikro'ya Yazma ve Sonuç Bildirme
Windows servisi `Payload` alanındaki JSON verisini deserialize eder. Mikro SQL Server veritabanındaki ilgili sipariş tablolarına (`SIPARISLER` vb.) kaydeder.
Ardından işlemin başarılı veya hatalı olduğunu sunucuya bildirir:

*   **Endpoint:** `POST /api/erp/queue/status`
*   **İstek Gövdesi (Başarılı):**
    ```json
    {
      "Id": 12,
      "Status": 1,
      "MikroRecno": 48291
    }
    ```
*   **İstek Gövdesi (Hatalı/Başarısız):**
    ```json
    {
      "Id": 12,
      "Status": 2,
      "LastError": "Cari kodu (120.01.001) Mikro veritabanında bulunamadı!"
    }
    ```

---

## 📤 2. Mikro'dan Buluta Veri Gönderme (Bulk Push)

Windows Servisi, yerel Mikro SQL Server'dan çektiği güncel Cari ve Stok listesini buluta yükler. Bu sayede Android cihazlar her zaman güncel bakiye ve fiyatları çeker.

### 2.1. Cari Hesapları Yükleme
Yerel SQL sorgusuyla son değişen cariler seçilir ve toplu olarak gönderilir.

*   **Endpoint:** `POST /api/erp/carihesaplar/bulk`
*   **İstek Gövdesi:**
    ```json
    {
      "items": [
        {
          "CariKodu": "120.01.001",
          "CariAdi": "TEST MÜŞTERİ A.Ş.",
          "VergiDairesi": "Marmara V.D.",
          "VergiNumarasi": "1234567890",
          "Bakiye": 1500.50
        }
      ]
    }
    ```

### 2.2. Stok Kartlarını Yükleme
Yerel SQL sorgusuyla son değişen stok kartları, fiyatlar ve barkodlar seçilir.

*   **Endpoint:** `POST /api/erp/stokkartlar/bulk`
*   **İstek Gövdesi:**
    ```json
    {
      "items": [
        {
          "StokKodu": "STK-001",
          "StokAdi": "Masaüstü Bilgisayar i7",
          "Birim": "Adet",
          "Barkod": "8690000000001",
          "SatisFiyati1": 15000.00
        }
      ]
    }
    ```

---

## 🤖 AI (Windows C# Geliştiricisi) İçin Mimari Talimatlar

Sevgili AI, bu Windows entegrasyon servisini C# (.NET Core Worker Service) ile kodlarken aşağıdaki standartları uygulamalısın:

1. **Bağlantı ve Ayarlar:** `appsettings.json` dosyasında yerel Mikro MS SQL bağlantı dizesini (`ConnectionString`), API URL'sini ve `x-api-key` değerini tut.
2. **Kuyruk Yönetimi:** Siparişleri buluttan her 30 saniyede bir çek. Mikro SQL veritabanına yazarken **SQL Transaction** kullan. Başarılı olursa sipariş kaydının Mikro `RecNo` değerini alıp API'ye `Status: 1` ve `MikroRecno` olarak dön. Hata oluşursa `Status: 2` ve yakalanan `Exception.Message` bilgisini `LastError` olarak gönder.
3. **Senkronizasyon Sırası:**
   - Cari ve stok kartlarını yerel SQL veritabanından çekmek için SQL Server tarafındaki son güncelleme tarihini yerel bir SQLite dosyasında veya `registry`/dosyada `LastSyncDateTime` olarak sakla.
   - Sadece son senkronizasyondan sonra değişen kayıtları çek (`SELECT ... WHERE LastUpdateDate > @LastSync`).
   - Çekilen verileri bulut API'sine 500'erli paketler halinde (chunking) `POST` et.
4. **Loglama:** İşlemleri `Serilog` kullanarak konsola ve yerel dosyaya logla. Kritik bağlantı kesilmelerini buluttaki `/api/client/logs` endpointine de gönder.
