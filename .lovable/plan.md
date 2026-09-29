# Next-knappen ska följa Crates skip-dörr, inte Spotifys kö

## Problemet (Lukas)
Startar man en låt själv i Spotify och trycker "Next song" i Songweaver hoppar Spotify till nästa låt i ens egen spellista/kö i stället för Crates "If you skip"-låt.

## Orsak
Next-knappen säger bara "nästa" till Spotify. När en låt startas i Spotify väntar Crate upp till ~15 s på att skip-dörren är vald innan han skickar in [nuvarande, skip-dörr] i Spotifys kö. Trycker man Next innan dess ligger fortfarande ens egen spellista där, så Spotify spelar den.

## Lösning
- Next-knappen frågar först Crate om hans skip-dörr redan ligger i Spotifys kö.
  - **Ja:** som i dag, Spotify hoppar till nästa (= Crates skip-låt).
  - **Nej, men skip-dörren är vald:** Crate spelar skip-dörren direkt (med dess egen nästa skip bakom sig) och räknar det som ett vanligt skip i labyrinten.
  - **Nej, skip-dörren inte vald än:** knappen visar "Crate is picking…" och trycket körs automatiskt så fort dörren är klar (max ~5 s, sedan faller den tillbaka till vanlig "nästa").
- Pausknappen ändras inte.
- Skippar man i Spotify-appen själv gäller samma sak som i dag (det kan Crate inte styra förrän kön är ersatt).

## Tekniskt
- radio-context.tsx: exponera `skipNow()` som kollar om `lineup` innehåller skip-dörrens id; annars anropa `startSpotifyPlayback(upSkip.track, …, "skip")` med dess `finishSkip`, och markera det som skip via samma väg som `landOnFrontier`. Vänta på pågående adopt-promise om `upSkip` saknas.
- PathMaze.tsx MediaControls: Next anropar `skipNow()` i stället för `nextSpotifyTrack`.
- Uppdatera AGENTS.md-regeln om köhantering med en rad.
