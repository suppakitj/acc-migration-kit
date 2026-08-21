# คู่มือตั้งค่า Google OAuth + Cloudflare Tunnel + Tailscale
### ACC Operation System — self-hosted

ค่าที่ใช้ตลอดคู่มือนี้ (แก้ให้ตรงของจริงถ้าต่าง):

| ตัวแปร | ค่า |
|---|---|
| โดเมนแอป | `accoperation.com` |
| Redirect URI (Google) | `https://accoperation.com/functions/v1/googleOAuthCallback` |
| แอปฟังภายในที่ | `127.0.0.1:8080` (Caddy) |
| Studio (admin) | `127.0.0.1:3000` |

> หมายเหตุ: UI ของ Google Cloud Console และ Cloudflare เปลี่ยนหน้าตาเป็นระยะ ผมอธิบายตาม "หน้าที่ของแต่ละขั้น" ถ้าปุ่มย้ายที่ ให้มองหาคำที่สื่อความหมายเดียวกัน

---

# ส่วนที่ 1 — Google OAuth (สำหรับ Google Drive)

Base44 เคยจัดการ token ของ Google Drive ให้เอง ตอน self-host เราต้องสร้าง OAuth client ของเราเองหนึ่งครั้ง แล้ว `googleOAuthStart`/`googleOAuthCallback` ที่ผมเขียนไว้จะเก็บ refresh token ลงตาราง `oauth_connection` ให้อัตโนมัติ

### ⚠️ อ่านก่อน — กับดักสำคัญเรื่องอายุ refresh token

โดเมน `accconsultingservice.com` ของคุณอยู่บน **Microsoft 365 ไม่ใช่ Google Workspace** ดังนั้นบัญชี Google ที่เป็นเจ้าของ Drive จะเป็นบัญชีแยก และ OAuth consent screen ต้องตั้งเป็น **"External"**

ผลตามมาที่ต้องรู้: scope `.../auth/drive` เป็น **restricted scope** และ

- ถ้า publishing status = **"Testing"** → **refresh token หมดอายุใน 7 วัน** (ต้อง consent ใหม่ทุกสัปดาห์ — ใช้จริงไม่ได้)
- ถ้า publishing status = **"In production"** → refresh token อยู่ถาวร แต่ Google อาจขอ verification (security assessment) สำหรับ restricted scope

**ทางเลือกที่แนะนำ เรียงตามความเหมาะสม:**

1. **ย้ายบัญชี Google Drive ไปอยู่ใต้ Google Workspace ที่คุณควบคุม** แล้วตั้ง consent เป็น **"Internal"** → ไม่ต้อง verify และ token อยู่ถาวร (ดีที่สุดถ้ามี Workspace อยู่แล้วหรือยอมเปิด)
2. **Publish เป็น Production ทั้งที่ยังไม่ verify** — Google ยอมให้ใช้ได้ แต่ผู้ consent จะเห็นหน้าจอเตือน "unverified app" (กด Advanced → ไปต่อได้) เหมาะกับ internal tool ที่ consent แค่บัญชีเดียว ครั้งเดียว
3. **จำกัด scope เหลือ `drive.file`** (เข้าถึงเฉพาะไฟล์ที่แอปสร้างเอง — ไม่ใช่ restricted ไม่ต้อง verify) **แต่** ฟังก์ชันเดิม (`browseLineDrive`, `downloadFolderZip`) ต้องเข้าถึงโฟลเดอร์ที่มีอยู่แล้ว จึงใช้ `drive.file` ไม่พอ — ตัวเลือกนี้ใช้ได้ก็ต่อเมื่อยอมปรับ flow ให้แอปทำงานเฉพาะในโฟลเดอร์ที่มันสร้าง

> ข้อสังเกตเชิงกลยุทธ์: ในเมื่อบริษัทอยู่บน M365 อยู่แล้ว ระยะยาวควรพิจารณาว่ายังจำเป็นต้องพึ่ง Google Drive หรือย้าย flow เหล่านี้ไป OneDrive/SharePoint — แต่นั่นเป็นงานคนละเฟส สำหรับ migration นี้ให้ทำตามของเดิมไปก่อน (ตัวเลือก 1 หรือ 2)

### ขั้นตอน

**1.1 สร้าง project**
เข้า https://console.cloud.google.com → บนสุดเลือก project → **New Project** → ตั้งชื่อ `ACC Operation System` → Create

**1.2 เปิดใช้ Google Drive API**
เมนู → **APIs & Services → Library** → ค้น "Google Drive API" → **Enable**

**1.3 ตั้ง OAuth consent screen**
APIs & Services → **OAuth consent screen** (บางบัญชีอยู่ใต้ "Google Auth Platform")
- User type: **External** → Create
- กรอก App name (`ACC Operation System`), User support email, Developer contact
- **Scopes** → Add or Remove Scopes → เพิ่ม:
  - `https://www.googleapis.com/auth/drive`
  - `https://www.googleapis.com/auth/userinfo.email`
- **Test users** → เพิ่มอีเมล Google ที่จะกด consult (บัญชีเจ้าของ Drive)
- ตัดสินใจ Publishing status ตามตัวเลือกด้านบน (แนะนำ **Publish → Production** สำหรับตัวเลือก 2)

**1.4 สร้าง OAuth client**
APIs & Services → **Credentials → Create Credentials → OAuth client ID**
- Application type: **Web application**
- Name: `acc-ops-web`
- **Authorized redirect URIs** → Add URI (พิมพ์ให้ตรงเป๊ะทุกตัวอักษร):
  ```
  https://accoperation.com/functions/v1/googleOAuthCallback
  ```
  (ถ้าจะทดสอบในเครื่อง dev ก่อน เพิ่ม `http://localhost:8000/functions/v1/googleOAuthCallback` อีกบรรทัด)
- **Create** → คัดลอก **Client ID** และ **Client secret**

**1.5 ใส่ค่าใน `.env` ของ server**
```
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
```

**1.6 เชื่อมต่อจากในแอป**
เปิดแอป → **AppSettings → เชื่อมต่อ → Google Drive → "เชื่อม Google Drive"**
(ปุ่มนี้เรียก `googleOAuthStart` → พาไปหน้า consent ของ Google → กลับมาที่ `googleOAuthCallback` ซึ่งเก็บ refresh token ให้)
ตรวจผล: หน้า Settings จะขึ้นสถานะเชื่อมต่อแล้ว หรือเรียก `checkGdriveConnection`

> ถ้า callback แจ้งว่า "ไม่ได้ refresh_token" — แปลว่าบัญชีนี้เคย consent ไปแล้ว ให้ไปที่ https://myaccount.google.com/permissions เพิกถอนสิทธิ์ของแอป แล้ว consent ใหม่ (โค้ดตั้ง `prompt=consent` ไว้แล้วเพื่อบังคับขอใหม่)

---

# ส่วนที่ 2 — Cloudflare Tunnel (เปิดแอปสู่ภายนอกโดยไม่เปิด port)

### ✅ ข้อดีของการใช้โดเมนแยก `accoperation.com`

คุณเลือกใช้โดเมนแยกสำหรับระบบนี้ ซึ่งเป็นทางที่ **ปลอดภัยที่สุด** — เพราะ `accoperation.com`
ไม่ได้ใช้รับส่งอีเมล M365 (อีเมลอยู่บน `accconsultingservice.com` คนละโดเมน) จึง
**ไม่มีความเสี่ยงเมลล่ม**ตอนย้าย nameserver และตั้งค่าได้ตรงไปตรงมา

ขั้นเตรียมโดเมน (ทำครั้งเดียว):
1. เพิ่ม `accoperation.com` เข้า Cloudflare (Add a site) — เลือกแพลนฟรี
2. Cloudflare จะให้ nameserver 2 ตัว → ไปตั้งที่ผู้จดโดเมน (registrar) ให้ชี้มาที่ Cloudflare
3. รอ nameserver มีผล (ปกติไม่กี่นาที–ชั่วโมง) → สถานะใน Cloudflare ขึ้น **Active**
4. ไม่ต้องยกระเบียน DNS ใด ๆ เพราะเป็นโดเมนใหม่ที่ยังไม่มีบริการอื่นผูกอยู่

> ถ้าโดเมนนี้ในอนาคตจะใช้ทำอย่างอื่นด้วย (เช่นเว็บบริษัท) ค่อยเพิ่มระเบียนแยกภายหลังได้
> — ตอนนี้มีแค่ระเบียนเดียวที่ `tunnel route dns` สร้างให้สำหรับชี้มาที่ระบบ

### ขั้นตอนบน Ubuntu server

**2.1 ติดตั้ง cloudflared**
```bash
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

**2.2 ล็อกอิน + สร้าง tunnel**
```bash
cloudflared tunnel login            # เปิด browser เลือกโดเมน accoperation.com
cloudflared tunnel create acc-ops   # ได้ Tunnel UUID + ไฟล์ credential ใน ~/.cloudflared/
```

**2.3 ไฟล์ config** — `/etc/cloudflared/config.yml`
```yaml
tunnel: acc-ops
credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json

ingress:
  # แอปหลัก + API + webhook — ทั้งหมดวิ่งเข้า Caddy ที่ 8080
  - hostname: accoperation.com
    service: http://127.0.0.1:8080
  # ปิดท้ายเสมอ
  - service: http_status:404
```

**2.4 ผูก DNS + ติดตั้งเป็น service**
```bash
cloudflared tunnel route dns acc-ops accoperation.com
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared     # ต้องเห็น active (running)
```

เปิด `https://accoperation.com` ควรเจอหน้า Login ของแอป (Cloudflare ออกใบ TLS ให้อัตโนมัติ)

### 2.5 (ทางเลือก) Cloudflare Access — เพิ่มด่านที่สอง

แอปมี login ของตัวเอง (email+password + 2FA) อยู่แล้ว Access เป็น **ตัวเลือกเสริม** ถ้าต้องการกันบอทสแกนตั้งแต่หน้าประตู แต่จะทำให้ผู้ใช้ต้องยืนยันตัวสองชั้น

**ถ้าจะเปิด Access ต้องยกเว้น path ของ webhook** ไม่งั้น LINE/Manus จะยิงเข้าไม่ได้:

ใน Cloudflare Zero Trust → Access → Applications:
1. สร้าง **Application (Self-hosted)** ครอบ `accoperation.com/functions/v1/lineWebhook` → policy **Bypass / Everyone** (ทำก่อน เพื่อให้ precedence สูงกว่า)
2. สร้างอีกอันครอบ `accoperation.com/functions/v1/manusWebhook` → **Bypass / Everyone**
3. สร้าง Application ครอบ `accoperation.com` (ทั้งโดเมน) → policy **Allow** เฉพาะอีเมล `@accconsultingservice.com`

> ถ้าไม่อยาก login สองชั้น ข้ามข้อ 2.5 ได้ — Tunnel อย่างเดียวก็ปลอดภัยพอ เพราะ port ไม่ได้เปิด และแอปมี auth + RLS ป้องกันอยู่แล้ว

---

# ส่วนที่ 3 — Tailscale (เข้า Supabase Studio อย่างปลอดภัย)

Studio (หน้าจัดการ DB) ผูกไว้ที่ `127.0.0.1:3000` เท่านั้น **ห้าม expose ออกเน็ต** เข้าผ่าน Tailscale

**3.1 ติดตั้งบน server**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up          # ล็อกอินด้วยบัญชีบริษัท
tailscale ip -4            # จดเลข IP 100.x.y.z ของเครื่อง
```

**3.2 เข้า Studio จากเครื่องคุณ** (ติดตั้ง Tailscale ในเครื่องตัวเองด้วย แล้ว)
วิธีที่ง่ายและปลอดภัยสุด — SSH port-forward ผ่าน Tailscale:
```bash
ssh -L 3000:127.0.0.1:3000 <user>@<ชื่อเครื่องใน-tailscale>
# แล้วเปิดเบราว์เซอร์ที่ http://localhost:3000
# ล็อกอิน Studio ด้วย DASHBOARD_USERNAME / DASHBOARD_PASSWORD ใน .env
```

> อย่าเปิด port 3000 ที่ Caddy หรือ tunnel เด็ดขาด — Studio มีสิทธิ์เต็มเหนือฐานข้อมูล

---

# เช็คลิสต์ยืนยันว่าตั้งครบ

- [ ] Google: enable Drive API, consent screen (External + scope drive/email + test users), Publish สถานะเหมาะสม
- [ ] Google: OAuth client (Web) + redirect URI ตรงเป๊ะ → ใส่ `GOOGLE_CLIENT_ID/SECRET` ใน `.env`
- [ ] แอป AppSettings เชื่อม Google Drive สำเร็จ (`checkGdriveConnection` ผ่าน)
- [ ] Cloudflare: โดเมนอยู่ใน CF, ระเบียน M365 (MX/SPF/DKIM/autodiscover) ครบ, อีเมลยังใช้ได้
- [ ] `https://accoperation.com` เปิดเจอหน้า Login (TLS เขียว)
- [ ] (ถ้าเปิด Access) bypass path `lineWebhook` + `manusWebhook` แล้ว
- [ ] Tailscale เข้า Studio ได้ผ่าน SSH forward — และ 3000 ไม่ถูก expose ออกเน็ต
- [ ] เปลี่ยน webhook URL ที่ LINE Developers Console → `https://accoperation.com/functions/v1/lineWebhook`
- [ ] เปลี่ยน webhook URL ที่ Manus → `.../functions/v1/manusWebhook` (ตั้ง `manus_webhook_secret` ก่อน)
```
