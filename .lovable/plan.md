# Skydda en pågående Spotify-session

## Vad loggarna visar
- Din prompt sparades 09:36:59 svensk tid. Crates lista var **Good Morning → Magic In The Hamptons → AOK → be that too → Seve → I Ain’t Worried**.
- Good Morning registrerades som färdigspelad 09:41:17.
- Under min verifiering av chattens utseende skickade jag en annan prompt från en separat inloggad testvy. Svaret sparades 09:42:27 med **Heartbeats** först i en ny sexlåtslista, och testvyn startade Spotify-spelning.
- Det förklarar varför Heartbeats dök upp utanför din listas dörrar: min testvy konkurrerade med din pågående session. Det var mitt test som störde din lyssning, inte belägg för att Crate valde Heartbeats ur din lista.
- Den detaljerade Spotify-kommandologgen finns bara tillfälligt i respektive öppna vy. Därför går det inte att läsa tillbaka varje kommando från din enhet här.

## Föreslagna åtgärder
1. **Isolera framtida tester.** Verifiering av chatt och utseende ska inte skicka riktiga Spotify-kommandon på ditt konto. Använd ett separat testkonto eller fånga Spotify-anrop i testet innan någon uppspelningsåtgärd görs.
2. **En styrande Songweaver-session per konto.** En annan Songweaver-vy får inte automatiskt starta en konkurrerande session. Visa i stället att en session redan pågår och erbjud ett uttryckligt övertagande.
3. **Stoppa gamla vyers kommandon vid övertagande.** Även väntande uppspelningar, återanslutningar och bakgrundens låtbyten ska kontrollera att de fortfarande tillhör den styrande sessionen innan de skickas till Spotify.
4. **Behåll musikreglerna.** Ändra inte sexlåtslistans ordning, finish-/skip-dörrarna, manuella låtval i Spotify eller Walrus-minnen. Radera inte befintlig historik.

## Tekniskt upplägg
- Lägg kontots aktiva styrnings-ID i Lovable Cloud och koppla det till en unik vyägare, separat från chattens återupptagnings-ID.
- Kontrollera ägarskapet på serversidan för alla Spotify-kommandon som ändrar uppspelning, inklusive bakgrundshjälpen. Ett inaktuellt kommando avvisas utan att röra Spotify.
- Gör övertagandet atomärt och serialisera konkurrerande skrivningar per konto så att ett gammalt kommando inte kan vinna efter övertagandet.
- Uppdatera sessionsstart och återupptagning för det uttryckliga övertagandet. Behåll regeln att Spotify lämnas ifred när ingen session pågår.

## Verifiering
- Testa två samtidiga vyer: den andra kan inte starta Heartbeats medan den första spelar Magic In The Hamptons utan ett godkänt övertagande.
- Testa att gamla väntande kommandon och bakgrundsbyten avvisas efter övertagandet.
- Testa att en ensam session fortfarande spelar sina sex låtar i ordning och att avslut/återupptagning behåller nuvarande chattbeteende.
- Kör tester utan att styra ditt riktiga Spotify. Faktisk ljudövergång kontrolleras därefter av dig på enheten.