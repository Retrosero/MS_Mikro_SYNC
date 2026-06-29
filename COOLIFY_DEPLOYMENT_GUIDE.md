# Coolify Deployment Guide (Adım Adım)

Bu doküman, oluşturduğumuz uygulamayı (Node.js + SQLite/PostgreSQL/MySQL + React/Vite) Coolify üzerinde nasıl sorunsuz bir şekilde yayınlayacağınızı adım adım anlatmaktadır.

## 1. Hazırlık ve GitHub Entegrasyonu

Uygulamanın GitHub'a `lisans_server` veya `MS_Mikro_SYNC` adıyla yüklendiğinden emin olun. Proje içerisinde oluşturduğumuz `Dockerfile` ve `.dockerignore` dosyaları uygulamanın Coolify üzerinde Docker tabanlı olarak en verimli şekilde derlenmesini sağlayacaktır.

### ⚠️ ÖNEMLİ: Özel (Private) Depo Bağlantısı ve Yetki Hatası (Hata: `could not read Username for...`)

Eğer GitHub reponuz **Private (Gizli)** ise, Coolify projeyi çekmeye çalışırken şu hatayı verecektir:
`Error: fatal: could not read Username for 'https://github.com': No such device or address`

Bu sorunu çözmek için Coolify'a yetki vermeniz gerekir. **En kolay iki çözüm yolu şunlardır:**

#### Çözüm 1: Repo URL'sine Token Eklemek (En Kolay Yol)
Coolify üzerinde yeni kaynak eklerken veya var olan kaynağın ayarlarına giderek Repository URL'sini şu formatta güncelleyin:
```
https://<GITHUB_TOKEN>@github.com/Retrosero/MS_Mikro_SYNC.git
```
*(Böylece Coolify, sizin sağladığınız GitHub token ile depoya doğrudan ve şifresiz erişebilir).*

#### Çözüm 2: Coolify'a SSH Key Eklemek ve Deploy Key Tanımlamak
1. Coolify üzerinde **Keys** (Anahtarlar) sekmesine gidin ve yeni bir SSH Key oluşturun. Özel anahtarı Coolify'a kaydedin.
2. Oluşturulan SSH Key'in **Public (Açık)** anahtarını kopyalayın.
3. GitHub reponuza gidin (**Settings -> Deploy keys**).
4. **Add deploy key** butonuna tıklayın, kopyaladığınız anahtarı yapıştırın ve "Allow write access" seçeneğini işaretlemeden kaydedin.
5. Coolify'da uygulama kaynağını eklerken SSH bağlantı biçimini seçin: `git@github.com:Retrosero/MS_Mikro_SYNC.git`

#### Çözüm 3: GitHub App Entegrasyonu (Uzun Vadeli En Sağlıklı Yol)
1. Coolify ana menüsünden **Sources** sekmesine gidin ve **GitHub App** ekle seçeneğine tıklayın.
2. Coolify yönlendirmelerini takip ederek GitHub organizasyonunuza/hesabınıza bir Coolify GitHub App yükleyin.
3. Uygulamayı kurarken kaynak olarak bu entegrasyonu seçtiğinizde tüm gizli repolarınız otomatik listelenir ve yetkilendirme Coolify tarafından güvenli bir şekilde arka planda yönetilir.

## 2. Yeni Uygulama (Resource) Oluşturma

1. Coolify kontrol panelinize giriş yapın.
2. **Projects** kısmından projenizi ve ortamınızı (örneğin "Production") seçin.
3. **+ New Resource** butonuna tıklayın.
4. **Application** seçeneğini seçin.
5. Kaynak olarak **GitHub** (veya Private GitHub App, nasıl bağladığınıza bağlı) seçin.
6. `lisans_server` reponuzu ve çalışmak istediğiniz branch'i (genelde `main` veya `master`) seçin.

## 3. Veritabanı Seçimi ve Kurulumu

Uygulamamız üç veritabanını da (SQLite, PostgreSQL, MySQL) destekler. Coolify üzerinde hangisini kullanmak istiyorsanız aşağıdaki adımları takip edin:

### Seçenek A: SQLite Kullanımı (Varsayılan ve En Pratiği)
Herhangi bir ekstra veritabanı kurmanıza gerek yoktur. Sadece aşağıdaki **Persistent Storage** adımını uygulayarak veritabanının silinmesini önleyin.

### Seçenek B: PostgreSQL / MySQL Kullanımı (Daha Güçlü ve Ölçeklenebilir)
1. Coolify üzerinde projenizin olduğu alana gidin.
2. **+ New Resource** butonuna tıklayın ve **Database** seçin.
3. Listeden **PostgreSQL** veya **MySQL** seçerek kurulumu tamamlayın.
4. Kurulum bittikten sonra veritabanı detayları sayfasında yer alan **Internal Connection String** (örn: `postgres://username:password@postgresql:5432/database`) değerini kopyalayın.

## 4. Yapılandırma (Configuration) Ayarları

Uygulamanız eklendikten sonra karşınıza çıkan Configuration ekranında aşağıdaki ayarları yapın:

### 4.1. Build Pack Ayarı
- **Build Pack:** Otomatik olarak Nixpacks seçilmiş olabilir. Bunu **Docker** (veya Dockerfile) olarak değiştirin. Zaten projede uygulamanın nasıl derleneceğini eksiksiz anlatan bir `Dockerfile` bulunmaktadır.

### 4.2. Port Ayarları
- **Ports Exposes:** `4000` olarak değiştirin (Dockerfile içerisinde uygulamamız varsayılan olarak 4000 portunda ayağa kalkacak şekilde güncellenmiştir).

### 4.3. Environment Variables (Çevre Değişkenleri)
Sol menüden **Environment Variables** sekmesine gidin ve aşağıdaki değişkenleri ekleyin:

- `NODE_ENV`: `production`
- `PORT`: `4000`
- `JWT_SECRET`: (Kendi belirlediğiniz, tahmin edilemez, uzun ve güvenli bir şifre girin. Örneğin: `b1c4e92a-3b5f-4a8d-b2e1-c8f3a9e4d2b1`)
- `APP_URL`: Coolify'ın uygulamanıza atayacağı domain adresini yazın (örneğin: `https://api.sirketiniz.com`).

**Eğer PostgreSQL veya MySQL kullanıyorsanız ek olarak şunları girin:**
- `DB_CLIENT`: `pg` (PostgreSQL için) veya `mysql2` (MySQL için)
- `DATABASE_URL`: (Coolify veritabanından kopyaladığınız Internal Connection String değerini buraya yapıştırın. Örn: `postgres://postgres:password@postgresql:5432/postgres`)

### 4.4. Persistent Storage (Sadece SQLite kullananlar için Zorunlu)
Eğer **SQLite** kullanıyorsanız, uygulama güncellendiğinde veritabanınızın silinmemesi için kalıcı bir depolama alanı (Volume) tanımlamalısınız. **PostgreSQL/MySQL kullananların bu adımı yapmasına gerek yoktur.**

1. Sol menüden **Storages** sekmesine gidin.
2. Yeni bir Volume ekleyin:
   - **Name/Volume Name:** `lisans-server-data`
   - **Destination Path:** `/app/.data`
3. Kaydedin.

## 5. Deploy (Yayınlama)

1. Tüm ayarları yaptıktan sonra sağ üstteki **Deploy** butonuna tıklayın.
2. Deployment loglarını izleyin. Coolify önce `Dockerfile` içindeki adımları izleyerek Node.js paketlerini indirecek, React arayüzünü (Vite ile) derleyecek ve ardından uygulamayı başlatacaktır.
3. "Deployed" durumunu gördüğünüzde, Configuration sekmesindeki **Domains** kısmından uygulamanıza atanan linke tıklayarak yönetim paneline ulaşabilirsiniz.

---

## 💡 İpuçları ve Güvenlik Notları

- **Otomatik Şema Kurulumu:** Uygulama ilk kez ayağa kalkarken veritabanınızda (SQLite, PostgreSQL veya MySQL) gerekli tabloların olup olmadığını kontrol eder. Eğer tablolar yoksa, tüm tabloları, indexleri ve kısıtlamaları (Foreign Key) otomatik olarak sıfırdan oluşturur. Sizin manuel hiçbir SQL sorgusu çalıştırmanıza gerek yoktur!
- **Rate Limiter (İstek Sınırlandırma):** Coolify ters vekil (Reverse Proxy - Traefik/Caddy) arkasında çalıştığı için, yazdığımız Rate Limiter ayarlarının IP adreslerini doğru alabilmesi için `server.ts` içinde `app.set("trust proxy", 1);` ayarını ekledik. Bu sayede limitler düzgün çalışacaktır.
- **SSL/TLS (HTTPS):** Coolify, uygulamanıza atadığınız domain için otomatik olarak Let's Encrypt SSL sertifikası üretecektir. Veri güvenliğiniz için arayüze sadece HTTPS üzerinden eriştiğinize emin olun.
- **Veritabanı Yedekleme:** SQLite kullanıyorsanız, tek bir `.sqlite` dosyasını yedeklemeniz yeterlidir. PostgreSQL/MySQL kullanıyorsanız, Coolify arayüzünden doğrudan otomatik yedekleme (S3, local vb.) takvimleri ayarlayabilirsiniz.
