// Ý định của câu (newmod.md 8.3) và hàm điểm chọn clip (8.4). Hàm thuần, host.js gọi.

const strip = (s) => s.toLowerCase().normalize('NFC').replace(/[.,!?…;:"'()\-]/g, ' ').replace(/\s+/g, ' ').trim();
const has = (t, kw) => (' ' + t + ' ').includes(' ' + kw + ' ');

const RULES = [
  ['ask_progress', ['tới đâu', 'xong chưa', 'làm được gì', 'sao rồi']],
  ['report_progress', ['xong rồi', 'xong', 'gần xong', 'đang làm']],
  ['call', ['qua đây', 'lại đây', 'ê', 'giúp', 'phụ']],
];
const QUESTION_END = ['không', 'chưa', 'gì', 'đâu', 'sao', 'hả'];

export function intentOf(text) {
  const t = strip(text || '');
  if (!t) return 'other';
  for (const [intent, kws] of RULES) if (kws.some((k) => has(t, k))) return intent;
  const last = t.split(' ').pop();
  if (QUESTION_END.includes(last)) return 'question';
  return 'other';
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}

// clip: {id, speaker, tGame, room, task, nearby[], heardByGhost, text, emb, intent, dodge, lastUsedAt}
// ctx: {q (clip câu hỏi hoặc null), needIntents (khi ma chủ động), ghostRoom, ghostTask, listener, tGame, nowSec}
// Trả về danh sách {clip, S, parts} giảm dần theo S.
export function scoreClips(cfg, clips, ctx) {
  const out = [];
  for (const c of clips) {
    if (ctx.q && c.id === ctx.q.id) continue;     // không lặp lại chính câu vừa được hỏi
    if (!c.dodge && c.text == null) continue;      // chưa có ASR
    if (!c.dodge && !c.text.trim()) continue;
    if (cfg.KNOWLEDGE_RULE && !c.heardByGhost && !c.dodge) continue;
    let sim;
    if (ctx.q) sim = cosine(ctx.q.emb, c.emb);
    else sim = ctx.needIntents.includes(c.intent) ? 1 : 0;
    const ctxScore = ((c.room === ctx.ghostRoom ? 1 : 0) + (c.task && c.task === ctx.ghostTask ? 1 : 0) + (ctx.listener && c.nearby.includes(ctx.listener) ? 1 : 0)) / 3;
    const dt = Math.max(0, ctx.tGame - c.tGame);
    const rec = Math.exp(-dt / cfg.TAU_REC);
    const rep = c.lastUsedAt != null && ctx.nowSec - c.lastUsedAt < cfg.REPEAT_COOLDOWN ? 1 : 0;
    const S = cfg.W_SEM * sim + cfg.W_CTX * ctxScore + cfg.W_REC * rec - cfg.W_REP * rep;
    out.push({ clip: c, S, parts: { sim, ctx: ctxScore, rec, rep } });
  }
  out.sort((a, b) => b.S - a.S);
  return out;
}
