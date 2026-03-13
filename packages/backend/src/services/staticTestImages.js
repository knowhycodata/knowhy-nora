/**
 * Static Test Images - Fallback Görselleri
 * 
 * API kota aşımı veya hata durumunda kullanılacak statik SVG görseller.
 * Test 3 (Görsel Tanıma) için saat, anahtar ve kalem görselleri.
 * Base64 encoded SVG formatında.
 */

// Saat görseli - minimalist analog saat
const CLOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <rect width="400" height="400" fill="#f8f9fa"/>
  <circle cx="200" cy="200" r="150" fill="white" stroke="#333" stroke-width="6"/>
  <circle cx="200" cy="200" r="140" fill="white" stroke="#e0e0e0" stroke-width="1"/>
  <!-- Saat rakamları -->
  <text x="200" y="80" text-anchor="middle" font-family="Arial" font-size="28" font-weight="bold" fill="#333">12</text>
  <text x="320" y="210" text-anchor="middle" font-family="Arial" font-size="28" font-weight="bold" fill="#333">3</text>
  <text x="200" y="340" text-anchor="middle" font-family="Arial" font-size="28" font-weight="bold" fill="#333">6</text>
  <text x="80" y="210" text-anchor="middle" font-family="Arial" font-size="28" font-weight="bold" fill="#333">9</text>
  <!-- Küçük çizgiler -->
  <line x1="200" y1="65" x2="200" y2="75" stroke="#666" stroke-width="2"/>
  <line x1="270" y1="90" x2="265" y2="99" stroke="#666" stroke-width="2"/>
  <line x1="310" y1="130" x2="301" y2="135" stroke="#666" stroke-width="2"/>
  <line x1="335" y1="200" x2="325" y2="200" stroke="#666" stroke-width="2"/>
  <line x1="310" y1="270" x2="301" y2="265" stroke="#666" stroke-width="2"/>
  <line x1="270" y1="310" x2="265" y2="301" stroke="#666" stroke-width="2"/>
  <line x1="200" y1="335" x2="200" y2="325" stroke="#666" stroke-width="2"/>
  <line x1="130" y1="310" x2="135" y2="301" stroke="#666" stroke-width="2"/>
  <line x1="90" y1="270" x2="99" y2="265" stroke="#666" stroke-width="2"/>
  <line x1="65" y1="200" x2="75" y2="200" stroke="#666" stroke-width="2"/>
  <line x1="90" y1="130" x2="99" y2="135" stroke="#666" stroke-width="2"/>
  <line x1="130" y1="90" x2="135" y2="99" stroke="#666" stroke-width="2"/>
  <!-- Akrep (saat 10) -->
  <line x1="200" y1="200" x2="145" y2="120" stroke="#333" stroke-width="6" stroke-linecap="round"/>
  <!-- Yelkovan (dakika 10 = 2) -->
  <line x1="200" y1="200" x2="200" y2="90" stroke="#333" stroke-width="4" stroke-linecap="round"/>
  <!-- Merkez nokta -->
  <circle cx="200" cy="200" r="8" fill="#e74c3c"/>
  <circle cx="200" cy="200" r="3" fill="white"/>
</svg>`;

// Anahtar görseli - klasik metal anahtar
const KEY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <rect width="400" height="400" fill="#f8f9fa"/>
  <g transform="translate(200,200) rotate(-30)">
    <!-- Anahtar gövdesi -->
    <rect x="-10" y="-120" width="20" height="180" rx="4" fill="#b8860b" stroke="#8B6914" stroke-width="2"/>
    <!-- Anahtar dişleri -->
    <rect x="10" y="20" width="25" height="8" rx="2" fill="#b8860b" stroke="#8B6914" stroke-width="1.5"/>
    <rect x="10" y="38" width="18" height="8" rx="2" fill="#b8860b" stroke="#8B6914" stroke-width="1.5"/>
    <rect x="10" y="56" width="22" height="8" rx="2" fill="#b8860b" stroke="#8B6914" stroke-width="1.5"/>
    <!-- Anahtar halkası -->
    <circle cx="0" cy="-140" r="40" fill="none" stroke="#b8860b" stroke-width="12"/>
    <circle cx="0" cy="-140" r="40" fill="none" stroke="#8B6914" stroke-width="2"/>
    <circle cx="0" cy="-140" r="28" fill="#f8f9fa" stroke="#c9a84c" stroke-width="2"/>
    <!-- Parlama efekti -->
    <ellipse cx="-8" cy="-148" rx="8" ry="12" fill="rgba(255,255,255,0.3)"/>
  </g>
</svg>`;

// Kalem görseli - ahşap kurşun kalem
const PENCIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <rect width="400" height="400" fill="#f8f9fa"/>
  <g transform="translate(200,200) rotate(-45)">
    <!-- Kalem gövdesi -->
    <rect x="-15" y="-140" width="30" height="220" fill="#f4c542" stroke="#d4a520" stroke-width="2"/>
    <!-- Kalem üst şerit -->
    <rect x="-15" y="-140" width="30" height="15" fill="#e8b830" stroke="#d4a520" stroke-width="1"/>
    <!-- Metal halka (silgi tutucu) -->
    <rect x="-17" y="-155" width="34" height="20" rx="2" fill="#c0c0c0" stroke="#999" stroke-width="1.5"/>
    <rect x="-17" y="-148" width="34" height="3" fill="#a0a0a0"/>
    <!-- Silgi -->
    <rect x="-14" y="-175" width="28" height="25" rx="8" fill="#e8a0a0" stroke="#d08080" stroke-width="1.5"/>
    <!-- Kalem ucu (ahşap) -->
    <polygon points="-15,80 15,80 0,130" fill="#deb887" stroke="#c4a070" stroke-width="1.5"/>
    <!-- Grafit uç -->
    <polygon points="-4,115 4,115 0,135" fill="#444"/>
    <!-- Kalem yüzey çizgileri -->
    <line x1="-5" y1="-135" x2="-5" y2="78" stroke="#e0b030" stroke-width="0.5"/>
    <line x1="5" y1="-135" x2="5" y2="78" stroke="#e0b030" stroke-width="0.5"/>
  </g>
</svg>`;

// Subject'e göre statik görsel döndür
const STATIC_IMAGES = {
  'saat': { svg: CLOCK_SVG, mimeType: 'image/svg+xml' },
  'anahtar': { svg: KEY_SVG, mimeType: 'image/svg+xml' },
  'kalem': { svg: PENCIL_SVG, mimeType: 'image/svg+xml' },
};

/**
 * Subject için statik fallback görseli döndürür (base64)
 */
function getStaticTestImage(subject) {
  const entry = STATIC_IMAGES[subject.toLowerCase()];
  if (!entry) return null;
  
  const base64 = Buffer.from(entry.svg).toString('base64');
  return {
    data: base64,
    mimeType: entry.mimeType,
  };
}

module.exports = { getStaticTestImage };
