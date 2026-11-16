// Electron nativeImage.toBitmap() supplies BGRA pixels on Windows.
export function artworkColor(pixels) {
  const bins = new Map();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const rgb = [pixels[i + 2], pixels[i + 1], pixels[i]];
    const key = (rgb[0] >> 5) * 64 + (rgb[1] >> 5) * 8 + (rgb[2] >> 5);
    const bin = bins.get(key) || { count: 0, rgb: [0, 0, 0] };
    bin.count++;
    rgb.forEach((v, n) => {
      bin.rgb[n] += v;
    });
    bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant) return null;
  const rgb = dominant.rgb.map((v) => v / dominant.count);
  // Every channel <= 64 keeps white text above 10:1 contrast.
  const scale = 64 / Math.max(64, ...rgb);
  return `rgb(${rgb.map((v) => Math.round(v * scale)).join(", ")})`;
}
