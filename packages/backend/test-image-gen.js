/**
 * Test Script: Imagen 4 Görsel Üretim Doğrulama
 * 
 * Imagen 4 Fast generateImages() API'sini test eder.
 * Çalıştırma: node test-image-gen.js
 */

require('dotenv').config();
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const API_KEY = process.env.GEMINI_IMAGE_API_KEY || process.env.GOOGLE_API_KEY;
const MODEL = process.env.IMAGEN_MODEL || 'imagen-4.0-fast-generate-001';

console.log('=== Imagen 4 Test ===');
console.log(`API Key: ${API_KEY?.substring(0, 12)}...`);
console.log(`Model: ${MODEL}`);
console.log('');

const ai = new GoogleGenAI({ apiKey: API_KEY });

const PROMPTS = [
  { subject: 'saat', prompt: 'A simple analog clock face centered on a pure white background. Minimalist studio photography, soft lighting, no text.' },
  { subject: 'anahtar', prompt: 'A single classic metal key centered on a pure white background. Minimalist studio photography, soft lighting, no text.' },
  { subject: 'kalem', prompt: 'A single wooden pencil centered on a pure white background. Minimalist studio photography, soft lighting, no text.' },
];

async function testImagen(subject, prompt) {
  console.log(`\n--- ${subject} ---`);
  const t0 = Date.now();

  try {
    const response = await ai.models.generateImages({
      model: MODEL,
      prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio: '1:1',
      },
    });

    const elapsed = Date.now() - t0;
    const count = response.generatedImages?.length || 0;
    console.log(`  Response: ${count} images, ${elapsed}ms`);

    if (count > 0 && response.generatedImages[0].image?.imageBytes) {
      const imgBytes = response.generatedImages[0].image.imageBytes;
      const buf = Buffer.from(imgBytes, 'base64');
      const fname = `test-imagen-${subject}.jpg`;
      fs.writeFileSync(fname, buf);
      console.log(`  BASARILI! ${fname} (${buf.length} bytes)`);
      return { subject, success: true, elapsed, fileSize: buf.length };
    }

    console.log('  HATA: Gorsel verisi bos');
    return { subject, success: false, elapsed, error: 'Empty image data' };
  } catch (err) {
    const elapsed = Date.now() - t0;
    const msg = err.message?.substring(0, 200) || 'Unknown';
    console.log(`  HATA: status=${err.status || 'N/A'} ${msg}`);
    return { subject, success: false, elapsed, error: msg.substring(0, 80) };
  }
}

async function main() {
  // Sadece ilk prompt'u test et (hızlı doğrulama)
  const r = await testImagen(PROMPTS[0].subject, PROMPTS[0].prompt);

  if (r.success) {
    console.log(`\n=== BASARILI! Imagen 4 calisiyor. ===`);
    console.log(`Dosya: test-imagen-${r.subject}.jpg (${r.fileSize} bytes)`);
    
    // Opsiyonel: diger promptlari da test et
    const testAll = process.argv.includes('--all');
    if (testAll) {
      for (let i = 1; i < PROMPTS.length; i++) {
        await testImagen(PROMPTS[i].subject, PROMPTS[i].prompt);
      }
    }
    process.exit(0);
  } else {
    console.log('\n=== BASARISIZ! API key veya model kontrol edin. ===');
    process.exit(1);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
