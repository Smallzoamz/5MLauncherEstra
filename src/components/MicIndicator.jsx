import React, { useEffect, useState } from 'react';
import { Mic, ArrowRight } from 'lucide-react';
import audioService from '../services/audioService';
export default function MicIndicator({ onOpenMicTest }) {
  const [state, setState] = useState({ rms: 0, status: 'idle' });
  useEffect(() => audioService.subscribe(setState), []);
  return <button className="mic-status-widget" onClick={onOpenMicTest} aria-label="เช็คไมค์">
    <span className="mic-icon"><Mic size={23} /></span><span className="mic-widget-text"><strong>เสียงของคุณ พร้อมหรือยัง?</strong><small>{state.rms > 0 ? state.statusText : 'เช็คไมค์และฟังเสียงตัวเอง'}</small></span><ArrowRight size={18} />
  </button>;
}

