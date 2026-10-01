import { Injectable, Logger } from '@nestjs/common';

export interface NotifyEvent {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  delivered: boolean;
}

/**
 * Telegram alerts. Disabled until TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set; events are always kept in
 * memory so the UI can show recent system messages even without Telegram.
 */
@Injectable()
export class NotifyService {
  private readonly log = new Logger(NotifyService.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  private readonly chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  private readonly recent: NotifyEvent[] = [];

  get enabled() {
    return !!(this.token && this.chatId);
  }

  get events() {
    return [...this.recent].reverse();
  }

  async send(level: NotifyEvent['level'], text: string): Promise<boolean> {
    const icon = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : '🟢';
    let delivered = false;
    if (this.enabled) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: this.chatId, text: `${icon} Vermax\n${text}`, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10_000),
        });
        delivered = res.ok;
        if (!res.ok) this.log.warn(`telegram HTTP ${res.status}`);
      } catch (err) {
        this.log.warn(`telegram send failed: ${(err as Error).message}`);
      }
    }
    this.recent.push({ at: new Date().toISOString(), level, text, delivered });
    if (this.recent.length > 50) this.recent.shift();
    (level === 'error' ? this.log.error.bind(this.log) : this.log.log.bind(this.log))(`[notify:${level}] ${text.split('\n')[0]}`);
    return delivered;
  }
}
