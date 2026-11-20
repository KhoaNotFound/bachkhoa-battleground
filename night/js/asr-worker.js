// Web Worker: ASR (giọng -> chữ) và embedding (chữ -> vector), vai trò "ai-service" của spec (mục 4)
// nhưng chạy ngay trong trình duyệt bằng transformers.js nên không cần server.
// Mô hình tải từ Hugging Face lần đầu rồi được trình duyệt cache.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';

env.allowLocalModels = false;
let asr = null, emb = null, info = {};
const queue = [];
let busy = false;

async function load(whisper) {
  const progress = (p) => { if (p.status === 'progress' && p.total) postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); };
  let device = 'wasm';
  if (self.navigator && navigator.gpu) {
    try { const a = await navigator.gpu.requestAdapter(); if (a) device = 'webgpu'; } catch {}
  }
  // WebGPU: whisper-small như spec; CPU (WASM): whisper-base để không quá chậm
  const size = device === 'webgpu' ? whisper : (whisper === 'small' ? 'base' : whisper);
  try {
    asr = await pipeline('automatic-speech-recognition', `onnx-community/whisper-${size}`, {
      device, dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8', progress_callback: progress,
    });
  } catch (e) {
    if (device === 'webgpu') {
      device = 'wasm';
      asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', { device: 'wasm', dtype: 'q8', progress_callback: progress });
    } else throw e;
  }
  emb = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', { device: 'wasm', dtype: 'q8', progress_callback: progress });
  info = { device, model: `whisper-${device === 'webgpu' ? size : (size === 'small' ? 'base' : size)}` };
}
async function embed(text) {
  const out = await emb(text || ' ', { pooling: 'mean', normalize: true });
  return Array.from(out.data, (v) => Math.round(v * 1000) / 1000);
}
async function run(job) {
  if (job.type === 'load') {
    try { await load(job.whisper || 'small'); postMessage({ type: 'ready', ...info }); }
    catch (e) { postMessage({ type: 'error', error: String(e && e.message || e) }); }
    return;
  }
  if (!asr || !emb) { postMessage({ type: 'result', id: job.id, text: job.text ?? '', emb: null, error: 'not loaded' }); return; }
  try {
    const t0 = performance.now();
    let text = job.text;
    if (job.type === 'asr') {
      const r = await asr(job.audio, { language: 'vietnamese', task: 'transcribe', chunk_length_s: 30 });
      text = (r.text || '').trim();
      // whisper hay "ảo giác" khi gặp tiếng ồn: bỏ các câu rác thường gặp
      if (/^(\[.*\]|\(.*\)|\*.*\*|♪.*|subscribe.*|hãy subscribe.*|cảm ơn các bạn đã theo dõi.*)$/i.test(text)) text = '';
    }
    const e = text ? await embed(text) : null;
    postMessage({ type: 'result', id: job.id, text, emb: e, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    postMessage({ type: 'result', id: job.id, text: '', emb: null, error: String(e && e.message || e) });
  }
}
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) await run(queue.shift());
  busy = false;
}
onmessage = (e) => { queue.push(e.data); pump(); };
