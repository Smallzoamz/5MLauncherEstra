export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function formatThaiDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function cleanSha(raw) {
  return String(raw || '').replace(/^sha256:/i, '').trim().toLowerCase();
}

function normalizeTelemetryPayload(data) {
  const latest = data?.latest || {};
  const releases = Array.isArray(data?.releases) ? data.releases : [];
  return {
    source: 'estra-telemetry',
    users: {
      total: Number(data?.users?.total ?? 0),
      online: Number(data?.users?.online ?? 0),
      inGame: Number(data?.users?.inGame ?? 0),
      active24h: Number(data?.users?.active24h ?? 0),
    },
    downloads: {
      total: Number(data?.downloads?.total ?? 0),
      githubVerified: Number(data?.downloads?.githubVerified ?? 0),
      webDirect: Number(data?.downloads?.webDirect ?? 0),
    },
    latest: {
      version: String(latest.version || '2.1.7'),
      tag: String(latest.tag || `v${latest.version || '2.1.7'}`),
      name: String(latest.name || `Estra FiveM Launcher ${latest.tag || ''}`.trim()),
      publishedAt: String(latest.publishedAt || ''),
      notes: String(latest.notes || '').trim(),
      assetName: String(latest.assetName || ''),
      size: Number(latest.size || 0),
      sha256: cleanSha(latest.sha256),
    },
    releases: releases.map(r => ({
      tag: String(r.tag || ''),
      version: String(r.version || String(r.tag || '').replace(/^v/i, '')),
      publishedAt: String(r.publishedAt || ''),
      notes: String(r.notes || '').trim(),
      assetName: String(r.assetName || ''),
      size: Number(r.size || 0),
      sha256: cleanSha(r.sha256),
      downloads: Number(r.downloads || 0),
    })),
    syncedAt: String(data?.syncedAt || new Date().toISOString()),
  };
}

async function fetchGitHubFallback(githubRepo, fetchImpl) {
  const res = await fetchImpl(`https://api.github.com/repos/${githubRepo}/releases?per_page=10`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Estra-Discord-Bot/1.0',
    },
    signal: AbortSignal.timeout(7500),
  });
  if (!res.ok) {
    throw new Error(`GitHub fallback failed (HTTP ${res.status})`);
  }
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('ไม่พบ Release บน GitHub');
  }

  let totalDownloads = 0;
  const releases = [];
  for (const rel of raw) {
    if (rel?.draft || rel?.prerelease) continue;
    const exe = (rel.assets || []).find(
      a => typeof a?.name === 'string' && a.name.toLowerCase().endsWith('.exe'),
    );
    if (!exe) continue;
    const dl = Math.max(0, Number(exe.download_count || 0));
    totalDownloads += dl;
    const tag = String(rel.tag_name || '').trim();
    releases.push({
      tag,
      version: tag.replace(/^v/i, ''),
      name: String(rel.name || `Estra FiveM Launcher ${tag}`),
      publishedAt: String(rel.published_at || ''),
      notes: String(rel.body || '').trim(),
      assetName: String(exe.name || ''),
      size: Number(exe.size || 0),
      sha256: cleanSha(exe.digest),
      downloads: dl,
    });
  }

  if (releases.length === 0) {
    throw new Error('ไม่พบไฟล์ติดตั้ง .exe ใน GitHub Releases');
  }

  const latest = releases[0];
  return {
    source: 'github-fallback',
    users: { total: 0, online: 0, inGame: 0, active24h: 0 },
    downloads: { total: totalDownloads, githubVerified: totalDownloads, webDirect: 0 },
    latest,
    releases: [...releases].reverse(),
    syncedAt: new Date().toISOString(),
  };
}

export async function fetchEstraTelemetry({
  telemetryApiUrl,
  githubRepo = 'Smallzoamz/5MLauncherEstra',
  fetchImpl = fetch,
} = {}) {
  const sep = telemetryApiUrl.includes('?') ? '&' : '?';
  try {
    const res = await fetchImpl(`${telemetryApiUrl}${sep}fresh=1`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Estra-Discord-Bot/1.0' },
      signal: AbortSignal.timeout(7500),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.success && json?.latest?.version) {
        return normalizeTelemetryPayload(json);
      }
    }
  } catch {
    // Fall through to GitHub Releases fallback
  }

  return fetchGitHubFallback(githubRepo, fetchImpl);
}

export function verifyReleaseSha256(hashInput, telemetry, versionFilter = '') {
  const cleaned = cleanSha(hashInput);
  if (!/^[a-f0-9]{64}$/.test(cleaned)) {
    return {
      validFormat: false,
      matched: false,
      cleanedHash: cleaned,
      reason: 'รูปแบบค่า SHA-256 ไม่ถูกต้อง (ต้องเป็นตัวอักษรฐานสิบหก 64 หลัก)',
    };
  }

  const normalizedVersion = String(versionFilter || '').trim().replace(/^v/i, '');
  const pool = [...(telemetry?.releases || [])];
  if (telemetry?.latest?.sha256 && !pool.some(r => r.tag === telemetry.latest.tag)) {
    pool.push(telemetry.latest);
  }

  const matchedRelease = pool.find(r => cleanSha(r.sha256) === cleaned) || null;
  if (!matchedRelease) {
    return {
      validFormat: true,
      matched: false,
      cleanedHash: cleaned,
      matchedRelease: null,
      versionMatch: false,
    };
  }

  const versionMatch = !normalizedVersion
    || matchedRelease.version.toLowerCase() === normalizedVersion.toLowerCase();

  return {
    validFormat: true,
    matched: true,
    cleanedHash: cleaned,
    matchedRelease,
    isLatest: matchedRelease.tag === telemetry?.latest?.tag || matchedRelease.version === telemetry?.latest?.version,
    versionMatch,
    requestedVersion: normalizedVersion || null,
  };
}
