export type VoiceRecording = {
  stop: () => Promise<File>;
  cancel: () => Promise<void>;
};

function encodeWav(chunks: readonly Float32Array[], sampleRate: number) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const tag = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, sample * (sample < 0 ? 32768 : 32767), true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export async function recordWav(onSilence: () => void): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    await context.resume();
    const audioContext = context;
    const source = audioContext.createMediaStreamSource(stream);
    const node = audioContext.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    const startedAt = performance.now();
    let lastVoiceAt = startedAt;
    let heardVoice = false;
    let stopped = false;
    let silenceTriggered = false;

    node.onaudioprocess = (event) => {
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      const now = performance.now();
      if (rms > 0.018) {
        heardVoice = true;
        lastVoiceAt = now;
      }
      if (!silenceTriggered && ((heardVoice && now - lastVoiceAt > 1100) || now - startedAt > 30000)) {
        silenceTriggered = true;
        queueMicrotask(onSilence);
      }
    };
    source.connect(node);
    node.connect(audioContext.destination);

    async function close() {
      stream.getTracks().forEach((track) => track.stop());
      node.disconnect();
      source.disconnect();
      node.onaudioprocess = null;
      await audioContext.close();
    }

    return {
      async stop() {
        if (stopped) throw new Error("Recording already stopped");
        stopped = true;
        await close();
        const blob = encodeWav(chunks, audioContext.sampleRate);
        if (!heardVoice || blob.size < 2048) throw new Error("I didn't hear anything. Try again.");
        return new File([blob], "voice-prompt.wav", { type: "audio/wav" });
      },
      async cancel() {
        if (stopped) return;
        stopped = true;
        await close();
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context?.close();
    throw error;
  }
}