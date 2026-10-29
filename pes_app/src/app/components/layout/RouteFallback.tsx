import { BrandLoader } from "./BrandLoader";

/**
 * Shown while a page's chunk is on its way.
 *
 * Deliberately plain. A page split into its own file usually arrives within a
 * frame or two on a warm connection, so this exists to hold the layout and
 * announce the wait to a screen reader rather than to be looked at: the crest,
 * centred in the page's area, and no words.
 */
export function RouteFallback() {
  return <BrandLoader />;
}
