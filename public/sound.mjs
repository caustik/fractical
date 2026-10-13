export class FieldSound {
  constructor() {
    this.enabled = false;
  }
  async toggle() {
    if (!this.context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return false;
      this.context = new Audio();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      const buffer = this.context.createBuffer(
        1,
        this.context.sampleRate * 4,
        this.context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < samples.length; i++) {
        previous = (previous + (Math.random() * 2 - 1) * 0.05) / 1.04;
        samples[i] = previous * 2;
      }
      const noise = this.context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      this.filter = this.context.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 300;
      const gain = this.context.createGain();
      gain.gain.value = 0.15;
      noise.connect(this.filter);
      this.filter.connect(gain);
      gain.connect(this.master);
      noise.start();
    }
    this.enabled = !this.enabled;
    await this.context.resume();
    this.master.gain.setTargetAtTime(
      this.enabled ? 0.3 : 0,
      this.context.currentTime,
      0.7,
    );
    clearInterval(this.notes);
    if (this.enabled) {
      this.chime();
      this.notes = setInterval(() => this.chime(), 6200);
    }
    return this.enabled;
  }
  chime() {
    if (!this.enabled || document.hidden) return;
    const notes = [0, 7, 12, 14, 19, 24],
      note = notes[Math.floor(Math.random() * notes.length)];
    const osc = this.context.createOscillator(),
      gain = this.context.createGain(),
      time = this.context.currentTime;
    osc.type = 'sine';
    osc.frequency.value = 110 * 2 ** (note / 12);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.07, time + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 5);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(time);
    osc.stop(time + 5.1);
  }
  depth(value) {
    if (this.filter)
      this.filter.frequency.setTargetAtTime(
        300 + value * 25,
        this.context.currentTime,
        1,
      );
  }
}
