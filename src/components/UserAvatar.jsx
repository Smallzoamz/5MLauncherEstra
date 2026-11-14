import { useEffect, useState } from 'react';
import { validateAvatarUrl } from '../shared/profileAvatar.js';

export function UserAvatar({
  user,
  className = 'friend-avatar',
  fallbackColor = '#2b6bf3',
  fallbackInitials = 'ES',
  showPresence = false,
  presenceOverride = '',
  children = null
}) {
  const checked = validateAvatarUrl(user?.avatarUrl);
  const src = checked.valid ? checked.value : '';
  const [failedSrc, setFailedSrc] = useState('');

  useEffect(() => {
    setFailedSrc('');
  }, [src]);

  const showImg = !!src && failedSrc !== src;
  const initials = (user?.displayName || user?.username || fallbackInitials).slice(0, 2).toUpperCase();
  const bg = user?.avatarColor || fallbackColor;
  const presence = presenceOverride || user?.presence || 'offline';

  return (
    <span className={`user-avatar-shell ${className}`} style={{ background: bg }}>
      {showImg ? (
        <img
          src={src}
          alt={user?.displayName || 'รูปโปรไฟล์'}
          className="user-avatar-img"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="user-avatar-initials">{initials}</span>
      )}
      {showPresence && <span className={`presence-dot ${presence}`} />}
      {children}
    </span>
  );
}
