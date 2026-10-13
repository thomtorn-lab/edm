import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./soundcloudLinks", () => ({
  blockSoundcloudProfile: vi.fn(),
  unblockSoundcloudProfile: vi.fn(),
  describeSoundcloudProfile: vi.fn().mockResolvedValue({ block: null, links: [] }),
}));

const { run, parseArgs } = await import("./soundcloudLinkBlock");
const { blockSoundcloudProfile, unblockSoundcloudProfile, describeSoundcloudProfile } = await import("./soundcloudLinks");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("soundcloudLinkBlock run()", () => {
  it("parses --key=value pairs", () => {
    expect(parseArgs(["--mode=block", "--url=https://soundcloud.com/a?b=c", "--reason=x=y"])).toEqual({
      mode: "block",
      url: "https://soundcloud.com/a?b=c",
      reason: "x=y",
    });
  });

  it("plan is read-only", async () => {
    await run({ mode: "plan", url: "https://soundcloud.com/guy-j" });
    expect(describeSoundcloudProfile).toHaveBeenCalledWith("https://soundcloud.com/guy-j");
    expect(blockSoundcloudProfile).not.toHaveBeenCalled();
    expect(unblockSoundcloudProfile).not.toHaveBeenCalled();
  });

  it("normalizes the URL the same way stored links are normalized", async () => {
    await run({ mode: "block", url: "https://www.soundcloud.com/Guy-J/?si=1", reason: " wrong artist ", confirm: "BLOCK-SOUNDCLOUD-LINK" });
    expect(blockSoundcloudProfile).toHaveBeenCalledWith("https://soundcloud.com/guy-j", "wrong artist");
  });

  it("rejects anything that isn't a profile URL", async () => {
    await expect(run({ mode: "plan", url: "https://soundcloud.com/guy-j/a-track" })).rejects.toThrow(/not a SoundCloud profile URL/);
    await expect(run({ mode: "plan" })).rejects.toThrow(/--url/);
  });

  it("block and unblock each need their own confirm token", async () => {
    await expect(run({ mode: "block", url: "https://soundcloud.com/x" })).rejects.toThrow(/BLOCK-SOUNDCLOUD-LINK/);
    await expect(run({ mode: "unblock", url: "https://soundcloud.com/x", confirm: "BLOCK-SOUNDCLOUD-LINK" })).rejects.toThrow(/UNBLOCK-SOUNDCLOUD-LINK/);
    expect(blockSoundcloudProfile).not.toHaveBeenCalled();
    expect(unblockSoundcloudProfile).not.toHaveBeenCalled();
  });

  it("unblock removes the block and prints the state before and after", async () => {
    await run({ mode: "unblock", url: "https://soundcloud.com/x", confirm: "UNBLOCK-SOUNDCLOUD-LINK" });
    expect(unblockSoundcloudProfile).toHaveBeenCalledWith("https://soundcloud.com/x");
    expect(describeSoundcloudProfile).toHaveBeenCalledTimes(2);
  });

  it("an unknown mode throws instead of silently doing nothing", async () => {
    await expect(run({ mode: "delete", url: "https://soundcloud.com/x" })).rejects.toThrow(/--mode/);
  });
});
