# Håll sessionen vid liv när man lämnar Lovable-förhandsvisningen (iPhone/surfplatta)

## Problemet
På iPhone/surfplatta pausar iOS all JavaScript i bakgrundsflikar, och Lovable kopplar ner förhandsvisningssessionen om den lämnas för länge. När man kommer tillbaka "tweakar" sessionen: Crate har missat låtbyten, kön och labyrinten ligger efter, och pausregeln kan ha avslutat sessionen. När projektet publiceras på en egen adress försvinner Lovable-delen av problemet, men iOS pausar fortfarande bakgrundsflikar — så appen behöver hantera det oavsett.

## Vad som byggs

### 1. Smidig återhämtning när man kommer tillbaka (huvudfixen)
I `src/components/crate/radio-context.tsx`:
- När fliken blir synlig igen (`visibilitychange`): Crate synkar direkt mot Spotifys faktiska tillstånd — vilken låt som spelas, position, om den pausats — istället för att lita på det gamla läget.
- Tiden i bakgrunden räknas som "frusen": om Spotify fortsatt spela medan fliken var borta räknas det inte som paus, och 90-sekundersregeln avslutar inte sessionen i onödan. Om användaren verkligen pausat i över 90 s avslutas sessionen som vanligt.
- Om användaren bytte låt i Spotify medan fliken var borta: Crate upptäcker det vid återkomst och bygger om vägen från den nya låten (samma logik som vid manuella byten idag).
- Om sessionen ändå dog: "Resume last session" finns kvar och återupptar från rätt plats i labyrinten.

### 2. Håll skärmen vaken under aktiv session
- Använd Wake Lock API (`navigator.wakeLock.request("screen")`) medan en radiosession är aktiv, så skärmen inte släcks och fliken inte försätts i bakgrunden lika lätt. Stöds i Safari på iOS 16.4+. Förnyas automatiskt när man återvänder till fliken. Släpps när sessionen avslutas.

### 3. Testa via delbar länk istället för redigeraren
- För testning på telefon: använd **Share → Share preview** i Lovable — en publik länk som fungerar i 7 dagar utan inloggning och är stabilare än redigerarens förhandsvisningsram. (Ingen kodändring, bara ett arbetssätt.)

## Tekniska detaljer
- Alla ändringar i `src/components/crate/radio-context.tsx` (återhämtning + wake lock). Inga ändringar av O/A/B/C-mekaniken, dörrlogiken eller Spotify-köreglerna.
- Bakgrundstid mäts med tidsstämplar (`Date.now()`) vid `visibilitychange`, inte med timers — timers är opålitliga i pausade flikar.
- Wake lock hålls i en ref, förnyas på `visibilitychange` → visible, och fel hanteras tyst (API:t kan nekas).

## Verifiering
- Typkontroll + bygglogg.
- Playwright: simulera att fliken göms och visas igen, kontrollera att Crate synkar om utan att avsluta sessionen.
- Riktig Spotify-spelning på telefon kan jag inte testa — det får du prova efteråt.

## Observera
Den riktiga lösningen är att publicera projektet på en egen adress — då försvinner Lovable-sessionens nedkoppling helt. Säg till när du vill publicera.
