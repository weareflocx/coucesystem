import type { OutputFormat } from "./types";

export const OUTPUT_FORMATS: OutputFormat[] = [
  { key: "portrait", label: "Vertical", width: 760, height: 1160 },
  { key: "square", label: "Cuadrado", width: 1080, height: 1080 },
  { key: "landscape", label: "Horizontal", width: 1600, height: 900 },
  { key: "story", label: "Story", width: 1080, height: 1920 },
  { key: "a4", label: "A4", width: 1240, height: 1754 }
];

export function getOutputFormat(key: string): OutputFormat {
  return OUTPUT_FORMATS.find((format) => format.key === key) ?? OUTPUT_FORMATS[0]!;
}
