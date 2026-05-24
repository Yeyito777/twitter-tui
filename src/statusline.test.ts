import { describe, expect, test } from "bun:test";
import { createInitialState } from "./state";
import { accountBlock } from "./statusblocks/account";
import { followersBlock } from "./statusblocks/followers";
import { theme } from "./theme";

describe("twitter status blocks", () => {
  test("copy record startup behavior: unauthenticated/loading account is red N/A", () => {
    const state = createInitialState();
    state.accountStatus = "loading";
    state.account = null;

    const account = accountBlock(state).rows[0];
    const followers = followersBlock(state).rows[0];

    expect(account).toContain("Logged In As:");
    expect(account).toContain(`${theme.error}N/A`);
    expect(followers).toContain(`${theme.error}N/A`);
  });

  test("authenticated account values are accent-colored", () => {
    const state = createInitialState();
    state.accountStatus = "authenticated";
    state.account = { id: "1", name: "Yeyito", handle: "yeyito", followers: 26 };

    expect(accountBlock(state).rows[0]).toContain(`${theme.accent}Yeyito`);
    expect(followersBlock(state).rows[0]).toContain(`${theme.accent}26`);
  });
});
