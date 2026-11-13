import React, { useState, useEffect, useRef } from 'react';
import audioService from '../services/audioService';

export default function MicTestModal({ isOpen, onClose, settings, onSaveSettings }) {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(settings.preferredAudioDeviceId || 'default');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isLoopback, setIsLoopback] = useState(false);
  const [loopbackVol, setLoopbackVol] = useState(0.4);
  const [audioData, setAudioData] = useState({
    rms: 0,
    peak: 0,
    db: -60,
    status: 'idle',
    statusText: 'พร้อมเริ่มการทดสอบ',
    statusColor: '#94a3b8',
    noiseDetected: false
  });
  const [pttKey, setPttKey] = useState('KeyN');
  const [isPttPressed, setIsPttPressed] = useState(false);
  const [speakerTestPlaying, setSpeakerTestPlaying] = useState(false);

  const canvasRef = useRef(null);
  const openRef = useRef(isOpen); openRef.current = isOpen;
  const requestRef = useRef(0);
  const [micError, setMicError] = useState('');

  // Load devices on open
  useEffect(() => {
    if (!isOpen) return;

    audioService.getInputDevices().then(devs => {
      setDevices(devs);
    });

    // Auto-start monitoring when opening modal
    setSelectedDeviceId(settings.preferredAudioDeviceId);
    startMonitoring(settings.preferredAudioDeviceId);

    return () => {
      requestRef.current++;
      stopMonitoring();
    };
  }, [isOpen]);

  // Subscribe to audio updates & draw canvas oscilloscope
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = audioService.subscribe((data) => {
      setAudioData(data);

      // Draw frequency / wave visualizer
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      if (data.frequencyData) {
        const freq = data.frequencyData;
        const barWidth = (width / freq.length) * 2.5;
        let x = 0;

        for (let i = 0; i < freq.length; i++) {
          const barHeight = (freq[i] / 255) * height;
          // Gradient from cyan to purple
          ctx.fillStyle = i < 40 ? '#38bdf8' : (i < 80 ? '#818cf8' : '#c084fc');
          ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
          x += barWidth;
          if (x > width) break;
        }
      }
    });

    return () => unsubscribe();
  }, [isOpen]);

  // Handle PTT key listeners
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.code === pttKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
        setIsPttPressed(true);
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === pttKey) {
        setIsPttPressed(false);
      }
    };

    const resetPtt = () => setIsPttPressed(false);
    window.addEventListener('blur', resetPtt);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('blur', resetPtt);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isOpen, pttKey]);

  const startMonitoring = async (deviceId) => {
    const request = ++requestRef.current;
    setMicError(''); setIsLoopback(false); setIsMonitoring(false);
    const res = await audioService.startMicStream(deviceId);
    if (!openRef.current || request !== requestRef.current) return;
    setIsMonitoring(res.success);
    if (res.success) setDevices(await audioService.getInputDevices());
    else setMicError(res.error || 'เปิดไมโครโฟนไม่ได้ กรุณาตรวจสิทธิ์');
  };

  const stopMonitoring = () => {
    audioService.stopMicStream();
    setIsMonitoring(false);
    setIsLoopback(false);
  };

  const handleDeviceChange = (e) => {
    const newId = e.target.value;
    setSelectedDeviceId(newId);
    onSaveSettings({ ...settings, preferredAudioDeviceId: newId });
    startMonitoring(newId);
  };

  const toggleLoopback = () => {
    const nextState = !isLoopback;
    setIsLoopback(nextState);
    audioService.setLoopback(nextState, loopbackVol);
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setLoopbackVol(val);
    audioService.setLoopbackVolume(val);
  };

  const handleSpeakerTest = () => {
    setSpeakerTestPlaying(true);
    audioService.playTestChime();
    setTimeout(() => setSpeakerTestPlaying(false), 800);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="ทดสอบไมโครโฟน" className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="22"></line>
            </svg>
            <span>ระบบตรวจสอบไมโครโฟน & ทดสอบเสียง (Sound Diagnostics)</span>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {micError && <p role="alert" className="error-message">{micError}</p>}
          <p className="help-text">การทดสอบนี้อยู่ใน Launcher เท่านั้น ไม่เปลี่ยนการตั้งค่าเสียงในเกม ใช้หูฟังก่อนเปิดฟังเสียงตัวเอง</p>
          {!isMonitoring && <button className="btn-action-refresh" onClick={() => startMonitoring(selectedDeviceId)}>เริ่มทดสอบไมค์อีกครั้ง</button>}
          {/* Device Selector */}
          <div>
            <label className="field-label" style={{ marginBottom: '6px', display: 'block' }}>
              อุปกรณ์ไมโครโฟน (Audio Input Device)
            </label>
            <div className="input-container">
              <select aria-label="อุปกรณ์ไมโครโฟน" value={selectedDeviceId} onChange={handleDeviceChange}>
                <option value="default">ไมโครโฟนเริ่มต้น (Default System Mic)</option>
                {devices.filter(d => d.deviceId !== 'default').map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `ไมโครโฟนตัวที่ ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Real-Time VU Meter & Frequency Spectrum */}
          <div className="vu-visualizer-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }}>
                ระดับสัญญาณไมค์ (Live Decibel VU-Meter)
              </span>
              <span style={{ fontSize: '12px', fontFamily: 'monospace', color: audioData.statusColor, fontWeight: '700' }}>
                {audioData.db} dB
              </span>
            </div>

            {/* Spectrum Canvas */}
            <canvas ref={canvasRef} className="vu-canvas" width={500} height={60}></canvas>

            {/* Decibel Bar */}
            <div className="vu-decibel-meter">
              <div 
                className="vu-decibel-bar" 
                style={{ 
                  width: `${Math.min(100, Math.max(0, (audioData.db + 60) * (100 / 60)))}%` 
                }}
              />
              <div className="vu-scale-markers">
                <span>-60dB</span>
                <span>-36dB</span>
                <span>-18dB (RP Voice)</span>
                <span>-6dB</span>
                <span>0dB</span>
              </div>
            </div>
          </div>

          {/* Voice Health Evaluation Card */}
          <div className="quality-verdict-card">
            <div 
              className="quality-status-badge"
              style={{ background: `${audioData.statusColor}22`, color: audioData.statusColor, border: `1px solid ${audioData.statusColor}66` }}
            >
              {audioData.status.toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: audioData.statusColor }}>
                {audioData.statusText}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                {audioData.noiseDetected 
                  ? '⚠️ ตรวจพบเสียงซ่า/เสียงจี่รอบข้าง กรุณาเช็คระดับ Noise Gate' 
                  : 'ค่าระดับสัญญาณโดยประมาณ กรุณาฟังเสียงตัวเองเพื่อตรวจคุณภาพ'}
              </div>
            </div>
          </div>

          {/* Loopback Test (ฟังเสียงตัวเอง) */}
          <div style={{ background: '#111827', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>
                  ทดสอบฟังเสียงตัวเอง (Hear Yourself Loopback)
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  สะท้อนเสียงไมค์เข้าหูฟังเพื่อเช็คว่าเสียงชัดเจน มีเสียงแตกหรือช็อตไหม
                </div>
              </div>

              <button
                disabled={!isMonitoring}
                onClick={toggleLoopback}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  border: isLoopback ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                  background: isLoopback ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                  color: isLoopback ? '#38bdf8' : '#94a3b8'
                }}
              >
                {isLoopback ? 'กำลังฟังเสียงตัวเอง (เปิดอยู่)' : 'เปิดฟังเสียงตัวเอง'}
              </button>
            </div>

            {isLoopback && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>ระดับเสียงมอนิเตอร์:</span>
                <input 
                  type="range" 
                  min="0.05" 
                  max="0.9" 
                  step="0.05" 
                  value={loopbackVol}
                  onChange={handleVolumeChange}
                  style={{ flex: 1, accentColor: '#38bdf8' }}
                />
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#38bdf8' }}>
                  {Math.round(loopbackVol * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* Push-to-Talk Simulation & Speaker Test */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* PTT Tester */}
            <div 
              className={`ptt-test-box ${isPttPressed ? 'transmitting' : ''}`}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setIsPttPressed(true); } }}
              onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') setIsPttPressed(false); }}
              onBlur={() => setIsPttPressed(false)}
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setIsPttPressed(true); }}
              onPointerUp={() => setIsPttPressed(false)}
              onPointerCancel={() => setIsPttPressed(false)}
              title="กดค้างที่นี่ หรือกดปุ่ม N บนคีย์บอร์ดเพื่อทดสอบการกดพูด"
            >
              <div style={{ fontWeight: '600', marginBottom: '2px' }}>
                {isPttPressed ? '🎙️ ตรวจพบการกดปุ่ม (PTT ON)' : '🔘 ทดสอบปุ่มกดพูด (Push-To-Talk)'}
              </div>
              <span style={{ fontSize: '11px' }}>
                {isPttPressed ? 'ปุ่ม [ N ] ทำงานปกติ' : 'กดค้างที่นี่ หรือกดคีย์ [ N ]'}
              </span>
            </div>

            {/* Speaker Sound Chime Test */}
            <button
              onClick={handleSpeakerTest}
              style={{
                background: '#152238',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px',
                padding: '12px',
                color: speakerTestPlaying ? '#38bdf8' : '#f1f5f9',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                transition: 'all 0.2s'
              }}
            >
              <span>{speakerTestPlaying ? '🔊 กำลังเล่นเสียงทดสอบ...' : '🎧 ทดสอบเสียงหูฟัง (Chime)'}</span>
              <span style={{ fontSize: '10px', color: '#64748b' }}>ตรวจเช็คว่าหูฟังได้ยินเสียงปกติ</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
