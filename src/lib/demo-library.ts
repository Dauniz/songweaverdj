// Demo library so the companion works before Spotify is connected.
type Demo = [name: string, artists: string, album: string];

const PLAYLISTS: { name: string; period: string; tracks: Demo[] }[] = [
  {
    name: "Jan 2024",
    period: "2024-01-01",
    tracks: [
      ["Midnight City", "M83", "Hurry Up, We're Dreaming"],
      ["Nights", "Frank Ocean", "Blonde"],
      ["Motion Sickness", "Phoebe Bridgers", "Stranger in the Alps"],
      ["Tadow", "Masego, FKJ", "Tadow"],
      ["Holocene", "Bon Iver", "Bon Iver"],
      ["Redbone", "Childish Gambino", "Awaken, My Love!"],
    ],
  },
  {
    name: "Mar 2024",
    period: "2024-03-01",
    tracks: [
      ["Breathe Deeper", "Tame Impala", "The Slow Rush"],
      ["Pink + White", "Frank Ocean", "Blonde"],
      ["Two Weeks", "FKA twigs", "LP1"],
      ["Retrograde", "James Blake", "Overgrown"],
      ["Kyoto", "Phoebe Bridgers", "Punisher"],
      ["Sunset Lover", "Petit Biscuit", "Presence"],
    ],
  },
  {
    name: "May 2024",
    period: "2024-05-01",
    tracks: [
      ["Electric Feel", "MGMT", "Oracular Spectacular"],
      ["Chamber of Reflection", "Mac DeMarco", "Salad Days"],
      ["Nangs", "Tame Impala", "Currents"],
      ["Gooey", "Glass Animals", "ZABA"],
      ["Space Song", "Beach House", "Depression Cherry"],
      ["Get Lucky", "Daft Punk, Pharrell Williams", "Random Access Memories"],
    ],
  },
  {
    name: "Jul 2024",
    period: "2024-07-01",
    tracks: [
      ["Dreams", "Fleetwood Mac", "Rumours"],
      ["Summertime Magic", "Childish Gambino", "Summer Pack"],
      ["Loud Places", "Jamie xx, Romy", "In Colour"],
      ["Ivy", "Frank Ocean", "Blonde"],
      ["Sweet Disposition", "The Temper Trap", "Conditions"],
      ["Feels Like We Only Go Backwards", "Tame Impala", "Lonerism"],
    ],
  },
  {
    name: "Oct 2024",
    period: "2024-10-01",
    tracks: [
      ["Teardrop", "Massive Attack", "Mezzanine"],
      ["Intro", "The xx", "xx"],
      ["Glory Box", "Portishead", "Dummy"],
      ["Everything In Its Right Place", "Radiohead", "Kid A"],
      ["Night Owl", "Galimatias", "Renaissance"],
      ["Awake", "Tycho", "Awake"],
    ],
  },
  {
    name: "Dec 2024",
    period: "2024-12-01",
    tracks: [
      ["Apocalypse", "Cigarettes After Sex", "Cigarettes After Sex"],
      ["Re: Stacks", "Bon Iver", "For Emma, Forever Ago"],
      ["Line of Sight", "ODESZA, WYNNE, Mansionair", "A Moment Apart"],
      ["Cherry-coloured Funk", "Cocteau Twins", "Heaven or Las Vegas"],
      ["Porcelain", "Moby", "Play"],
      ["Strawberry Swing", "Coldplay", "Viva la Vida"],
    ],
  },
  {
    name: "Apr 2025",
    period: "2025-04-01",
    tracks: [
      ["Genesis", "Grimes", "Visions"],
      ["Innerbloom", "RÜFÜS DU SOL", "Bloom"],
      ["Kerala", "Bonobo", "Migration"],
      ["Opus", "Eric Prydz", "Opus"],
      ["You & Me - Flume Remix", "Disclosure, Eliza Doolittle", "You & Me"],
      ["Cirrus", "Bonobo", "The North Borders"],
    ],
  },
  {
    name: "Aug 2025",
    period: "2025-08-01",
    tracks: [
      ["Pyramids", "Frank Ocean", "channel ORANGE"],
      ["Let It Happen", "Tame Impala", "Currents"],
      ["Bags", "Clairo", "Immunity"],
      ["Seventeen", "Sharon Van Etten", "Remind Me Tomorrow"],
      ["Heat Waves", "Glass Animals", "Dreamland"],
      ["Andromeda", "Weyes Blood", "Titanic Rising"],
    ],
  },
];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function buildDemoRows(userId: string) {
  return PLAYLISTS.flatMap((pl) =>
    pl.tracks.map(([name, artists, album]) => ({
      user_id: userId,
      spotify_id: `demo-${slug(name)}-${slug(artists)}`,
      name,
      artists,
      album,
      image_url: null,
      preview_url: null,
      spotify_url: `https://open.spotify.com/search/${encodeURIComponent(`${name} ${artists}`)}`,
      source_type: "playlist",
      source_name: pl.name,
      source_period: pl.period,
      is_demo: true,
    })),
  );
}
