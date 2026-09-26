export type VoiceRecording = {
  stop: () => Promise<File>;
  cancel: () => Promise<void>;
};

export async function recordWav(onSilence: () => void): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const preferredTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
    const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start();

    const samples = new Uint8Array(analyser.fftSize);
    const startedAt = performance.now();
    let lastVoiceAt = startedAt;
    let heardVoice = false;
    let silenceTriggered = false;
    let stopped = false;
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();
      if (rms > 0.018) {
        heardVoice = true;
        lastVoiceAt = now;
      }
      if (!silenceTriggered && ((heardVoice && now - lastVoiceAt > 1100) || now - startedAt > 30000)) {
        silenceTriggered = true;
        window.setTimeout(onSilence, 0);
      }
    }, 120);

    async function closeAudio() {
      window.clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      source.disconnect();
      await context?.close();
    }

    return {
      async stop() {
        if (stopped) throw new Error("Recording already stopped");
        stopped = true;
        const complete = new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
        });
        recorder.stop();
        await complete;
        await closeAudio();
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        if (!heardVoice || blob.size < 512) throw new Error("I didn't hear anything. Try again.");
        const extension = type.includes("mp4") ? "m4a" : "webm";
        return new File([blob], `voice-prompt.${extension}`, { type });
      },
      async cancel() {
        if (stopped) return;
        stopped = true;
        if (recorder.state !== "inactive") recorder.stop();
        await closeAudio();
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context?.close();
    throw error;
  }
}