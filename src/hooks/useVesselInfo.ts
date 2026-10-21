import { useEffect, useState } from "react";
import type { VesselInfo } from "../types/vessel";
import { fetchVesselInfo } from "../utils/wikidata";
import { logger } from "../utils/logger";

export interface VesselInfoState {
  info: VesselInfo | null;
  loading: boolean;
}

interface LookupResult {
  key: string;
  info: VesselInfo | null;
}

/**
 * Fetch supplementary vessel details from Wikidata for a ship.
 * Pass enabled=false to skip the lookup (e.g. when the ship isn't selected).
 */
export function useVesselInfo(mmsi: number, imo: number | undefined, enabled = true): VesselInfoState {
  const key = `${mmsi}:${imo ?? ""}`;
  const [result, setResult] = useState<LookupResult | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    fetchVesselInfo(mmsi, imo)
      .then((info) => {
        if (!cancelled) setResult({ key, info });
      })
      .catch((err) => {
        logger.warn("[Wikidata] vessel lookup failed:", err);
        if (!cancelled) setResult({ key, info: null });
      });

    return () => {
      cancelled = true;
    };
  }, [mmsi, imo, key, enabled]);

  if (!enabled) return { info: null, loading: false };
  // Result belongs to a previous ship/IMO until the current lookup resolves
  if (result?.key !== key) return { info: null, loading: true };
  return { info: result.info, loading: false };
}
