// Audio Diagnostics & Microphone Testing Engine for 5M Launcher
class AudioService {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.analyserNode = null;
    this.gainNode = null; // for loopback monitor
    this.isLoopbackActive = false;
    this.loopbackVolume = 0.35; // safe default to prevent feedback
    this.animationFrameId = null;
    this.callbacks = new Set();
    this.currentDeviceId = 'default';
    this.isPttActive = false;
    this.pttKey = 'KeyN'; // FiveM default voice key (or CapsLock)
    this.isPttMode = false;
    this.noiseFloor = 0.03;
    this.streamGeneration = 0;
  }

  // Check if browser/desktop supports mediaDevices
  isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // Get all microphone input devices
  async getInputDevices() {
    if (!this.isSupported()) return [];
    try {
      // Listing devices must not request microphone permission on page load.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      
      return audioInputs;
    } catch (err) {
      console.error('Failed to enumerate audio devices:', err);
      return [];
    }
  }

  // Start monitoring a microphone
  async startMicStream(deviceId = null) {
    this.stopMicStream();
    const generation = this.streamGeneration;

    if (deviceId) {
      this.currentDeviceId = deviceId;
    }

    try {
      const constraints = {
        audio: this.currentDeviceId && this.currentDeviceId !== 'default'
          ? { deviceId: { exact: this.currentDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      };

      if (!this.isSupported()) throw new Error('เบราว์เซอร์ไม่รองรับไมโครโฟน');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (generation !== this.streamGeneration) { stream.getTracks().forEach(t => t.stop()); return { success: false, error: 'ยกเลิกการเปิดไมค์แล้ว' }; }
      this.mediaStream = stream;

      // Initialize AudioContext
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (generation !== this.streamGeneration) return { success: false, error: 'ยกเลิกแล้ว' };
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.4;

      this.sourceNode.connect(this.analyserNode);

      // Setup loopback monitor node (initially disconnected or 0 gain)
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.isLoopbackActive ? this.loopbackVolume : 0;
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.startMeterLoop();
      return { success: true, stream: this.mediaStream };
    } catch (err) {
      if (generation === this.streamGeneration) this.stopMicStream();
      return { success: false, error: err.message };
    }
  }

  // Toggle Loopback ("ฟังเสียงตัวเอง" / Hear Yourself)
  setLoopback(enable, volume = 0.35) {
    this.isLoopbackActive = enable;
    this.loopbackVolume = volume;
    if (this.gainNode) {
      this.gainNode.gain.value = enable ? volume : 0;
    }
  }

  // Set Loopback volume
  setLoopbackVolume(volume) {
    this.loopbackVolume = volume;
    if (this.gainNode && this.isLoopbackActive) {
      this.gainNode.gain.value = volume;
    }
  }

  // Subscribe callback for live VU updates
  subscribe(callback) {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  // Internal loop to compute RMS volume, peak, and status
  startMeterLoop() {
    if (!this.analyserNode) return;

    const bufferLength = this.analyserNode.fftSize;
    const timeDomainData = new Float32Array(bufferLength);
    const frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);

    let peakVolume = 0;
    let peakDecayTimer = 0;

    const loop = () => {
      if (!this.analyserNode) return;

      this.analyserNode.getFloatTimeDomainData(timeDomainData);
      this.analyserNode.getByteFrequencyData(frequencyData);

      // Calculate RMS (Root Mean Square)
      let sum = 0;
      let instantPeak = 0;
      for (let i = 0; i < bufferLength; i++) {
        const val = timeDomainData[i];
        const absVal = Math.abs(val);
        if (absVal > instantPeak) instantPeak = absVal;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Decibels calculation: 20 * log10(rms)
      const db = rms > 0.0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(rms))) : -60;

      // Peak decay
      if (rms > peakVolume) {
        peakVolume = rms;
        peakDecayTimer = 20;
      } else if (peakDecayTimer > 0) {
        peakDecayTimer--;
      } else {
        peakVolume = Math.max(0, peakVolume - 0.015);
      }

      // Voice Health Classification
      let status = 'idle'; // idle | quiet | optimal | clipping
      let statusText = 'ไม่มีเสียง';
      let statusColor = '#94a3b8'; // grey

      if (instantPeak >= 0.98) {
        status = 'clipping'; statusText = 'สัญญาณอาจ clipping กรุณาลด gain'; statusColor = '#ef4444';
      } else if (rms < 0.005) {
        status = 'idle';
        statusText = 'เงียบ (ไม่มีสัญญาณเสียง)';
        statusColor = '#94a3b8';
      } else if (rms < 0.03) {
        status = 'quiet';
        statusText = 'เสียงเบาเกินไป (อาจต้องเพิ่ม Mic Boost)';
        statusColor = '#f59e0b'; // amber
      } else if (rms <= 0.82) {
        status = 'optimal';
        statusText = 'ระดับสัญญาณเหมาะสม (ค่าประเมินเบื้องต้น)';
        statusColor = '#22c55e'; // green
      } else {
        status = 'clipping';
        statusText = 'เสียงดังเกินไป/เสียงแตก (Clipping)';
        statusColor = '#ef4444'; // red
      }

      // Noise floor evaluation: average frequency energy in low end
      let avgFreq = 0;
      for (let i = 0; i < 30; i++) {
        avgFreq += frequencyData[i];
      }
      avgFreq /= 30;
      const noiseDetected = avgFreq > 40 && rms < 0.05;

      const payload = {
        rms: Math.min(1, rms * 2.2), // scaled for visual meter
        rawRms: rms,
        peak: Math.min(1, peakVolume * 2.2),
        db: Math.round(db),
        status,
        statusText,
        statusColor,
        noiseDetected,
        frequencyData,
        isLoopbackActive: this.isLoopbackActive,
        isPttActive: this.isPttActive
      };

      this.callbacks.forEach(cb => {
        try { cb(payload); } catch (e) { console.error(e); }
      });

      this.animationFrameId = requestAnimationFrame(loop);
    };

    loop();
  }

  // Play a pleasant test chime to verify headphone/speakers
  playTestChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = this.audioContext && this.audioContext.state !== 'closed'
        ? this.audioContext
        : new AudioCtx();

      if (ctx.state === 'suspended') ctx.resume();

      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 arpeggio
      const now = ctx.currentTime;

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        gain.gain.setValueAtTime(0, now + idx * 0.12);
        gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.4);
      });
      if (ctx !== this.audioContext) setTimeout(() => ctx.close().catch(() => {}), 1000);
      return true;
    } catch (err) {
      console.error('Failed to play test sound:', err);
      return false;
    }
  }

  // Stop monitoring and release microphone hardware
  stopMicStream() {
    this.streamGeneration++;
    this.isLoopbackActive = false;
    this.isPttActive = false;
    this.callbacks.forEach(cb => cb({ rms: 0, peak: 0, db: -60, status: 'idle', statusText: 'หยุดทดสอบแล้ว', statusColor: '#94a3b8' }));
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch {}
      this.gainNode = null;
    }
    if (this.analyserNode) {
      try { this.analyserNode.disconnect(); } catch {}
      this.analyserNode = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

export const audioService = new AudioService();
export default audioService;
