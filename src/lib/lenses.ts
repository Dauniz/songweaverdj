/** Second-class branches ("lenses"): optional overlays that bend whichever first-class road
 *  (vibe / era / new angle) is active. Only one can be on at a time. */
export const LENSES = [
  { id: "wormhole", name: "Wormhole", info: "Jumps between chapters of your life via songs saved in several of your playlists." },
  { id: "scene", name: "Scene", info: "Follows artist collaborations, featured artists, labels and regional scenes." },
  { id: "wave", name: "Wave", info: "Builds energy over three songs, then calms down for two — like a DJ set." },
  { id: "texture", name: "Texture", info: "Keeps the same sound texture: acoustic stays acoustic, electronic stays electronic." },
] as const;

export type LensId = (typeof LENSES)[number]["id"];
export const LENS_IDS = LENSES.map((l) => l.id) as [LensId, ...LensId[]];
export const lensName = (id: LensId | null | undefined) => LENSES.find((l) => l.id === id)?.name ?? "";
