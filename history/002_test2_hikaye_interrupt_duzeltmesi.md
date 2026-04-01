# 002 - Test 2 Hikaye Anlatimi Interrupt Duzeltmesi

**Tarih:** 2026-04-01

## Sorun
Test 2'de Nora hikayeyi anlatirken bir anda kesilip farkli bir hikaye anlatmaya basliyor.

## GCP Log Analizi

Kronoloji (session: 59a7bc20):
```
13:32:46 - BrainAgent STORY_RECALL_ACTIVE fazina geciyor, _startStoryRecallWatcher() hemen baslatiliyor
13:32:50 - generate_story tamamlaniyor, hikaye Gemini'ye donuyor
13:33:06 - STORY_RECALL_HINT gonderiyor (storyRecallStartedAt'tan 20sn gecti)
13:33:09 - Gemini hala hikayeyi anlatiyor: "Zehra eski katalog kartlarini duzenlemekle mesguldu"
```

## Kok Neden

`_startStoryRecallWatcher()`, `STORY_RECALL_ACTIVE` fazina girer girmez baslatiliyordu. Ama bu anda:
1. Ajan henuz `generate_story` cagirmadi bile
2. Sonra hikayeyi aliyor ve ~20-30 saniye boyunca anlatmaya basliyor
3. Kullanici dinledigi icin konusmuyor
4. `STORY_RECALL_WARN_MS` (20sn) dolunca `STORY_RECALL_HINT` mesaji gonderiliyor
5. Bu mesaj `sendRealtimeInput({ text: ... })` ile gider ve Gemini'nin hikaye anlatimini **interrupt** eder
6. Gemini kesilince yeni context'te farkli bir hikaye uyduruyor

## Cozum (3 katmanli)

### 1. Watcher'i geciktir
`_handlePostTest1`'da faz gecisi yapilirken watcher artik hemen baslatilmiyor. Bunun yerine, ajanin transkriptinde "hatirladiginiz kadarini anlatin" gibi ifadeler (`KEYWORDS.storyRecallPrompt`) tespit edildiginde baslatiliyor. Bu sayede watcher sadece ajan hikayeyi anlatip kullanicidan cevap beklemeye basladiktan sonra aktif oluyor.

### 2. Ajan konusurken inactivity sayma
`_checkStoryRecallInactivity()` icine `agentRecentlySpoke` kontrolu eklendi. Son 5 saniye icinde ajan transkripti geldiyse (yani ajan hala konusuyorsa), inactivity timer tetiklenmiyor.

### 3. Agent transcript takibi
`onTranscript('agent', ...)` geldiginde `storyRecallLastAgentAt` guncelleniyor. Boylece ajan ne zaman son konustugunu bilebiliyoruz.

### Yeni keyword listesi: `storyRecallPrompt`
Ajanin hikayeyi anlatip kullanicidan cevap istedigini tespit etmek icin keyword'ler eklendi:
- TR: hatirladiginiz, anlatir misiniz, tekrar anlatin, ne hatirliyorsunuz, ...
- EN: can you retell, tell me what you remember, what do you remember, ...

## Degisiklik Yapilan Dosyalar
- `packages/backend/src/services/brainAgent.js`
  - `KEYWORDS.storyRecallPrompt` eklendi
  - `storyRecallLastAgentAt`, `storyRecallAgentDone` state'leri eklendi
  - `onTranscript()`: Ajan STORY_RECALL_ACTIVE fazindayken `storyRecallLastAgentAt` guncelleniyor
  - `_handlePostTest1()`: Watcher hemen baslatilmiyor, `storyRecallPrompt` tespit edildiginde baslatiliyor
  - `_checkStoryRecallInactivity()`: Ajan yakin zamanda konustuysa inactivity tetiklenmiyor
