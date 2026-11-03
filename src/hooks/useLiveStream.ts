import { useEffect, type RefObject } from "react";

// How often to check the player, and to say hello until it answers
const CHECK_MS = 5000;
const LISTEN_MS = 1000;
// A stream whose time hasn't moved for this long is stuck (frozen, or
// buffering forever): jump to live. Still stuck this long: load it again
export const STALL_MS = 15_000;
export const RELOAD_MS = 45_000;
// YouTube player states
const PAUSED = 2;
const CUED = 5;

interface ProgressState {
  current?: number;
  seekableEnd?: number;
  isAtLiveHead?: boolean;
}

interface PlayerInfo {
  playerState?: number;
  currentTime?: number;
  progressState?: ProgressState;
}

/**
 * Keeps a YouTube live stream embed (with `enablejsapi=1`) at the live edge:
 * if it's paused, or has fallen behind (buffering, a background tab, someone
 * scrubbing back), it plays again from live. If its time stops moving
 * (frozen, or buffering that never ends) it jumps to live, and if that
 * doesn't help, loads the embed again. Talks to the player through
 * postMessage, the same protocol YouTube's iframe API script uses, so it
 * needs no script of its own. Does nothing while `src` is null.
 */
export function useLiveStream(
  frameRef: RefObject<HTMLIFrameElement | null>,
  src: string | null,
): void {
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !src) return;
    let info: PlayerInfo = {};
    let ready = false;
    // When the stream's time last moved (or it was last loaded or shown)
    let lastTime: number | undefined;
    let movedAt = Date.now();

    const send = (message: Record<string, unknown>): void => {
      frame.contentWindow?.postMessage(
        JSON.stringify({ ...message, id: 1, channel: "widget" }),
        "*",
      );
    };

    const onMessage = (e: MessageEvent): void => {
      if (e.source !== frame.contentWindow || typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data) as { info?: PlayerInfo };
        ready = true;
        if (data.info?.playerState !== undefined) info.playerState = data.info.playerState;
        if (data.info?.progressState) info.progressState = data.info.progressState;
        const time = data.info?.currentTime ?? data.info?.progressState?.current;
        if (time !== undefined && time !== lastTime) {
          lastTime = time;
          movedAt = Date.now();
        }
      } catch {
        // Not one of the player's messages
      }
    };

    const seekToLive = (): void => {
      // Seeking past the end lands on the live edge. The end doesn't move
      // while paused, so aim well past it
      const end = info.progressState?.seekableEnd;
      if (end !== undefined) {
        send({ event: "command", func: "seekTo", args: [end + 3600, true] });
      }
      send({ event: "command", func: "playVideo", args: [] });
    };

    const reload = (): void => {
      info = {};
      ready = false;
      lastTime = undefined;
      movedAt = Date.now();
      frame.src = src;
    };

    const goLive = (): void => {
      const stuckFor = Date.now() - movedAt;
      if (stuckFor >= RELOAD_MS) {
        reload();
        return;
      }
      const behind = info.progressState?.isAtLiveHead === false;
      const stopped = info.playerState === PAUSED || info.playerState === CUED;
      if (behind || stopped || stuckFor >= STALL_MS) seekToLive();
    };

    const listen = (): void => {
      if (!ready) send({ event: "listening" });
    };
    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      // A hidden tab's video may not have moved; give it a fresh start
      movedAt = Date.now();
      goLive();
    };
    const check = (): void => {
      if (document.visibilityState !== "hidden") goLive();
    };

    window.addEventListener("message", onMessage);
    frame.addEventListener("load", listen);
    document.addEventListener("visibilitychange", onVisible);
    const listenTimer = setInterval(listen, LISTEN_MS);
    const checkTimer = setInterval(check, CHECK_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      frame.removeEventListener("load", listen);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(listenTimer);
      clearInterval(checkTimer);
    };
  }, [frameRef, src]);
}
