# MikroSync ERP - Android Uygulaması API Entegrasyon Dokümantasyonu

Bu doküman, Android uygulamasının MikroSync ara sunucusu (Node.js) ile nasıl haberleşeceğini tanımlar. Android uygulamasını geliştirecek yapay zeka asistanına bu dokümanı temel kurallar olarak verebilirsiniz.

## 🏗️ Mimari ve Genel Kurallar

1. **İletişim Protokolü:** REST tabanlı HTTP istekleri. Veri formatı her zaman `application/json`'dır.
2. **Kimlik Doğrulama:** Tüm API istekleri HTTP Header kısmında `x-api-key` parametresi taşımalıdır. (Web admin panelinden müşteriye özel üretilen anahtar).
3. **Senkronizasyon Mantığı (Incremental Sync):** 
   - Android uygulama, verileri çekerken cihazdaki en son başarılı eşitleme tarihini (`since=YYYY-MM-DDTHH:mm:ssZ`) parametre olarak göndermelidir. Sunucu sadece bu tarihten sonra değişen kayıtları döner.
4. **Offline-First (Çevrimdışı Çalışma):** 
   - Cihazda internet yoksa işlemler lokal veritabanına (Room DB) kaydedilir.
   - İnternet bağlantısı sağlandığında arka planda sunucuya aktarılır (Push).
5. **Hata Yönetimi:** Cihazda oluşan tüm log, exception ve hatalar `/api/client/logs` endpointine atılarak admin panelinden izlenmelidir.

---

## 🔐 1. Kimlik Doğrulama ve Lisans Kontrolü

Uygulamanın ilk açılışında API Key'in geçerli olup olmadığını kontrol eder.

*   **Endpoint:** `GET /api/client/verify`
*   **Headers:** `x-api-key: <API_KEY>`
*   **Başarılı Yanıt (200 OK):**
    ```json
    {
      "valid": true,
      "companyId": 1,
      "companyName": "Acme Corp"
    }
    ```

---

## 📥 2. Veri Çekme (Pull - Sunucudan Android'e)

ERP'den gelip Node.js sunucusunda tutulan verilerin Android cihaza alınması.

### 2.1. Cari Hesaplar (Müşteriler)
*   **Endpoint:** `GET /api/client/carihesaplar?since={ISO_DATE_STRING}`
*   **Headers:** `x-api-key: <API_KEY>`
*   **Yanıt Örneği:**
    ```json
    [
      {
        "Id": 1,
        "CariKodu": "120.01.001",
        "CariAdi": "TEST MÜŞTERİ A.Ş.",
        "VergiDairesi": "Marmara",
        "VergiNumarasi": "1234567890",
        "Bakiye": "1500.50",
        "LastSyncAt": "2026-06-28T10:00:00Z"
      }
    ]
    ```

### 2.2. Stok Kartları (Ürünler)
*   **Endpoint:** `GET /api/client/stokkartlar?since={ISO_DATE_STRING}`
*   **Headers:** `x-api-key: <API_KEY>`
*   **Yanıt Örneği:**
    ```json
    [
      {
        "Id": 1,
        "StokKodu": "STK-001",
        "StokAdi": "Masaüstü Bilgisayar",
        "Birim": "Adet",
        "Barkod": "8690000000001",
        "SatisFiyati1": "15000.00",
        "LastSyncAt": "2026-06-28T10:00:00Z"
      }
    ]
    ```

---

## 📤 3. Veri Gönderme (Push - Android'den Sunucuya)

Sahada Android uygulaması üzerinden kesilen siparişlerin sunucuya iletilmesi. Gönderilen siparişler sunucuda `SyncQueue` (Kuyruk) tablosuna yazılır.

### 3.1. Sipariş Gönderimi (Toplu)
*   **Endpoint:** `POST /api/client/siparisler/sync`
*   **Headers:** `x-api-key: <API_KEY>`
*   **Body:**
    ```json
    {
      "orders": [
        {
          "EvrakNo": "SIP-2024001",
          "CariKodu": "120.01.001",
          "EvrakTarihi": "2026-06-28T14:30:00Z",
          "GenelToplam": "15000.00",
          "Aciklama": "Acil teslimat",
          "Kalemler": [
            {
              "StokKodu": "STK-001",
              "Miktar": "1",
              "BirimFiyat": "15000.00",
              "Tutar": "15000.00"
            }
          ]
        }
      ]
    }
    ```

---

## 🛠️ 4. Hata ve Log Bildirimi

Android tarafında oluşan (Crash, ağ hatası vb.) durumların admin paneline düşmesi için kullanılır.

*   **Endpoint:** `POST /api/client/logs`
*   **Headers:** `x-api-key: <API_KEY>`
*   **Body:**
    ```json
    {
      "AppVersion": "1.0.3",
      "DeviceId": "ANDROID_ID_XYZ",
      "Level": 3, 
      "Source": "AndroidSyncManager",
      "Message": "Ağ bağlantısı zaman aşımına uğradı",
      "StackTrace": "java.net.SocketTimeoutException..."
    }
    ```
    *Not: Level 1=Bilgi, 2=Uyarı, 3=Hata, 4=Kritik*

---

## 🤖 AI (Android Geliştiricisi) İçin Mimari Talimatlar

Sevgili AI, bu Android uygulamasını kodlarken şu mimari standartları uygulamalısın:

1. **Veritabanı:** Yerel veri depolaması için **Room Database** kullan. `CariHesap`, `StokKart`, `Siparis`, `SiparisKalem` entity'lerini oluştur.
2. **Ağ İstekleri:** API istekleri için **Retrofit** kullan. OkHttp Interceptor ekleyerek tüm isteklere otomatik olarak `x-api-key` header'ını enjekte et.
3. **Arka Plan İşlemleri:** Periyodik senkronizasyon (Pull/Push) için **WorkManager** kullan.
4. **Asenkron Yapı:** Thread bloklanmasını önlemek için **Kotlin Coroutines** ve **Flow** kullan.
5. **Arayüz (UI):** Kullanıcı arayüzünü modern **Jetpack Compose** ile yaz. Mimari pattern olarak **MVVM (Model-View-ViewModel)** yaklaşımını kesinlikle koru.
6. **Offline-First Akışı:** Kullanıcı yeni sipariş oluşturduğunda önce Room DB'ye kaydet (SyncStatus = PENDING). Cihaz online olduğunda WorkManager tetiklensin ve `/api/client/siparisler/sync` endpoint'ine göndersin. Başarılı olursa lokal DB'de SyncStatus = SYNCED olarak güncelle.
