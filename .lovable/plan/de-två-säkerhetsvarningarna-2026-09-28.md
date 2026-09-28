# De två säkerhetsvarningarna

Den vanliga säkerhetskollen hittar inga problem. De två anmärkningarna kommer från databasens egen checklista, och ingen av dem är en verklig risk.

## 1. Spotify-kopplingar är helt låsta (info)
Tabellen som lagrar varje användares Spotify-inloggning har inga läsregler. Det innebär att ingen kan läsa den direkt från webbläsaren. Songweaver hämtar den bara på servern, och det var just så vi ville att Spotify-nycklarna skulle skyddas.
**Åtgärd:** ingen ändring. Varningen markeras som avsiktlig.

## 2. Rollkontrollen kan anropas av inloggade (varning)
Funktionen som kontrollerar om någon är admin kan anropas av alla inloggade användare. Den svarar bara ja eller nej på frågan om en viss användare har en viss roll. Den kan inte ge någon en roll eller visa annan data. Admin-reglerna för bland annat buggrapporter och admin-anteckningar behöver funktionen, och att stänga av den skulle bryta adminpanelen.
**Åtgärd:** ingen ändring. Varningen markeras som avsiktlig.

## Om du godkänner
- Båda anmärkningarna markeras som genomgångna, med förklaringen ovan.
- Ingen kod och ingen funktion i appen ändras.
