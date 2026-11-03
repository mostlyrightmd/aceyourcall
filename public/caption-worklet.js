class CaptionPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(1600);
    this.used = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.energy = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let v = 0;
      for (const c of channels) v += c[i] || 0;
      v /= channels.length;
      this.sum += v;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const x = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        this.energy += x * x;
        this.frame[this.used++] = Math.max(
          -32768,
          Math.min(32767, Math.round(x * 32767)),
        );
        if (this.used === 1600) {
          this.port.postMessage(
            {
              pcm: this.frame.buffer,
              rms: Math.sqrt(this.energy / 1600),
              endMs: ((currentFrame + i + 1) / sampleRate) * 1000,
            },
            [this.frame.buffer],
          );
          this.frame = new Int16Array(1600);
          this.used = 0;
          this.energy = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("caption-pcm", CaptionPCM);
