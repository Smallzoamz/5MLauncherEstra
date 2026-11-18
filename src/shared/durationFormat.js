export function diffCalendarDuration(fromInput, toInput = Date.now()) {
  const fromMs = typeof fromInput === 'number' ? fromInput : Date.parse(fromInput);
  const toMs = typeof toInput === 'number' ? toInput : Date.parse(toInput);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs <= 0) return null;
  if (toMs <= fromMs) {
    return { years: 0, months: 0, days: 0, hours: 0, minutes: 0, totalSeconds: 0 };
  }

  const start = new Date(fromMs);
  const end = new Date(toMs);
  const totalSeconds = Math.floor((toMs - fromMs) / 1000);

  let minutes = end.getMinutes() - start.getMinutes();
  if (end.getSeconds() < start.getSeconds()) {
    minutes -= 1;
  }

  let hours = end.getHours() - start.getHours();
  if (minutes < 0) {
    minutes += 60;
    hours -= 1;
  }

  let days = end.getDate() - start.getDate();
  if (hours < 0) {
    hours += 24;
    days -= 1;
  }

  let months = end.getMonth() - start.getMonth();
  let years = end.getFullYear() - start.getFullYear();

  let borrowYear = end.getFullYear();
  let borrowMonth = end.getMonth();
  while (days < 0) {
    months -= 1;
    const daysInPrevMonth = new Date(borrowYear, borrowMonth, 0).getDate();
    days += daysInPrevMonth;
    borrowMonth -= 1;
    if (borrowMonth < 0) {
      borrowMonth = 11;
      borrowYear -= 1;
    }
  }

  while (months < 0) {
    months += 12;
    years -= 1;
  }

  return {
    years: Math.max(0, years),
    months: Math.max(0, months),
    days: Math.max(0, days),
    hours: Math.max(0, hours),
    minutes: Math.max(0, minutes),
    totalSeconds
  };
}

export function formatDetailedDurationThai(fromInput, nowInput = Date.now(), options = {}) {
  const diff = diffCalendarDuration(fromInput, nowInput);
  if (!diff) return '';

  const parts = [];
  if (diff.years > 0) parts.push(`${diff.years} ปี`);
  if (diff.months > 0) parts.push(`${diff.months} เดือน`);
  if (diff.days > 0) parts.push(`${diff.days} วัน`);
  if (diff.hours > 0) parts.push(`${diff.hours} ชั่วโมง`);
  if (diff.minutes > 0) parts.push(`${diff.minutes} นาที`);

  if (!parts.length) {
    return options.underMinuteText || 'ไม่ถึง 1 นาที';
  }
  if (options.maxUnits && parts.length > options.maxUnits) {
    return parts.slice(0, options.maxUnits).join(' ');
  }
  return parts.join(' ');
}

export function formatOfflineDurationLabel(lastSeenAt, nowInput = Date.now()) {
  if (!lastSeenAt) return 'ออฟไลน์';
  const duration = formatDetailedDurationThai(lastSeenAt, nowInput, { underMinuteText: 'ไม่ถึง 1 นาที' });
  if (!duration) return 'ออฟไลน์';
  return `ออฟไลน์มาแล้ว ${duration}`;
}

export function formatPlaytimeSteam(totalSecondsInput) {
  const totalSeconds = Math.max(0, Math.floor(Number(totalSecondsInput) || 0));
  if (totalSeconds <= 0) {
    return { short: 'ยังไม่เคยเล่น', full: 'ยังไม่เคยมีบันทึกเวลาเล่น', totalSeconds: 0 };
  }
  if (totalSeconds < 60) {
    return { short: 'น้อยกว่า 1 นาที', full: `${totalSeconds} วินาที`, totalSeconds };
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalSeconds < 3600) {
    return { short: `${totalMinutes} นาที`, full: `${totalMinutes} นาที`, totalSeconds };
  }
  const hoursFloat = totalSeconds / 3600;
  const shortHours = hoursFloat >= 100
    ? Math.round(hoursFloat).toString()
    : Number(hoursFloat.toFixed(1)).toString();
  const wholeHours = Math.floor(totalSeconds / 3600);
  const remMinutes = Math.floor((totalSeconds % 3600) / 60);
  return {
    short: `${shortHours} ชม.`,
    full: remMinutes > 0 ? `${wholeHours} ชั่วโมง ${remMinutes} นาที` : `${wholeHours} ชั่วโมง`,
    totalSeconds
  };
}

export function formatLastPlayedLabel(lastPlayedAt, isPlayingNow = false, nowInput = Date.now()) {
  if (isPlayingNow) return 'กำลังเล่นอยู่ในขณะนี้';
  if (!lastPlayedAt) return 'ยังไม่เคยเข้าเมืองนี้';
  const duration = formatDetailedDurationThai(lastPlayedAt, nowInput, { underMinuteText: '' });
  if (!duration) return 'เล่นล่าสุดเมื่อสักครู่';
  return `เล่นล่าสุด ${duration} ที่แล้ว`;
}
