import type { OutputFormat } from "./types";

export const OUTPUT_FORMATS: OutputFormat[] = [
  { key: "portrait", label: "Vertical editorial", width: 760, height: 1160 },
  { key: "portrait-horizontal", label: "Horizontal editorial", width: 1160, height: 760 },
  { key: "square", label: "Cuadrado", width: 1080, height: 1080 },
  { key: "landscape", label: "Horizontal 16:9", width: 1600, height: 900 },
  { key: "story", label: "Story vertical", width: 1080, height: 1920 },
  { key: "story-horizontal", label: "Story horizontal", width: 1920, height: 1080 },
  { key: "a4", label: "A4 vertical", width: 1240, height: 1754 },
  { key: "a4-horizontal", label: "A4 horizontal", width: 1754, height: 1240 }
];

export function getOutputFormat(key: string): OutputFormat {
  return OUTPUT_FORMATS.find((format) => format.key === key) ?? OUTPUT_FORMATS[0]!;
}
