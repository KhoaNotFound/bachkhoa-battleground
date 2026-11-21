import { escapeHtml } from './util.js';

// Global chat. "/" opens the input, Enter sends, Esc cancels.
// Anti-spam on three levels: the sender's own bucket (with feedback), a per-sender bucket on every
// receiver (drops messages from modified clients / the public MQTT relay), and the relay server.

export const CHAT_MAX = 120;

// token bucket: `cap` messages at once, refilled one every `every` ms, at least `gap` ms apart
export class RateLimit {
  constructor(cap, every, gap) { this.cap = cap; this.every = every; this.gap = gap; this.tokens = cap; this.t = 0; this.last = -1e9; }
  wait(now = performance.now()) {
    this.tokens = Math.min(this.cap, this.tokens + (now - this.t) / this.every);
    this.t = now;
    const a = this.tokens >= 1 ? 0 : (1 - this.tokens) * this.every;
    return Math.max(a, this.last + this.gap - now, 0);  // ms until a message is allowed
  }
  take(now = performance.now()) {
    if (this.wait(now) > 0) return false;
    this.tokens -= 1; this.last = now;
    return true;
  }
}

export function cleanChat(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

export class Chat {
  constructor({ onSend, onCommand, onOpenChange }) {
    this.onSend = onSend;
    this.onCommand = onCommand || null;
    this.onOpenChange = onOpenChange || (() => {});
    this.mine = new RateLimit(3, 2500, 900);
    this.lastText = ''; this.lastTextAt = 0;
    this.open = false;
    const el = (this.el = document.createElement('div'));
    el.id = 'chat';
    el.innerHTML = `<ul class="chat-log"></ul><div class="chat-input hidden"><span>Tất cả</span><input maxlength="${CHAT_MAX}" placeholder="Nhập tin nhắn hoặc lệnh (/time set day, /help)… Enter để gửi" autocomplete="off"></div>`;
    document.body.appendChild(el);
    this.log = el.querySelector('.chat-log');
    this.box = el.querySelector('.chat-input');
    this.input = el.querySelector('input');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    this.input.addEventListener('blur', () => { if (this.open) setTimeout(() => this.close(), 0); });
  }
  setVisible(v) { this.el.classList.toggle('hidden', !v); if (!v) this.close(); }
  toggleOpen(prefill = '') {
    if (this.open) return;
    this.open = true;
    this.el.classList.add('open');
    this.box.classList.remove('hidden');
    this.input.value = prefill;
    this.input.focus();
    if (prefill) {
      const len = prefill.length;
      try { this.input.setSelectionRange(len, len); } catch {}
    }
    this.onOpenChange(true);
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('open');
    this.box.classList.add('hidden');
    this.input.blur();
    this.onOpenChange(false);
  }
  clear() {
    this.log.innerHTML = '';
  }
  submit() {
    const text = cleanChat(this.input.value);
    if (!text) { this.close(); return; }
    if (this.onCommand) {
      const normalized = /^time\s+set\b/i.test(text) ? '/' + text : text;
      if (normalized.startsWith('/') && this.onCommand(normalized)) {
        this.close();
        return;
      }
    }
    const now = performance.now();
    if (text === this.lastText && now - this.lastTextAt < 8000) { this.system('Đừng gửi lặp lại cùng một tin nhắn.'); return; }
    const w = this.mine.wait(now);
    if (w > 0) { this.system(`Bạn chat quá nhanh, chờ ${Math.ceil(w / 1000)} giây.`); return; }
    this.mine.take(now);
    this.lastText = text; this.lastTextAt = now;
    this.onSend(text);
    this.close();
  }
  add(name, color, text, self = false) {
    const li = document.createElement('li');
    li.innerHTML = `<b style="color:${color}">${escapeHtml(name)}${self ? ' (bạn)' : ''}:</b> ${escapeHtml(text)}`;
    this.push(li);
  }
  system(text) {
    const li = document.createElement('li');
    li.className = 'sys';
    li.textContent = text;
    this.push(li);
  }
  push(li) {
    this.log.appendChild(li);
    while (this.log.children.length > 40) this.log.firstChild.remove();
    // fade out after a while unless the chat is open (CSS shows everything while open)
    setTimeout(() => li.classList.add('old'), 10000);
    this.log.scrollTop = this.log.scrollHeight;
  }
}
