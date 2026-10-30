import type { Theme } from "../hooks/useTheme";

// Credits the data providers' terms ask for, always shown in a corner of the map:
// AISHub wants "Data: AISHub contributors" clearly visible near the data, and
// adsb.fi a citation with a link to its site
interface DataCreditsProps {
  theme: Theme;
  /** The server uses the AISHub feed */
  aishub: boolean;
  /** Aircraft from adsb.fi are on the map */
  adsb: boolean;
  /** The map's own attribution button sits to the right */
  besideButton: boolean;
  /** The ship list covers the right of the map (wider screens) */
  showShipList: boolean;
}

const LINK = "text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white underline";

export default function DataCredits({ theme, aishub, adsb, besideButton, showShipList }: DataCreditsProps) {
  if (!aishub && !adsb) return null;
  // Clear of the 31px attribution button when it shows
  const right = besideButton
    ? showShipList
      ? "right-[47px] md:right-[calc(25rem+37px)]"
      : "right-[47px]"
    : showShipList
      ? "right-2.5 md:right-100"
      : "right-2.5";
  return (
    <div
      className={`absolute bottom-2.5 ${right} z-50 h-7.75 max-w-[calc(100%-67px)] flex items-center pointer-events-none transition-[right] duration-300 ease-in-out ${theme === "dark" ? "dark" : ""}`}
    >
      <div className="pointer-events-auto px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-800/80 text-[0.65rem] leading-tight text-slate-600 dark:text-slate-300 truncate">
        {aishub && (
          <a href="https://www.aishub.net" target="_blank" rel="noopener noreferrer" className={LINK}>
            Data: AISHub contributors
          </a>
        )}
        {aishub && adsb && " · "}
        {adsb && (
          <>
            Aircraft:{" "}
            <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer" className={LINK}>
              adsb.fi
            </a>
          </>
        )}
      </div>
    </div>
  );
}
