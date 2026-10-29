# Regler för dokumentkonvertering

Detta dokument beskriver varför konverteringen har separata PDF- och Word-spår,
hur innehållsförteckningar hanteras och hur dokumentets innehåll mappas vidare.
Ändra reglerna tillsammans med testerna när nya dokumenttyper eller varianter
läggs till. Konverteringen är heuristisk: den ska bevara så mycket som möjligt
och tydligt varna när källans struktur inte räcker för en säker tolkning.

## Övergripande faser

1. **Källspecifik extraktion.** PDF och DOCX använder olika läsare och olika
   struktursignaler. PDF läses med PDF.js; DOCX läses med Mammoth. Filändelsen
   väljer flöde, och `.doc` måste först sparas som `.docx`.
2. **Identifiera innehållsförteckning.** När HTML-fragmentet planeras för Strapi
   körs PDF- eller Word-regler innan innehållsklassificeringen. Identifierade
   TOC-rader utelämnas från artikelinnehållet; ett sidnavigeringsblock läggs
   först i artikeln. Saknas tillräckligt med signaler bevaras innehållet.
3. **Klassificera innehållet.** Rubriker, stycken, listor, citat, bilder,
   tabeller och fotnoter mappas till Strapi-block eller HTML-assets. Källformatet
   avgör hur vissa delar, framför allt fotnoter och sidbilder, identifieras.
4. **Granska resultatet.** Originalvyn och varningarna finns kvar för jämförelse.
   En automatisk konvertering är inte en garanti för korrekt läsordning,
   tillgänglighet eller redaktionell kvalitet.

## Kodkarta

- `lib/convert.js` väljer PDF- eller Word-flöde utifrån filändelsen.
  `convertPdf` hanterar PDF.js, taggträd, sidpositioner och sidbilder;
  `convertWord` kombinerar Mammoths HTML med DOCX-strukturläsningen i
  `lib/word-structure.js`. Den senare läser XML-fält och stilar ur DOCX-paketet
  innan TOC-rader markeras i HTML. Ändra inte dessa källspecifika regler i den
  gemensamma rapportskrivningen.
- `lib/toc-analysis.js` väljer PDF- respektive Word-signaler för TOC innan
  Strapi-innehållet klassificeras.
- `lib/article-plan.js` mappar det analyserade fragmentet till Strapi-neutrala
  block och samlar bland annat Word- och PDF-fotnoter.
- `test/app.test.js` testar riktiga PDF-/DOCX-konverteringar;
  `test/article-plan.test.js` testar TOC- och blockregler med små syntetiska
  dokument, inklusive fall som ska bevaras.

## PDF-spåret

- PDF:ens strukturträd används när det finns användbara taggar. Rollerna för
  rubriker, stycken, listor, tabeller, figurer, fotnoter och TOC-poster ger
  starkare signaler än enbart utseende.
- Taggade TOC-poster blir `p.toc-entry`. Om taggar saknas skapas textstycken
  utifrån positioner; detta är en uppskattning och kan inte säkert rekonstruera
  kolumner eller semantiska tabeller.
- Efter PDF-extraktionen slås intilliggande, omarkerade stycken ihop om nästa
  fragment börjar med gemen eller skiljetecken. Fristående skiljetecken läggs
  till föregående stycke. Det åtgärdar trasiga P-taggar som delar en mening runt
  fotnoter; kompletta meningar och stycken med särskilda attribut lämnas orörda.
  Antalet reparationer räknas och visas som en granskningsvarning.
- TOC identifieras med en tydlig rubrik följd av minst två rimliga poster, eller
  med minst tre poster i följd utan rubrik. Punktledare och sidnummer är en
  signal, inte ett krav. Strukturtaggen `TOCI` är en stark signal.
- Figurer beskärs från renderad sida när PDF-strukturen ger en avgränsning.
  Sidor som bara är skannade får en uttrycklig `source-page-image`-markering;
  Strapi-exporten hoppar över den bilden. Äldre konverteringar identifieras
  även med sitt äldre svenska alt-textprefix. Originalsidbilder behålls i
  förhandsvisningen. OCR görs inte.
- Fotnoter kopplas med PDF:ens `Note`/`Reference`-struktur. Saknade eller
  felaktiga taggar kan göra att hänvisning och not inte kan paras ihop. Ett
  typografiskt mellanrum läggs före referensen när den annars sitter direkt
  efter en bokstav eller siffra; befintligt mellanrum och skiljetecken bevaras.
- Layoutbaserad läsordning, avstavningar, vektordiagram och tabeller behöver
  granskas mot originalet. PDF:er utan användbara taggar får en varning.

## Word-spåret

- DOCX läses via Mammoth med externa filresurser avstängda. Word-stilar,
  rubriknivåer, listor, tabeller, länkar, bilder och fotnoter används när de
  finns i dokumentet.
- DOCX-paketets `word/document.xml` och `word/styles.xml` läses dessutom
  separat. Dynamiska fält (`w:fldChar`/`w:instrText` med `TOC`), `w:fldSimple`,
  TOC-formatmallar och `_Toc`-bokmärken är explicita signaler. Resultatraderna
  från ett sådant fält märks i Mammoth-HTML innan artikelplanen skapas. Den
  strukturläsningen kompletterar Mammoth och används inte som en ersättning
  för dess innehålls- och bildkonvertering.
- En manuell Word-radbrytning (`w:br`) behålls som `<br>` i HTML-visningen.
  När text hämtas ur HTML, exempelvis för artikelrubrik eller TOC-analys,
  behandlas den som ett ordmellanrum. Annars kan ord på var sin sida om
  radbrytningen fastna ihop när HTML-taggar tas bort.
- Vanliga engelska och svenska TOC-stilar märks som `toc-entry`. Interna Word-
  bokmärken som `_Toc…` är också en signal. En TOC-rubrik följd av minst två
  stil- eller bokmärkta poster känns igen direkt. Eftersom Word-dokument ofta
  saknar sådana metadata accepteras också minst tre sammanhängande rader med
  sidnummer sist efter en tydlig TOC-rubrik. Utan rubrik krävs fortfarande
  minst två uttryckliga stil- eller bokmärkta poster. Den högre tröskeln för
  omarkerade sidor minskar risken att vanlig löptext med årtal tas bort.
- Word-fotnoter och slutnoter länkas från dokumenttexten till en gemensam
  fotnotslista sist i Strapi-artikeln. Fotnotslistans returmarkörer tas bort.
  Ett mellanrum infogas före hänvisningen om den annars sitter direkt efter
  föregående innehåll, även när föregående tecken är skiljetecken. Befintliga
  mellanrum bevaras utan att dubbleras.
- Inbäddade bilder bäddas in i HTML-fragmentet och extraheras senare till
  Strapi. Externt länkade bilder läses inte in. Bildformat som inte stöds ger
  ett tydligt fel i stället för en tyst utelämning.
- Mammoth kan lägga en bild direkt i ett vanligt `<p>`. Artikelplanen måste
  därför behandla sådana bilder separat från styckets löptext; annars syns de i
  HTML-förhandsvisningen men tappas vid Strapi-exporten.
- Word-sidnummer och sidlayout översätts inte till webbsidans layout. En
  innehållsförteckning som Word inte exponerar med stil eller bokmärken kan
  därför bli kvar och behöver kontrolleras manuellt.

## Gemensam innehållsmappning

- Rubriker behåller sin nivå så långt målformatet medger; kontrollera att
  nivåerna inte hoppar och att dokumenttitel inte blir en olämplig H1.
- Tabeller behålls som HTML-assets. Kontrollera rubrikceller, sammanfogningar,
  tabellens läsordning och mobil visning.
- Bilder får källans alternativtext. Saknad alternativtext markeras så att den
  kan kompletteras redaktionellt. Diagram kan behöva en separat textbeskrivning.
- Fotnotshänvisningar blir klickbara och noterna samlas sist. Källformatets
  ankare måste gå att para ihop; hänvisningar utan motsvarande not markeras.
- Okända eller tvetydiga strukturer ska hellre bevaras och varnas för än tas
  bort utifrån en gissning.

## Ändra eller lägga till regler

1. Lägg formatets signaler i dess eget analysspår; återanvänd inte en PDF-regel
   för DOCX eller tvärtom utan dokumentexempel som visar att signalen delas.
2. Håll TOC-identifieringen före innehållsklassificeringen. Testa både vad som
   ska utelämnas och att vanlig text med liknande form bevaras.
3. Lägg till små syntetiska tester för varje ny signal och en integrationstest
   genom respektive konverterare när formatbibliotekets utdata påverkas.
4. Uppdatera detta dokument med signal, tröskel, begränsning och motivering.
   Kör `npm test` innan regeln används på riktiga rapporter.
