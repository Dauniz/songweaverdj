/** Second-class branches ("lenses"): optional overlays that bend whichever first-class road
 *  (vibe / era / new angle) is active. Only one can be on at a time. */
export const LENSES = [
  { id: "wormhole", name: "Wormhole", info: "Jumps between chapters of your life via songs saved in several playlists." },
  { id: "archive", name: "Forgotten archive", info: "Digs into the oldest corners of your library." },
  { id: "scene", name: "Scene", info: "Follows artist collaborations, scenes and regional sounds." },
  { id: "wave", name: "Wave", info: "Builds energy over a few songs, then eases off, like a DJ set." },
  { id: "texture", name: "Texture", info: "Keeps the same sound texture: acoustic stays acoustic, electronic stays electronic." },
] as const;

export type LensId = (typeof LENSES)[number]["id"];
export const LENS_IDS = LENSES.map((l) => l.id) as [LensId, ...LensId[]];
export const lensName = (id: LensId | null | undefined) => LENSES.find((l) => l.id === id)?.name ?? "";
