import { request } from 'node:https';
import type { GenerationConfig, Part } from '@google/generative-ai';

// Phase 5A only. Node fetch stalled sending inline images in the live environment;
// native HTTPS sent the same bytes successfully. No global fetch/Phase 4 changes.
export function categoryContent(parts: Part[], generationConfig: GenerationConfig): Promise<string> {
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig });
  return new Promise((resolve, reject) => {
    const req = request('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY!, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256 * 1024) { req.destroy(new Error('Response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', error => { clearTimeout(timer); reject(error); });
      response.on('end', () => {
        clearTimeout(timer);
        try {
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { data = null; }
          if (response.statusCode !== 200) {
            // Retain only fields consumed by safeError; never keep provider messages.
            reject(Object.assign(new Error('Gemini request failed'), { status: response.statusCode, errorDetails: data?.error?.details }));
            return;
          }
          const candidate = data?.candidates?.[0];
          if (candidate?.finishReason !== 'STOP') { reject(new Error('Incomplete Gemini response')); return; }
          const text = candidate.content?.parts?.filter((part: { text?: string; thought?: boolean }) => typeof part.text === 'string' && !part.thought).map((part: { text: string }) => part.text).join('');
          if (!text) { reject(new Error('Empty Gemini response')); return; }
          resolve(text);
        } catch { reject(new Error('Invalid Gemini response')); }
      });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('Gemini timeout'), { name: 'TimeoutError' })), 35000);
    req.on('error', error => { clearTimeout(timer); reject(error); });
    req.end(body);
  });
}
