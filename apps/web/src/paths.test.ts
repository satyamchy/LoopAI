import { describe, expect, test } from "vitest";
import { workspaceSlug } from "./paths";

describe("workspace slug", () => {
  test("uses the username", () => {
    expect(workspaceSlug("satyam")).toBe("satyam_workspace");
  });
});
