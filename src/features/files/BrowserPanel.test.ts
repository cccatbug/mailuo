import { describe, expect, it } from "vitest";
import { shouldLoadBrowserAddress } from "./browser-navigation";

describe("browser navigation ownership", () => {
  it("does not write a committed CAS callback URL back into webview src", () => {
    expect(
      shouldLoadBrowserAddress(
        "https://app.example.com/protected?ticket=ST-1",
        "https://app.example.com/protected?ticket=ST-1",
        "https://app.example.com/"
      )
    ).toBe(false);
  });

  it("does not reload when the requested URL is already declared", () => {
    expect(
      shouldLoadBrowserAddress(
        "https://app.example.com/",
        "about:blank",
        "https://app.example.com/"
      )
    ).toBe(false);
  });

  it("loads a genuinely user-requested address", () => {
    expect(
      shouldLoadBrowserAddress(
        "https://docs.example.com/",
        "https://app.example.com/",
        "https://app.example.com/"
      )
    ).toBe(true);
  });
});
