import { apiGet } from './apiService.js';
class PresenceService {
  constructor() { this.presence = { steam: { running: null }, discord: { running: null }, fivem: { running: null } }; this.listeners = new Set(); this.intervalId = null; this.pending = null; this.onFocus = () => this.checkPresence(); }
  subscribe(listener) {
    this.listeners.add(listener); listener(this.presence);
    if (!this.intervalId) { this.checkPresence(); this.intervalId = setInterval(() => this.checkPresence(), 3000); window.addEventListener('focus', this.onFocus); }
    return () => { this.listeners.delete(listener); if (!this.listeners.size) { clearInterval(this.intervalId); this.intervalId = null; window.removeEventListener('focus', this.onFocus); } };
  }
  async checkPresence() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try { this.presence = await apiGet('/api/system-presence'); }
      catch (err) { this.presence = { steam: { running: null, error: err.message }, discord: { running: null, error: err.message }, fivem: { running: null, error: err.message } }; }
      this.listeners.forEach(fn => fn(this.presence)); return this.presence;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  getPresence() { return this.presence; }
}
export default new PresenceService();

