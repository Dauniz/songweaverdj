/** Alternative roads: when one is on it replaces the default roads (Vibe, Era, New Angle).
 *  Only one can be on at a time. Deep cuts lives beside these as its own toggle. */
export const LENSES = [
  { id: "wormhole", name: "Wormhole", info: "Only songs you keep coming back to over the years — lots of streams, or streams spread across many years. Finish or skip, the next song is another returner. Needs your imported streaming history." },
  { id: "scene", name: "Scene", info: "Stays with one artist and their web: their songs, collaborators and featured artists. 1 skip: back to the artist. 2 and 3 skips: a featured artist. 4 skips: a new artist from the same scene." },
  { id: "texture", name: "Texture", info: "Keeps the same sound texture: piano stays piano, acoustic stays acoustic. 1 skip: same texture. 2 skips: a new texture. Works from Spotify's genre tags, so songs without tags are left out." },
] as const;

export const DEEP_CUTS_INFO =
  "Old favorites you haven't played in over a year (15+ streams, a favorite years ago). 1 skip: same era. 2 skips: a new era. Needs your imported streaming history; without it, it plays songs saved over a year ago that sit in only one playlist, so songs in several playlists are left out.";

export type LensId = (typeof LENSES)[number]["id"];
export const LENS_IDS = LENSES.map((l) => l.id) as [LensId, ...LensId[]];
export const lensName = (id: LensId | null | undefined) => LENSES.find((l) => l.id === id)?.name ?? "";
