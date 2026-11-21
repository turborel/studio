/**
 * A diagram's SVG made a PNG image (RULES.md D46): drawn on a canvas by
 * the webview, of the SVG as a data URL, which the content security
 * policy allows as an image, and read back as Base64.
 */
import { toBase64 } from "../results/viewers/bytes";

/** The Base64 of the PNG image of `svg`, of `width` by `height` pixels, drawn at `scale`. */
export function pngOf(svg: string, { width, height }: { width: number; height: number }, scale = 2): Promise<string> {
  return new Promise((done, failed) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const context = canvas.getContext("2d");
        if (context === null) {
          throw new Error("The webview draws no canvas.");
        }
        context.scale(scale, scale);
        context.drawImage(image, 0, 0);
        done(canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/u, ""));
      } catch (thrown: unknown) {
        failed(thrown instanceof Error ? thrown : new Error(String(thrown)));
      }
    };
    image.onerror = () => {
      failed(new Error("The diagram could not be drawn as an image: save it as SVG."));
    };
    image.src = `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(svg))}`;
  });
}

/** The size an SVG document declares. */
export function svgSize(svg: string): { width: number; height: number } {
  const width = /width="(\d+)"/u.exec(svg)?.[1];
  const height = /height="(\d+)"/u.exec(svg)?.[1];
  return { width: Number(width ?? 0), height: Number(height ?? 0) };
}
