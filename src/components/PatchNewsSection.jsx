import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, PackageCheck, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { APP_VERSION, formatBytes } from '../shared/patcherConfig';
import { SUPABASE_URL } from '../shared/supabaseConfig';

const TELEMETRY_STATS_URL = `${SUPABASE_URL}/functions/v1/website-telemetry/stats`;
const NEWS_CACHE_KEY = 'estra_launcher_news_cache_v1';

function loadCachedNews() {
  try {
    const raw = localStorage.getItem(NEWS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function formatThaiDate(iso) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'ล่าสุด';
  return new Date(ts).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export default function PatchNewsSection({ launcherUpdate, onOpenPatcher }) {
  const [feed, setFeed] = useState(() => loadCachedNews());
  const [loading, setLoading] = useState(() => !loadCachedNews());
  const [error, setError] = useState('');

  const loadFeed = useCallback(async (signal) => {
    setLoading(true);
    try {
      const res = await fetch(TELEMETRY_STATS_URL, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.success) throw new Error('ไม่สามารถอ่านข้อมูลข่าวสารได้');
      const snapshot = {
        users: data.users || null,
        latest: data.latest || null,
        releases: Array.isArray(data.releases) ? [...data.releases].reverse() : [],
        syncedAt: data.syncedAt || new Date().toISOString()
      };
      setFeed(snapshot);
      setError('');
      try {
        localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(snapshot));
      } catch {}
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError('โหลดข่าวสารออนไลน์ไม่สำเร็จ — แสดงข้อมูลล่าสุดที่บันทึกไว้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadFeed(controller.signal);
    return () => controller.abort();
  }, [loadFeed]);

  const releases = feed?.releases || [];
  const onlineUsers = feed?.users?.online;
  const totalUsers = feed?.users?.total;

  return (
    <section className="subtab-panel news-hub-panel" aria-label="แพตช์และข่าวสาร Estra">
      <div className="subtab-banner">
        <div>
          <span className="eyebrow">PATCH NOTES &amp; ANNOUNCEMENTS</span>
          <h2>ข่าวสาร &amp; บันทึกอัปเดต Estra</h2>
          <p>
            ติดตามบันทึกการเปลี่ยนแปลงของ Estra Launcher เวอร์ชันล่าสุด ฟีเจอร์ใหม่ และการปรับปรุงความปลอดภัย
          </p>
        </div>
        <div className="news-banner-actions">
          <button
            type="button"
            className="btn-action-refresh"
            disabled={loading}
            onClick={() => void loadFeed()}
          >
            <RefreshCw size={14} className={loading ? 'spinning' : ''} /> รีเฟรชข่าวสาร
          </button>
          <button type="button" className="btn-action-play" onClick={onOpenPatcher}>
            <PackageCheck size={15} /> ศูนย์อัปเดต
          </button>
        </div>
      </div>

      {launcherUpdate?.available && (
        <div className="subtab-update-card">
          <div>
            <span className="eyebrow">LAUNCHER UPDATE READY</span>
            <strong>Estra Launcher v{launcherUpdate.version} พร้อมให้ติดตั้งแล้ว</strong>
            {launcherUpdate.notes && <pre className="subtab-notes">{launcherUpdate.notes}</pre>}
          </div>
          <button type="button" className="btn-inline-cobalt" onClick={onOpenPatcher}>
            ติดตั้งอัปเดต
          </button>
        </div>
      )}

      <div className="news-highlights-grid" aria-label="ไฮไลต์และประกาศ">
        <article className="news-highlight-card">
          <div className="news-highlight-icon cobalt">
            <Sparkles size={16} />
          </div>
          <div>
            <span className="eyebrow">INSTALLED BUILD</span>
            <strong>Estra Launcher v{APP_VERSION}</strong>
            <p>ตรวจสอบอัปเดตอัตโนมัติพร้อมยืนยันลายเซ็นความปลอดภัยก่อนติดตั้งทุกครั้ง</p>
          </div>
        </article>

        <article className="news-highlight-card">
          <div className="news-highlight-icon sky">
            <Users size={16} />
          </div>
          <div>
            <span className="eyebrow">ESTRA NETWORK</span>
            <strong>
              {Number.isFinite(onlineUsers) ? `ออนไลน์ขณะนี้ ${onlineUsers} คน` : 'ซิงก์สถานะออนไลน์เรียลไทม์'}
            </strong>
            <p>
              {Number.isFinite(totalUsers)
                ? `ผู้ใช้งานระบบบัญชี Estra สะสม ${totalUsers.toLocaleString('th-TH')} บัญชี`
                : 'ระบบเพื่อน แชท และคำชวนเข้าเมืองเชื่อมต่อแบบเรียลไทม์'}
            </p>
          </div>
        </article>

        <article className="news-highlight-card">
          <div className="news-highlight-icon green">
            <ShieldCheck size={16} />
          </div>
          <div>
            <span className="eyebrow">SECURITY NOTICE</span>
            <strong>ดาวน์โหลดเฉพาะช่องทางทางการ</strong>
            <p>ตรวจสอบ SHA-256 และสถานะไฟล์ติดตั้งทุกเวอร์ชันได้ที่ Changelog ด้านล่างและเว็บไซต์ทางการ</p>
          </div>
        </article>
      </div>

      <div className="news-changelog-section">
        <div className="news-section-heading">
          <span className="eyebrow">RELEASE CHANGELOG</span>
          <span>ประวัติการอัปเดตทั้งหมด ({releases.length})</span>
        </div>

        {error && <p className="news-sync-note">{error}</p>}

        {loading && releases.length === 0 ? (
          <div className="news-empty-card">กำลังโหลดบันทึกอัปเดตจาก Estra...</div>
        ) : releases.length === 0 ? (
          <div className="news-empty-card">
            <BellRing size={18} />
            <span>ยังไม่มีบันทึกอัปเดตที่โหลดได้ในขณะนี้ กด “รีเฟรชข่าวสาร” เพื่อลองใหม่อีกครั้ง</span>
          </div>
        ) : (
          <div className="news-release-list">
            {releases.map((rel, idx) => {
              const isLatest = idx === 0;
              const isCurrent = rel.version === APP_VERSION;
              return (
                <article
                  key={rel.tag || rel.version || idx}
                  className={`news-release-card${isLatest ? ' latest' : ''}`}
                >
                  <header className="news-release-head">
                    <div className="news-release-title">
                      <span className="news-version-pill">v{rel.version}</span>
                      {isLatest && <span className="news-badge latest">ล่าสุด</span>}
                      {isCurrent && <span className="news-badge current">เวอร์ชันของคุณ</span>}
                      <span className="news-release-date">{formatThaiDate(rel.publishedAt)}</span>
                    </div>
                    <div className="news-release-meta">
                      {rel.size > 0 && <span>{formatBytes(rel.size)}</span>}
                      {rel.sha256 && (
                        <code title={`SHA-256: ${rel.sha256}`}>
                          SHA-256: {rel.sha256.slice(0, 12)}…
                        </code>
                      )}
                    </div>
                  </header>
                  <pre className="news-release-body">
                    {rel.notes?.trim() || 'ปรับปรุงเสถียรภาพ ความปลอดภัย และประสิทธิภาพการทำงานของ Estra Launcher'}
                  </pre>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
