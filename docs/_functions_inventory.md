# ภาคผนวก B — Inventory ของ Backend Functions ทั้ง 55 ตัว

ตารางนี้สร้างจากการสแกนโค้ดจริงใน `base44/functions/` ทุกไฟล์ เรียงตามขนาด (LOC) เพื่อใช้ประเมินลำดับและ effort ในการพอร์ต

| # | function | LOC | ตรวจ auth | น่าจะเป็น cron | webhook | สิ่งที่ต้องต่อใหม่ |
|---|---|---:|---|---|---|---|
| 1 | `taxqaParseFile` | 417 | yes | — | — | service_role |
| 2 | `credentialManager` | 398 | yes | — | — | Email, service_role |
| 3 | `meetingActionReminder` | 337 | no | likely | — | LINE API, Email, service_role |
| 4 | `taxqaValidate` | 337 | yes | — | — | service_role |
| 5 | `directorManager` | 336 | yes | — | — | Email, service_role |
| 6 | `taxqaReview` | 334 | yes | — | — | service_role |
| 7 | `emailDueDateReminder` | 307 | no | likely | — | Email, service_role |
| 8 | `browseLineDrive` | 305 | yes | — | — | GDrive OAuth, service_role |
| 9 | `lineWebhook` | 299 | no | — | yes | LINE API, Storage, service_role |
| 10 | `autoGenerateMonthlyTasks` | 294 | yes | likely | — | LINE API, service_role |
| 11 | `generateTaxDeadlines` | 279 | yes | — | — | service_role |
| 12 | `lineDueDateReminder` | 272 | no | likely | — | LINE API, service_role |
| 13 | `taxDeadlineReminder` | 248 | no | likely | — | LINE API, service_role |
| 14 | `riskScoreAlert` | 231 | no | — | — | LINE API, Email, service_role |
| 15 | `retryDriveSave` | 230 | yes | likely | — | GDrive OAuth, service_role |
| 16 | `generateMonthlyTasks` | 223 | yes | — | — | service_role |
| 17 | `seedTaxTemplates` | 222 | yes | — | — | service_role |
| 18 | `lineNotifyTask` | 203 | no | — | — | LINE API, service_role |
| 19 | `pollOcrResult` | 198 | yes | — | — | GDrive OAuth, Manus OCR, service_role |
| 20 | `saveLineFileToDrive` | 197 | no | — | — | GDrive OAuth, service_role |
| 21 | `lineBillingReminder` | 176 | no | likely | — | LINE API, service_role |
| 22 | `manusWebhook` | 164 | no | — | yes | GDrive OAuth, service_role |
| 23 | `cleanupAuditLog` | 162 | no | likely | — | GDrive OAuth, service_role |
| 24 | `submitOcr` | 162 | yes | — | — | Manus OCR, service_role |
| 25 | `customerDeleteManager` | 161 | yes | — | — | service_role |
| 26 | `peakLicenseReminder` | 146 | yes | likely | — | LINE API, Email, service_role |
| 27 | `todoEmailReminder` | 138 | no | likely | — | Email, service_role |
| 28 | `uploadKbFile` | 135 | yes | — | — | GDrive OAuth, service_role |
| 29 | `listLineChats` | 134 | yes | — | — | service_role |
| 30 | `weeklyPostponeSummary` | 133 | yes | likely | — | Email, service_role |
| 31 | `uploadFindingFile` | 130 | yes | — | — | GDrive OAuth, service_role |
| 32 | `lineSendMessage` | 125 | yes | — | — | LINE API, service_role |
| 33 | `listLineMessages` | 121 | yes | — | — | service_role |
| 34 | `trackDueDateChange` | 117 | no | — | — | service_role |
| 35 | `downloadFolderZip` | 109 | yes | — | — | GDrive OAuth, Storage, service_role |
| 36 | `manualRetryDriveSave` | 100 | yes | — | — | service_role |
| 37 | `autoCleanup` | 97 | yes | likely | — | LINE API, service_role |
| 38 | `listGroupMembers` | 95 | yes | — | — | LINE API, service_role |
| 39 | `kbPendingReminder` | 89 | no | likely | — | service_role |
| 40 | `registerManusWebhook` | 89 | yes | — | yes | Manus OCR, service_role |
| 41 | `testLineConnection` | 81 | yes | — | — | LINE API, service_role |
| 42 | `downloadMultipleFiles` | 79 | yes | — | — | GDrive OAuth, Storage, service_role |
| 43 | `testEmailConnection` | 70 | yes | — | — | Email, service_role |
| 44 | `testO365Connection` | 70 | yes | — | — | Email, service_role |
| 45 | `syncPeakLicense` | 67 | no | — | — | service_role |
| 46 | `markAllLineRead` | 62 | yes | — | — | service_role |
| 47 | `retryMonthlyTaskGeneration` | 59 | no | likely | — | service_role |
| 48 | `backfillReviewDeadline` | 56 | yes | — | — | service_role |
| 49 | `holidayApi` | 47 | no | — | — | env secret, service_role |
| 50 | `updateUser` | 47 | yes | — | — | service_role |
| 51 | `syncPeakToCustomer` | 43 | no | — | — | service_role |
| 52 | `autoSetCompletedDate` | 40 | no | likely | — | service_role |
| 53 | `listUsers` | 36 | yes | — | — | service_role |
| 54 | `checkGdriveConnection` | 31 | yes | — | — | GDrive OAuth, service_role |
| 55 | `markLineMessagesRead` | 27 | yes | — | — | service_role |

**รวม 55 functions, 9,065 บรรทัด**

- ใช้ Google Drive connector (11): `browseLineDrive`, `checkGdriveConnection`, `cleanupAuditLog`, `downloadFolderZip`, `downloadMultipleFiles`, `manusWebhook`, `pollOcrResult`, `retryDriveSave`, `saveLineFileToDrive`, `uploadFindingFile`, `uploadKbFile`
- เรียก LINE Messaging API (13): `autoCleanup`, `autoGenerateMonthlyTasks`, `lineBillingReminder`, `lineDueDateReminder`, `lineNotifyTask`, `lineSendMessage`, `lineWebhook`, `listGroupMembers`, `meetingActionReminder`, `peakLicenseReminder`, `riskScoreAlert`, `taxDeadlineReminder`, `testLineConnection`
- เรียก Manus OCR (3): `pollOcrResult`, `registerManusWebhook`, `submitOcr`
- ส่งอีเมล (10): `credentialManager`, `directorManager`, `emailDueDateReminder`, `meetingActionReminder`, `peakLicenseReminder`, `riskScoreAlert`, `testEmailConnection`, `testO365Connection`, `todoEmailReminder`, `weeklyPostponeSummary`
- น่าจะตั้งเวลา/cron (15): `autoCleanup`, `autoGenerateMonthlyTasks`, `autoSetCompletedDate`, `cleanupAuditLog`, `emailDueDateReminder`, `kbPendingReminder`, `lineBillingReminder`, `lineDueDateReminder`, `meetingActionReminder`, `peakLicenseReminder`, `retryDriveSave`, `retryMonthlyTaskGeneration`, `taxDeadlineReminder`, `todoEmailReminder`, `weeklyPostponeSummary`
- เป็น public webhook (3): `lineWebhook`, `manusWebhook`, `registerManusWebhook`


---

## อัปเดตหลังได้ Base44 dashboard (17 ส.ค. 2569)

- `autoSetCompletedDate`, `trackDueDateChange` → เปลี่ยนเป็น **native PL/pgSQL trigger**
  (ทดสอบผ่านแล้ว) → **เหลือ 53 functions ที่ต้องพอร์ต** ไม่ใช่ 55
- `syncPeakToCustomer`, `syncPeakLicense` → เป็น entity-trigger ยิงผ่าน dispatcher
- 13 functions เป็น cron (ดู `_automation_mapping.md`)
- `emailDueDateReminder`, `riskScoreAlert` → dashboard ไม่มีตารางเวลา (ยืนยันก่อนตั้ง cron)
