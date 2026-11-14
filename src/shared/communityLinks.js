export const DEFAULT_COMMUNITY_LINKS = {
  websiteUrl: 'https://estralauncher.vercel.app/',
  discordUrl: 'https://discord.gg/WYjfK6FWgB',
  facebookUrl: 'https://www.facebook.com/estralauncher'
};

export const COMMUNITY_CHANNELS = [
  {
    key: 'websiteUrl',
    id: 'website',
    label: 'Website',
    thaiLabel: 'เว็บไซต์',
    placeholder: 'https://estralauncher.vercel.app'
  },
  {
    key: 'discordUrl',
    id: 'discord',
    label: 'Discord',
    thaiLabel: 'Discord Server',
    placeholder: 'https://discord.gg/WYjfK6FWgB'
  },
  {
    key: 'facebookUrl',
    id: 'facebook',
    label: 'Facebook',
    thaiLabel: 'Facebook Page',
    placeholder: 'https://www.facebook.com/estralauncher'
  }
];

export function sanitizeExternalUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 500 || value.startsWith('//') || /[\s\u0000-\u001F\u007F]/.test(value)) {
    return '';
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withScheme);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return '';
    }
    if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function resolveCommunityLinks(settings = {}) {
  return {
    websiteUrl: sanitizeExternalUrl(settings.websiteUrl || DEFAULT_COMMUNITY_LINKS.websiteUrl),
    discordUrl: sanitizeExternalUrl(settings.discordUrl || DEFAULT_COMMUNITY_LINKS.discordUrl),
    facebookUrl: sanitizeExternalUrl(settings.facebookUrl || DEFAULT_COMMUNITY_LINKS.facebookUrl)
  };
}
