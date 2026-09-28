# Levande Junction Fork-träd i The maze

Uppgradera enbart visualiseringen av Junction Fork i `PathMaze.tsx` till ett animerat träddiagram enligt North Star-specen. Inga ändringar av Crates mekaniker, rekommendationer, köordning eller Spotify-logik.

## Vad som byggs

**Layout (oförändrat innehåll, ny form):**
- Nuvarande låt (O) horisontellt centrerad överst, med befintligt omslag, "You are here"-etikett och EQ-ikon.
- Två grenar nedåt: Era Road/"Keep walking" till vänster, Vibe Road/"Take a turn" till höger — samma låtkort och texter som idag.
- Grenarna ritas som mjukt böjda SVG-kurvor (2 px, rundade ändar), förankrade exakt i nodernas anslutningspunkter. Befintliga accentfärger (primary/accent) behålls per gren.
- 160 px vertikalt nivåavstånd, minst 24 px mellan korten, 32 px marginal; proportionell anpassning på smalare ytor utan överlapp.

**Animation vid låtbyte (finish eller skip):**
1. Diskret ljuspuls längs den valda grenen (180 ms).
2. Vald nod färdas kontinuerligt till O:s position högst upp (650 ms), övergår mjukt till O:s storlek/status.
3. Föregående O och den ovalda grenen följer med och tonas bort (300 ms) — ingen teleportering eller duplicerad nod.
4. Nya grenar växer ut som rötter: SVG pathLength 0 → 1 under 550 ms, 70 ms förskjutning; barnnoderna tonas in under sista 180 ms med 8 px förflyttning och skala 0.96 → 1.
- Samma sekvens återanvänds hela sessionen; bara aktuellt O + två alternativ visas, ingen växande historik.

**Återställningsanimation** vid New Angle, sökval, direktbyte i Spotify eller ny prompt: gamla diagrammet zoomar ut (skala 1 → 0.88, tonar, 280 ms), nya O zoomar in (0.96 → 1, 320 ms), nya grenar växer ut som ovan. Bytesorsakan (inte bara låt-ID) avgör animationstyp.

**Robusthet:**
- Easing `[0.22, 1, 0.36, 1]`, stabila nodnycklar, gemensamma positionsvärden för kort och linjer.
- Animationsstate hålls helt separat från playback-/kö-state; animationer fördröjer aldrig uppspelning och blockerar inga interaktioner.
- Snabba byten avbryter pågående animation mjukt från aktuell position; senaste bekräftade playback-state gäller.
- Saknade rekommendationer visar befintligt "Finding…"-läge; grenar animeras först när verkliga alternativ finns.
- `prefers-reduced-motion`: endast 120 ms övertoning, ingen panorering/zoom.

## Tekniskt

- Allt sker i `src/components/crate/PathMaze.tsx` (plus ev. små CSS-tillägg i `src/styles.css`). Biblioteket `motion` (v13) finns redan installerat och används.
- En ny intern komponent (t.ex. `JunctionTree`) ersätter den nuvarande statiska fork-markupen (raderna med `h-7`-span och `grid grid-cols-2`). Datakällorna (`radio.current`, `upNext`, `upSkip`) och varningsbannersna ovanför är orörda.
- SVG-kurvorna beräknas från gemensamma positionskonstanter så kort och linjer alltid hänger ihop.
- `radio-context.tsx`, `path.functions.ts`, `spotify.functions.ts` och all annan logik lämnas orörd.

## Verifiering

- Typecheck + build grönt.
- Visuell kontroll i Studio: trädet renderar korrekt i tom läge, med spelande låt, och grenarna växer ut när dörrarna hittats. Live skip-/finish-sekvens kräver riktig Spotify-uppspelning och verifieras av dig.
