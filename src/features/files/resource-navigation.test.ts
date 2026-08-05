import { describe, expect, it } from "vitest";
import { resourceTarget } from "@/shared/resource-target";

describe("resourceTarget", () => {
  it("recognizes project asset references", () => {
    expect(
      resourceTarget("mailuo-asset:100f3a7b-3366-4a82-b160-107b03f3f92d")
    ).toEqual({
      kind: "asset",
      assetId: "100f3a7b-3366-4a82-b160-107b03f3f92d",
    });
  });

  it("routes HTTP resources to the embedded browser", () => {
    expect(resourceTarget("https://example.com/docs?q=mailuo")).toEqual({
      kind: "browser",
      url: "https://example.com/docs?q=mailuo",
    });
  });

  it("rejects executable and malformed protocols", () => {
    expect(resourceTarget("javascript:alert(1)")).toEqual({
      kind: "unsupported",
    });
    expect(resourceTarget("mailuo-asset:")).toEqual({ kind: "unsupported" });
  });
});
