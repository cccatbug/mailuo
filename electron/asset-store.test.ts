import { describe, expect, it } from "vitest";
import { inferMime } from "./asset-store";

describe("asset-store", () => {
  it("infers previewable asset MIME types case-insensitively", () => {
    expect(inferMime("diagram.SVG")).toBe("image/svg+xml");
    expect(inferMime("photo.avif")).toBe("image/avif");
    expect(inferMime("legacy.bmp")).toBe("image/bmp");
    expect(inferMime("favicon.ico")).toBe("image/x-icon");
    expect(inferMime("brief.pdf")).toBe("application/pdf");
    expect(inferMime("page.html")).toBe("text/html");
    expect(inferMime("unknown.bin")).toBe("application/octet-stream");
  });
});
