import { describe, expect, it } from "vitest";
import { describeError } from "../../../obr/src/errors.ts";

/**
 * Owlbear rejects API calls through `postMessage`, so the value that reaches
 * this page is a structured clone of whatever the Owlbear frame sent: a
 * string or a plain object, not an `Error`. Before this helper, every such
 * rejection was reported as the generic "Token creation failed.", which hid
 * Owlbear's actual validation message.
 */
describe("describeError", () => {
  it("keeps an Error's message", () => {
    expect(describeError(new Error("scene is not ready"), "fallback")).toBe("scene is not ready");
  });

  it("keeps a string rejection, as Owlbear sends for item validation", () => {
    expect(
      describeError('"items[0].image.url" length must be less than or equal to 2048', "fallback"),
    ).toBe('"items[0].image.url" length must be less than or equal to 2048');
  });

  it("unwraps a structured-cloned object", () => {
    expect(describeError({ message: "image url must be https" }, "fallback")).toBe(
      "image url must be https",
    );
    expect(describeError({ error: { message: "nested reason" } }, "fallback")).toBe(
      "nested reason",
    );
    expect(describeError({ code: "BAD_ITEMS", detail: "items[2] is invalid" }, "fallback")).toBe(
      "items[2] is invalid",
    );
  });

  it("falls back to JSON, then to the caller's text", () => {
    expect(describeError({ code: "BAD_ITEMS" }, "fallback")).toBe('{"code":"BAD_ITEMS"}');
    expect(describeError(undefined, "fallback")).toBe("fallback");
    expect(describeError(null, "fallback")).toBe("fallback");
    expect(describeError({}, "fallback")).toBe("fallback");
    expect(describeError("   ", "fallback")).toBe("fallback");
  });
});
