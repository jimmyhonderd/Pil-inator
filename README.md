# Pil-inator

Medicatiewekker voor Android met een controlefunctie: de melding blijft terugkomen tot je op **Ingenomen** of **Overslaan** tikt.

## Installeren

Download de nieuwste `pil-inator.apk` op je telefoon:

**https://github.com/Jimmyhonderd/Pil-inator/releases/latest/download/pil-inator.apk**

Open het bestand en sta installeren uit deze bron toe als Android daarom vraagt. Een nieuwe versie installeert over de vorige heen; je medicijnen en logboek blijven bewaard.

## Wat het kan

- **Schema's:** elke dag op vaste tijden, bepaalde weekdagen, elke paar uur (loopt door de nacht), kuur met einddatum, eenmalig.
- **Meldingen** met de knoppen Ingenomen, Later en Overslaan. Zonder reactie komt de melding terug (instelbaar: aantal keer en om de hoeveel minuten).
- **Vandaag:** een herbariumplant die per ingenomen dosis een blad krijgt, plus een tijdlijn om af te vinken.
- **Logboek** van de afgelopen twee weken: ingenomen, overgeslagen of gemist.
- **Voorraad** die aftelt met een waarschuwing als je moet bijbestellen.
- **Back-up** als JSON-bestand om te delen en terug te zetten.

Alle gegevens blijven op de telefoon. Er is geen account en geen server.

## Techniek

- Capacitor 8 (HTML/CSS/JS in `www/`) met `@capacitor/local-notifications`, dat Androids exacte wekkers gebruikt. Meldingen gaan ook af als de app dicht is en na een herstart.
- De app plant steeds de komende 4 dagen aan meldingen in en vernieuwt dat bij elke opening en elke tik op een meldingsknop.
- `tests/schedule.test.js` test de schema-logica, inclusief de wissel naar wintertijd.

## Bouwen

Elke push naar `main` bouwt via GitHub Actions een ondertekende APK en publiceert die als Release.

De ondertekensleutel (`android/app/release.keystore`) staat met een sterk wachtwoord versleuteld in de repo. Het wachtwoord staat in het repository-secret `KEYSTORE_PASSWORD`. Zonder dat secret maakt de workflow alleen een test-build en geen release.

Lokaal bouwen:

```
npm ci
npx cap sync android
cd android && ./gradlew assembleDebug
```
