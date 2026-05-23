let ctx: AudioContext | null = null;

function ensure(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function envelope(ac: AudioContext, gain: GainNode, peak: number, attack: number, decay: number) {
  const t = ac.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export function playBounce(volume = 0.6) {
  const ac = ensure();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.setValueAtTime(180, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, ac.currentTime + 0.12);
  osc.type = "sine";
  osc.connect(gain);
  gain.connect(ac.destination);
  envelope(ac, gain, 0.5 * volume, 0.005, 0.18);
  osc.start();
  osc.stop(ac.currentTime + 0.25);
}

export function playPass() {
  const ac = ensure();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.setValueAtTime(420, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, ac.currentTime + 0.08);
  osc.type = "triangle";
  osc.connect(gain);
  gain.connect(ac.destination);
  envelope(ac, gain, 0.35, 0.005, 0.1);
  osc.start();
  osc.stop(ac.currentTime + 0.15);
}

export function playShot() {
  const ac = ensure();
  const bufSize = ac.sampleRate * 0.22;
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < bufSize; i++) {
    const t = i / bufSize;
    const env = Math.sin(Math.PI * t);
    const n = Math.random() * 2 - 1;
    lp = lp * 0.85 + n * 0.15;
    d[i] = lp * env * 0.5;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const gain = ac.createGain();
  gain.gain.value = 0.5;
  src.connect(gain);
  gain.connect(ac.destination);
  src.start();
}

export function playSwish() {
  const ac = ensure();
  const bufSize = ac.sampleRate * 0.5;
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  let prev = 0;
  for (let i = 0; i < bufSize; i++) {
    const t = i / bufSize;
    const env = Math.pow(Math.sin(Math.PI * t), 1.4);
    const n = Math.random() * 2 - 1;
    lp = lp * 0.65 + n * 0.35;
    const hp = lp - prev;
    prev = lp;
    d[i] = hp * env * 0.7;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const gain = ac.createGain();
  gain.gain.value = 0.8;
  src.connect(gain);
  gain.connect(ac.destination);
  src.start();
}

export function playBuzzer() {
  const ac = ensure();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = 220;
  osc.type = "square";
  osc.connect(gain);
  gain.connect(ac.destination);
  envelope(ac, gain, 0.5, 0.01, 1.5);
  osc.start();
  osc.stop(ac.currentTime + 1.7);
}
