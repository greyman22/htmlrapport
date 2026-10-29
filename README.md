# Rapportverkstan

En lokal Node-app som konverterar PDF och Word (`.docx`) till läsbar, responsiv HTML.
Formgivningen är inspirerad av vinnova.se: mörkgrönt, ljusa ytor, tydlig typografi
och gott om utrymme för innehållet. Ingen Vinnova-logotyp eller licensierad webbfont
är kopierad, och appen är inte en officiell Vinnova-tjänst.

## Kom igång

Du behöver **Node.js 24 eller senare**.

```powershell
npm install
npm start
```

Öppna **http://127.0.0.1:3000**.

1. Välj ett dokument från `sources`, eller ladda upp en egen fil.
2. Klicka på **Konvertera till HTML**. För PDF visas verkligt sidförlopp.
3. Öppna resultatet i ett nytt webbläsarfönster och granska innehållet.
4. Hämta hela HTML-sidan, eller innehållet som HTML-fragment för ett CMS.

En lokal life science-PDF kan läggas i `sources` för testning, men den ingår inte
i GitHub-repot. Uppladdade filer sparas i `uploads`. Konverteringar sparas i
`output/<id>` och finns kvar efter omstart. Där finns `index.html`, `content.html`
och metadata i `report.json`.
Hela HTML-sidan innehåller stilmall och inbäddade bilder och går att öppna utan
server. Fragmentet saknar sidhuvud och stilmall; dess HTML behöver anpassas till
CMS:ets komponenter och regler. Varken rapporter eller fragment innehåller JavaScript.

### Två visningslägen

Överst i färdiga rapporter finns **Visningsläge**:

- **Rapport** är den ursprungliga presentationen med mörkgrön titelpanel och
  innehållsförteckning i sidospalten.
- **Vinnova.se** simulerar en standardsida, med vit bakgrund, centrerad lässpalt,
  svarta rubriker, brödsmulor samt hårdkodade exempel på sidhuvud, öppningsbar
  meny och sidfot. Innehållsförteckningen kan fällas ut ovanför rapporten.
  Förebilden är Vinnovas sida
  [Hälsa och livskvalitet](https://www.vinnova.se/expertisomraden-och-amnen/halsa-och-livskvalitet/).

Växlingen ändrar bara presentationen; rapportinnehåll, bilder, tabeller och
fotnotsankare är samma i båda lägena. Den fungerar med tangentbord och även i
nedladdad HTML, utan JavaScript eller externa stilmallar. Moderna webbläsare med
CSS `:has()` krävs. Rapportläget är förvalt; valet sparas inte mellan öppningar.
Länkar i det simulerade sidhuvudet och sidfoten går till den externa Vinnova-sajten.
Den gröna textmarkeringen använder vanlig systemtypografi, inte Vinnovas
logotypfil eller licensierade webbfont. Det är en approximation, inte en exakt
kopia eller integration med webbplatsen.

Visningsväxlingen ingår inte i CMS-fragmentet. Äldre HTML-filer behöver konverteras
på nytt för att få de nya lägena.

För annan port:

```powershell
$env:PORT = "3001"
npm start
```

`npm run dev` startar Node med filbevakning.

### Minimalt inklistringstest på Vinnovas testsajt

Exempel för publikationssidan
<https://externwebb-test.vinnova.se/publikationer/testpublikation/>:

1. Klistra in innehållet i [vinnova-test.html](public/examples/vinnova-test.html)
   i TinyMCE:s HTML-/källkodsläge.
2. Lägg innehållet i [vinnova-test.css](public/examples/vinnova-test.css)
   i ett `<style>`-element i sidans redaktionella head-fält.
3. Spara och kontrollera den renderade sidan. Fragmentet ska ligga inuti
   `component-content-editorial`, inte ersätta sidans H1, ingress eller sidhuvud.

Filerna kan även hämtas från appens `/examples/vinnova-test.html` respektive
`/examples/vinnova-test.css`. HTML-filen är ett inklistringsfragment, inte en
fristående förhandsvisning med sajtens CSS.

Menyn flyttas ut till vänster först vid 1360 px fönsterbredd. Textspalten
ligger kvar. Vid mindre bredder ligger menyn ovanför rapporttexten. Sticky
begränsas av testfragmentets höjd; ingen JavaScript-kod används.

`--rv-title-offset: 380px` är en ungefärlig linjering med just testsidans H1.
Ändra värdet om rubrik, omslag eller ingress ändrar höjd; sätt det till `0px`
för att låta menyn börja vid rapporttexten i stället. `--rv-sticky-top` styr
avståndet till fönstrets ovankant vid rullning.

CSS:en ändrar också `overflow` på `body` och `#area_main`, enbart på
publikationssidor som innehåller `.rv-test`, eftersom testsidan annars hindrar
sticky-beteendet. Detta kräver moderna webbläsare med CSS `:has()` och `overflow: clip`.
Kontrollera att detta inte påverkar andra sidkomponenter. TinyMCE måste bevara
fragmentets struktur, klasser och id-attribut. Testa detta efter en verklig
spara-/öppna-cykel i CMS:et; en webbläsarförhandsvisning verifierar inte saneringen.

## Vad följer med?

PDF och Word har separata extraktionsregler eftersom deras struktursignaler är
olika. PDF använder PDF-taggar och sidpositioner; Word använder DOCX-stilar,
bokmärken och dokumentrelationer. Läs [reglerna för dokumentkonvertering](docs/conversion-rules.md)
innan du ändrar hur innehåll tolkas.

### PDF

- PDF.js läser text, metadatatitel, struktur och tillåtna externa länkar.
- Taggade rubriker blir HTML-rubriker och rapportens navigering byggs från dessa.
- Stycken, listor och tabeller använder PDF:ens struktur när den finns.
- Intilliggande stycken som tydligt är syntaktiska fortsättningar kan slås ihop,
  till exempel om nästa stycke börjar med gemen eller skiljetecken. Antalet
  reparationer redovisas som en varning så att läsflödet kan granskas.
- Taggade figurer med avgränsningar beskärs ur en renderad sida. Även vektorbaserade
  diagram kan därför följa med som bilder. Alternativtext från källan bevaras.
- Taggade fotnoter visas på respektive sida. Numrerade hänvisningar kopplas till
  noter på samma sida, med länkar tillbaka.
- Varje sida har en originalvy för jämförelse. Sidor utan maskinläsbar text visas
  som bild med en uttrycklig varning. **OCR ingår inte.**
- Saknas användbara taggar uppskattas stycken och rubriker från textens positioner.
  Appen varnar då för att läsordningen måste granskas. Otaggade bilder finns i
  originalvyn men extraheras inte som separata figurer.

### Word

- Mammoth läser `.docx`: rubriker, stycken, listor, tabeller, länkar, fotnoter,
  slutnoter och inbäddade bilder.
- Word-stilar, inklusive svenska rubrikstilar, används för struktur. Direkt
  formaterad stor text är inte alltid en riktig rubrik.
- PNG, JPEG, GIF, WebP och BMP stöds. Andra bildformat ger ett tydligt fel så att
  de kan sparas om i källdokumentet. Externt länkade bilder läses inte in.
- Äldre `.doc` stöds inte. Öppna filen i Word eller LibreOffice och spara som
  `.docx` först.

## Granska före publicering på vinnova.se

Detta är en konverteringsprototyp, inte en direkt integration med webbplatsens CMS.
Automatiskt genererad HTML är **inte en garanti för WCAG-överensstämmelse**.
Kontrollera särskilt:

- Läsordning i flerspaltiga PDF:er, avstavningar och sidövergångar.
- Rubrikhierarki, tabellrubriker, sammanfogade celler och listnivåer.
- Diagrammens alternativtexter och behov av kompletterande datatabeller.
- Fotnotsnumrering och hänvisningar som går mellan olika sidor.
- Interna PDF-länkar och innehållsförteckningen i originalet: de rekonstrueras
  inte automatiskt som webblänkar. Webbversionen får en egen rubriknavigering.
- Språk, länktexter och eventuella bortfall i felaktigt taggade dokument.

Originalets sidbrytningar bevaras som avsnitt för spårbarhet. De kan behöva tas
bort eller slås samman vid redaktionell bearbetning.

## Strapi (fas 1: läsa modellen)

Kopiera `.env.example` till `.env` och fyll i `STRAPI_URL` (standard `http://localhost:1337`), `STRAPI_API_TOKEN` och vid behov `STRAPI_PUBLIC_URL` (standard `http://localhost:3001`). Den publika adressen används för länken till den publicerade artikeln. Token behöver behörighet till Content-Type Builder för att läsa modellen. `.env` är ignorerad av git.

- `npm run strapi:model` skriver Article-modellen (fält, dynamiska zoner och upplösta komponenter) som JSON.
- `GET /api/strapi/status`, `/api/strapi/article-model` och `/api/strapi/articles` (utkast) är skrivskyddade.
- [lib/strapi.js](lib/strapi.js) innehåller även `createArticleDraft`, som alltid skapar utkast (`status=draft`) och ännu inte är kopplad till något anrop.

Article är `plugin::vinnova-strapi-common.article` med REST-sökvägen `/api/vinnova-strapi-common/articles`.

### Skapa artikelutkast från en konverterad rapport

Panelen "Skapa artikelutkast i Strapi" (eller `POST /api/strapi/export` med `{ reportId, testMode, dryRun }`) bygger ett utkast av `content.html`:

- Rubriker, stycken (fet, kursiv, länkar), listor, citat och kod blir blocks i `rich-text`-komponenter i `mainContentBlocks`.
- Bilder laddas upp till Strapi med gemensamt filnamnsprefix `rv-<rapportnamn>-001.png` osv, så att de går att sortera och flytta till en mapp. Alt-text och bildtext följer med. Dubbletter laddas upp en gång.
- Varje tabell blir en egen `html-asset` (publicerad) som artikeln refererar till via `html-asset-ref`. Artikeln själv är alltid ett utkast.
- Fotnotsreferenser blir klickbara `[n]`-länkar med mellanrum före markören och en fotnotslista (HTML-block) sist i artikeln, under rubriken "Fotnoter". Strapi godtar bara absoluta länkar eller länkar som börjar med `/`, så länken byggs som `/article/<slug>#fotnot-…`. Sökvägen kan ändras med `STRAPI_ARTICLE_PATH` i `.env` (standard `/article`). Sajtens HTML-sanering tar bort `id`, därför används `<a name>` som ankare.
- Innehållsförteckningen analyseras separat utifrån källformatet och utelämnas
  från Strapi-artikeln när signalerna räcker. PDF behöver minst tre poster utan
  rubrik; Word behöver minst två uttryckliga stil- eller bokmärkesposter. Med en
  igenkänd TOC-rubrik krävs minst två rimliga poster. Då läggs "Sidnavigering"
  först i artikeln. Osäker text bevaras i stället för att tas bort.
- Taxonomin Content Types = Report väljs automatiskt (slås upp i Strapi).
- Sidbilder av originalsidor (`details.original` och sidor utan text) tas inte med.
- Slug är högst 20 tecken: en kortad rubrik och de första åtta tecknen i rapport-id. Finns den redan avbryts exporten.
- Efter exporten visas både länken till Strapi-utkastet och en länk till den publika adressen (`STRAPI_PUBLIC_URL/article/<slug>`). Den publika länken fungerar först när artikeln har publicerats.
- Testläge (valfri kryssruta, av som standard) slutar efter första stycket, bilden och tabellen, så att det som ska rensas i Strapi blir litet. Låt kryssrutan vara av för en fullständig rapport. "Förhandsgranska" visar vad som skulle skapas utan att skriva något.
- Går något fel mitt i exporten visas vilka filer och tillgångar som redan skapats (de raderas inte automatiskt, API:et saknar stöd för mappar och vi städer manuellt i Strapi).

## Lokal drift och begränsningar

- Servern lyssnar bara på `127.0.0.1`. Inga dokument skickas till molntjänster.
- Högst 30 MB per källfil och 300 sidor per PDF. Uppackade Word-arkiv begränsas
  till 150 MB; ZIP64 stöds inte. En konvertering körs åt gången.
- Stora rapporter kan ge stora HTML-filer eftersom bilderna är inbäddade.
- Uppladdningar och resultat sparas lokalt tills du själv raderar dem.
- HTML från Word saneras, skript tillåts inte i rapportvyn och filval görs via
  serverns källista. Det finns inte inloggning, användarisolering eller skydd för
  drift på internet. Exponera inte prototypen som en publik tjänst.
- Vid omstart avbryts pågående jobb. Färdiga rapporter finns kvar i historiken.

## Tester

```powershell
npm test
```

Testerna täcker HTML-generering, sanering, källval, felaktiga filer samt en verklig
DOCX-konvertering med bild, tabell och länkade fotnoter. De testar även en otaggad
PDF, en sida utan text och hela den medföljande 50-sidiga rapportens rubriker,
figurer, fotnoter och interna HTML-ankare. Testfiler och testresultat tas bort
efter körningen.

`npm audit` rapporterar för närvarande tre måttliga anmärkningar i kedjan
`mammoth → argparse → sprintf-js`. Använd inte `npm audit fix --force` blint:
den föreslagna lösningen nedgraderar Mammoth till en mycket gammal version.
Beroendena behöver följas upp innan en eventuell produktionssättning.
