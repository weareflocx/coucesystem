import type { ImageField } from "./types";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FIELD_EDGE = 640;

export async function decodeImageField(file: File): Promise<ImageField> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selecciona un archivo de imagen válido.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("La imagen supera el límite de 20 MB.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("El navegador no ha podido leer esta imagen.");
  }

  try {
    if (bitmap.width < 2 || bitmap.height < 2) {
      throw new Error("La imagen es demasiado pequeña.");
    }

    const scale = Math.min(1, MAX_FIELD_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(2, Math.round(bitmap.width * scale));
    const height = Math.max(2, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true
    });
    if (!context) throw new Error("No se pudo preparar la imagen.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const luminance = new Uint8ClampedArray(width * height);

    for (let pixel = 0, channel = 0; pixel < luminance.length; pixel += 1, channel += 4) {
      luminance[pixel] = Math.round(
        rgba[channel]! * 0.2126 +
        rgba[channel + 1]! * 0.7152 +
        rgba[channel + 2]! * 0.0722
      );
    }

    return { width, height, luminance };
  } finally {
    bitmap.close();
  }
}
