# 001 - Test 3 Ses Kesintisi, Karsilama Akisi ve Soru Atlama Duzeltmeleri

**Tarih:** 2026-04-01

## Sorunlar

### 1. Test 3 Gorsel Tanima - Ses Kesintisi
**Belirti:** Nora "Cevabinizi... kaydedeyim mi?" derken sesi kesiliyor, anlasilmiyor.
**Kok Neden:** VisualTestAgent'in `sendTextToLive` cagirilari (CONFIRM, GUARD, RECORD_READY mesajlari) Gemini'nin ses akisi ortasinda gelince interrupt etkisi yaratiyor. Gemini kendi konusmasini keserek yeni text input'a yanit vermeye calisiyor.
**Cozum:** `_delaySendTextToLive()` metodu eklendi. Tum VisualTestAgent -> Gemini mesajlari 1200ms gecikmeyle gonderilerek ajanin mevcut konusmasini bitirmesine olanak taniniyor.

### 2. Test 1 Direkt Baslama
**Belirti:** Sayfa yuklenince direkt Test 1'e baslaniyor, kullaniciya aciklama yapilmiyor.
**Kok Neden:** System instruction'daki karsilama kurallari yeterince vurgulu degil, Gemini bunlari atlayip direkt teste geciyordu.
**Cozum:**
- System instruction'daki karsilama bolumu `########## KRITIK KURAL ##########` olarak yeniden yapilandirildi
- 5 adimlik zorunlu karsilama akisi tanimlandi (tanitim > sohbet > test aciklamasi > onay bekleme)
- Initial greeting mesaji guclendirildi, kurallara referans iceriyor

### 3. Test 3 Soru Atlama (1'den 3'e)
**Belirti:** Gorsel tarama testinde soru 1'den direkt soru 3'e atlaniyor, sonra ajan hafiza kaybediyor ve "Merhaba ben Nora" demeye basliyor.
**Kok Neden:** LLM `record_visual_answer`'da yanlis `imageIndex` gonderiyor (ornegin index 2 gonderirken gercekte index 1 aktif). Blocked response'lar biriktikce Gemini'nin context'i bozuluyor ve system instruction'daki karsilama akisina geri donuyor.
**Cozumler:**
- `recordAnswer()`: LLM'in gonderdigi `imageIndex` artik dikkate alinmiyor, her zaman `this.currentImageIndex` kullaniliyor
- Blocked durumda aktif `VISUAL_TEST_BLOCKED` geri bildirimi eklendi (LLM'e "ayni gorselde kal" mesaji)
- BrainAgent `_handleVisualTestActive`: `visualDone` faz gecisi artik VisualTestAgent'in `isTestActive` durumuna bagli. LLM erken gecis sinyali verirse engelleniyor ve guard mesaji gonderiliyor

## Degisiklik Yapilan Dosyalar
- `packages/backend/src/services/visualTestAgent.js`
- `packages/backend/src/services/brainAgent.js`
- `packages/backend/src/services/geminiLive.js`
