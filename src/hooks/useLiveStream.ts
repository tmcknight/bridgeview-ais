import { useEffect, type RefObject } from "react";

// How often to check the player, and to say hello until it answers
const CHECK_MS = 5000;
const LISTEN_MS = 1000;
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
  progressState?: ProgressState;
}

/**
 * Keeps a YouTube live stream embed (with `enablejsapi=1`) at the live edge:
 * if it's paused, or has fallen behind (buffering, a background tab, someone
 * scrubbing back), it plays again from live. Talks to the player through
 * postMessage, the same protocol YouTube's iframe API script uses, so it
 * needs no script of its own.
 */
export function useLiveStream(
  frameRef: RefObject<HTMLIFrameElement | null>,
  src: string,
): void {
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const info: PlayerInfo = {};
    let ready = false;

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
      } catch {
        // Not one of the player's messages
      }
    };

    const goLive = (): void => {
      const progress = info.progressState;
      const behind = progress?.isAtLiveHead === false;
      const stopped = info.playerState === PAUSED || info.playerState === CUED;
      if (!behind && !stopped) return;
      // Seeking past the end lands on the live edge. The end doesn't move
      // while paused, so aim well past it
      if (progress?.seekableEnd !== undefined) {
        send({ event: "command", func: "seekTo", args: [progress.seekableEnd + 3600, true] });
      }
      send({ event: "command", func: "playVideo", args: [] });
    };

    const listen = (): void => {
      if (!ready) send({ event: "listening" });
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible") goLive();
    };

    window.addEventListener("message", onMessage);
    frame.addEventListener("load", listen);
    document.addEventListener("visibilitychange", onVisible);
    const listenTimer = setInterval(listen, LISTEN_MS);
    const checkTimer = setInterval(goLive, CHECK_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      frame.removeEventListener("load", listen);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(listenTimer);
      clearInterval(checkTimer);
    };
  }, [frameRef, src]);
}
