# Mini-Foglio di Calcolo — PWA con supporto AI

> **🌐 Applicazione online:** <https://Star08-web-Scuola.github.io/Tabelle_calcolo_GPOI/>
> _(URL pubblico generato da GitHub Pages tramite la workflow `.github/workflows/deploy.yml`.)_
>
> **Repository:** <https://github.com/Star08-web-Scuola/Tabelle_calcolo_GPOI>

Una **Progressive Web App** installabile e completamente offline che simula un foglio di
calcolo: griglia 100 × 100 (10.000 celle), motore di calcolo **scritto da zero** (lexer,
parser, evaluator, grafo delle dipendenze), interfaccia a **ribbon** e **assistente AI locale**.

| | |
|---|---|
| **Stack** | Svelte 5 (runes) + Vite 8 + Pico.css v1 |
| **Librerie ammesse** | `@picocss/pico`, `mathjs` (funzioni matematiche), `dayjs` (data/ora) |
| **Librerie vietate** | nessuna libreria di spreadsheet: parser, evaluator, virtualizzazione e gestione tabellare sono **implementati da zero** |
| **Test** | `npm test` → 37 test unitari del motore e delle librerie (Vitest) |
| **Offline** | Service Worker con precache generato al build time + strategie cache-first / network-first |
| **Dati** | nessun dato lascia il dispositivo (salvataggio su `localStorage`) |

---

## 📑 Indice

1. [Avvio in locale](#1-avvio-in-locale)
2. [Deploy](#2-deploy)
3. [Funzionalità implementate](#3-funzionalità-implementate)
4. [Architettura](#4-architettura)
5. [Strategia di virtualizzazione](#5-strategia-di-virtualizzazione)
6. [Motore di calcolo](#6-motore-di-calcolo)
7. [Gestione delle dipendenze](#7-gestione-delle-dipendenze)
8. [Risultati dei casi di test](#8-risultati-dei-casi-di-test)
9. [Funzionalità extra](#9-funzionalità-extra)
10. [Difficoltà incontrate e come sono state risolte](#10-difficoltà-incontrate-e-come-sono-state-risolte)
11. [Domande di riflessione](#11-domande-di-riflessione)
12. [Uso dell'AI](#12-uso-dellai)
13. [Struttura del progetto](#13-struttura-del-progetto)

---

## 1. Avvio in locale

Il **service worker** richiede un server HTTP: aprire `index.html` con `file://` **non**
funziona (è un vincolo del requisito).

### Sviluppo (hot reload)

```bash
npm install
npm run dev          # http://localhost:5173
```

### Build di produzione + server statico

```bash
npm install
npm run build        # genera dist/
npm run serve        # http://127.0.0.1:4173  (server statico Node, zero dipendenze)
```

Equivalenti ammessi dalla specifica:

```bash
python -m http.server 4173   # dalla cartella dist/
npx serve dist
```

### Test

```bash
npm test             # 37 test unitari (motore, parser, coordinate, AI, CSV)
```

---

## 2. Deploy

L'applicazione è un sito statico: funziona sia su **GitHub Pages** (sottopercorso
`/<repo>/`) sia su **Vercel** (radice del dominio). I due problemi classici — **percorsi
assoluti** e **scope del service worker** — sono risolti alla radice:

* `vite.config.js` imposta `base: './'` → tutti gli asset sono referenziati in modo relativo;
* `public/manifest.json` usa `"start_url": "./"` e `"scope": "./"`;
* il service worker viene registrato con `navigator.serviceWorker.register('./sw.js', { scope: './' })`;
* il service worker contiene solo percorsi relativi (`'./'`, `'./index.html'`, …).

### Opzione A — GitHub Pages (workflow già pronta)

1. Repository → **Settings → Pages** → *Source*: **GitHub Actions**.
2. `git push` sul branch `main`: la workflow `.github/workflows/deploy.yml` esegue
   `npm ci → npm test → npm run build → deploy` e pubblica l'artefatto `dist/`.
3. URL risultante: `https://<utente>.github.io/<repo>/`

Alternativa manuale (senza workflow): `npm run build`, copia il contenuto di `dist/` nella
cartella `/docs` e seleziona *Deploy from a branch → main → /docs*. In questo caso i percorsi
relativi continuano a funzionare perché il `base` è `./`.

### Opzione B — Vercel

1. Vercel → **Add New → Project** → importare il repository GitHub.
2. Configurazione (è già in `vercel.json`):
   * **Framework Preset**: *Other*
   * **Build Command**: `npm run build`
   * **Output Directory**: `dist`
   * **Install Command**: `npm ci`
3. Deploy → URL `https://<progetto>.vercel.app/`.

> **Nota.** La guida della traccia indica *Build Command vuoto* e *Output Directory = root*:
> vale per un sito statico senza passo di build. Questo progetto usa Svelte + Vite, quindi
> **serve** `npm run build` con output in `dist/`. Tutto il resto (percorsi relativi, scope
> del SW, HTTPS) è identico.

### Verifica post-deploy ( checklist)

- [ ] Il pulsante di installazione compare nella barra degli indirizzi (Chrome/Edge desktop).
- [ ] In DevTools → **Application → Manifest**: nessun errore, icone 192 e 512 caricate.
- [ ] In DevTools → **Application → Service Workers**: stato *activated and running*.
- [ ] In DevTools → **Network → Offline** → ricarica: l'app si avvia e funziona.
- [ ] Console del browser: **nessun errore 404**.
- [ ] Finestra anonima: tutto quanto sopra (la cache normale nasconde i problemi).

---

## 3. Funzionalità implementate

### Griglia

* Griglia **100 righe × 100 colonne** (A1:CV100), ingrandibile fino a 500 × 200 con
  l'inserimento di righe/colonne.
* Celle editabili con **numeri**, **testo** e **formule** (`=…`).
* Intestazioni di colonna `A…CV` e di riga `1…100`, con evidenziazione di **riga e colonna
  correnti**.
* **Barra delle formule** con il contenuto grezzo della cella selezionata, modificabile.
* Navigazione da tastiera: frecce, `Tab`, `Invio`, `Shift+Invio`, `Pag Su`/`Pag Giù`, `Home`,
  `Ctrl+Home`, `F2` (modifica), `Canc`, `Esc`.
* **Selezione rettangolare** con trascinamento del mouse o `Shift+clic`; la barra di stato
  mostra in tempo reale `SOMMA`, `MEDIA`, `MIN`, `MAX` della selezione.
* **Inserimento ed eliminazione di righe e colonne** con *traslazione automatica dei
  riferimenti* delle formule (come in Excel): `=SOMMA(A1:A2)` diventa `=SOMMA(A2:A3)` se
  inserisci una riga sopra; i riferimenti a righe/colonne eliminate diventano `#RIF!`.
* Copia / taglia / incolla, **annulla / ripeti** (Ctrl+Z / Ctrl+Y).
* Formattazione: **grassetto**, **corsivo**, allineamento, formato numerico
  (generale, intero, 2 decimali, migliaia, euro, percentuale, scientifico).
* Tema chiaro/scuro, interfazione **responsive** (desktop, tablet, smartphone).

### Motore di calcolo

| Funzione | Sintassi | Note |
|---|---|---|
| `SOMMA` | `=SOMMA(A1:A5)` | somma di numeri |
| `MEDIA` | `=MEDIA(A1:A5)` | media aritmetica |
| `CONTA` | `=CONTA(A1:A5)` | conta le celle **numeriche** |
| `CONTA.VALORI` | `=CONTA.VALORI(A1:A5)` | conta le celle **non vuote** |
| `SOMMA.SE` | `=SOMMA.SE(A1:A10;">5")` | somma condizionata (3° argomento opzionale) |
| `CONTA.SE` | `=CONTA.SE(A1:A10;">5")` | conteggio condizionato |
| `MEDIA.SE` | `=MEDIA.SE(A1:A10;">5")` | media condizionata |
| `MAX` / `MIN` | `=MAX(A1:A5)` | massimo / minimo |

**Funzioni extra** (45 in totale): `SE`, `SE.ERRORE`, `ÈERRORE`, `E`, `O`, `NON`, `CONCAT`,
`LUNGEZZA`, `MAIUSC`, `MINUSC`, `TROVA`, `POTENZA`, `RADQ`, `ASSOLUTO`, `ARROTONDA`, `TRONCA`,
`INT`, `ARROONDA.SOPRA`, `ARROONDA.SOTTO`, `MODULO`, `SEGNO`, `PI`, `SENO`, `COSENO`,
`TANGENTE`, `ARCSEN`, `ARCCOS`, `ARCTAN`, `SENOIDALE`, `COSENOIDALE`, `TANGENTEIDALE`, `ESP`,
`LN`, `LOG`, `GRADI`, `RADIANI`, `FATTORIALE`, `MCD`, `MCM`, `IPOTENUSA`, `GRANDE`, `PICCOLO`,
`SOMMA.PRODOTTO`, `MEDIANA`, `OGGI`, `ADESSO`, `ANNO`, `MESE`, `GIORNO`, `RIGA`, `COLONNA`, `INFO`.

Ogni funzione ha anche il **nome inglese** come alias (`SUM`, `AVERAGE`, `COUNT`, `COUNTIF`,
`SUMIF`, `AVERAGEIF`, `IF`, `ROUND`, `CONCATENATE`, `SQRT`, …).

**Sintassi supportata**

* Operatori `+ - * / ^` e la concatenazione `&`; precedenza matematica standard
  (`=2^3^2` → 512, `=-2^2` → −4).
* Parentesi: `=(1+2)*3` → 9.
* Riferimenti singoli `A1`, `B12`, `$A$1`, `CV100` e intervalli `A1:B5`, `A1:CV100`,
  `A:C`, `1:5`.
* Confronti `= <> < > <= >=` (usati dai criteri condizionali).
* Costanti di errore `#DIV/0!`, `#VALORE!`, `#RIF!`, `#NOME?`, `#N/D`.
* Testo: `"ciao"` (con `""` per le virgolette interne). Separatore degli argomenti `;`
  (accettato anche `,`), separatore decimale `.` (accettata anche la virgola nei numeri).

**Errori gestiti**

| Errore | Causa |
|---|---|
| `#DIV/0!` | divisione per zero |
| `#VALORE!` | testo non numerico in un'operazione, argomenti errati, sintassi non valida |
| `#RIF!` | riferimento fuori griglia **o riferimento circolare** |
| `#NOME?` | funzione sconosciuta |
| `#NUM!` | dominio non valido (radice di un negativo, potenza non intera…) |

I **riferimenti circolari** sono rilevati durante la valutazione (pila di valutazione) e
mostrati come `#RIF!` con il percorso del ciclo nella barra di stato
(es. `Riferimento circolare: A1 → B1 → A1`).

---

## 4. Architettura

```
src/
├── main.js                 bootstrap: mount, SW, prompt d'installazione, rete
├── App.svelte              composizione (titlebar, ribbon, formula bar, griglia, status bar)
├── app.css                 Pico.css + temi e stili dell'applicazione
├── lib/
│   ├── coordinates.js      A1 ↔ indici, colonne A…CV, rettangoli
│   ├── tokenizer.js        lexer delle formule (scritto da zero)
│   ├── parser.js           parser ricorsivo discendente → AST (scritto da zero)
│   ├── values.js           tipi di valore, coercizioni, formattazione numerica
│   ├── functions.js        registro delle 45 funzioni + matcher dei criteri
│   ├── engine.js           motore di calcolo, grafo delle dipendenze, ricalcolo
│   ├── formulaTransform.js riscrittura dei riferimenti a seguito di insert/delete
│   ├── storage.js          localStorage, CSV import/export, download
│   ├── ai.js               assistente offline (+ connettore online opzionale)
│   └── sheet.svelte.js     store reattivo (runes), storico undo/redo
└── components/
    ├── Ribbon.svelte       ribbon a 5 schede con gruppi di comandi
    ├── FormulaBar.svelte   name box + fx + input
    ├── SheetGrid.svelte    griglia virtualizzata + editor inline
    ├── StatusBar.svelte    statistiche della selezione e stato dell'app
    ├── AiPanel.svelte      pannello assistente AI
    ├── HelpModal.svelte    guida funzioni e scorciatoie
    └── Icon.svelte         icone SVG inline
```

**Il motore non conosce Svelte.** `engine.js` è JavaScript puro, testabile con Vitest senza
browser; `sheet.svelte.js` fa da ponte tra il motore e la UI.

---

## 5. Strategia di virtualizzazione

La griglia contiene **10.000 celle**, ma **non vengono mai create 10.000 elementi DOM**.

1. **Finestra visibile.** Da `scrollTop`/`scrollLeft` si calcolano la prima e l'ultima
   riga/colonna visibili, con un margine di **overscan di 4 celle** per evitare lo
   "scrolling a scatti" quando il puntatore si muove veloce.
2. **Solo la finestra viene renderizzata.** In una griglia 1440 × 900 restano nel DOM
   **~340–430 celle** (misurati: 336 su viewport 1223 × 438). Il resto non esiste.
3. **Posizionamento assoluto.** Le celle sono `position:absolute` dentro un *canvas* che
   misura l'intera griglia (10.400 × 2.600 px): le scrollbar restano corrette, ma il layout
   non viene mai ricalcolato per le celle fuori vista.
4. **Intestazioni separate.** Le intestazioni di colonna e di riga vivono in due contenitori
   separati con `overflow:hidden`, sincronizzati con `scrollLeft`/`scrollTop` del corpo
   griglia: niente header "sticky" fragili, nessun `position:sticky` dentro il contenitore
   scorrevole.
5. **Invalidazione fine-grained.** Il motore non è reattivo; quando cambia qualcosa
   incrementa un contatore `revision`. I componenti che dipendono dai valori delle celle
   (`$derived.by`) ricalcolano **solo la finestra visibile** (≈400 elementi), non il foglio
   intero.
6. **Nessun layout-thrash.** Le celle usano `contain: strict`; i formattatori
   `Intl.NumberFormat` sono **memoizzati** (crearne uno per cella costava decine di ms).

**Alternative valutate**

| Strategia | Perché non scelta |
|---|---|
| 10.000 `<div>` (o `<td>`) nel DOM | ~10.000 nodi: creazione e layout troppo lenti, memoria elevata |
| `content-visibility: auto` | da solo non basta: il browser deve comunque costruire il DOM di 10.000 celle |
| Canvas 2D | ottimo per la resa, ma rende impossibile l'editing accessibile (il testo non è selezionabile) e l'overlay dell'editor |
| Tabella HTML virtualizzata | più semplice da collegare al layout, ma gli elementi `table`/`td` hanno un box model rigido: peggio per il posizionamento a scorrimento libero |

**Misure** (Chromium, viewport 1440 × 900)

| Operazione | Tempo |
|---|---|
| Lavoro di un passo di scroll (handler + layout) | **0,047 ms** medio / 0,2 ms max |
| Ricalcolo di 100 formule dipendenti | **0,3 ms** |
| Aggiornamento completo fino al DOM (100 dipendenze) | **16 ms** (richiesta: < 300 ms) |
| Nodi DOM della griglia | ~340–430 (su 10.000 celle) |
| Bundle gzip | **118 kB** totali (JS 104 kB + CSS 13 kB) |

---

## 6. Motore di calcolo

Il motore è una pipeline in tre fasi, tutta scritta da zero.

```
"=SOMMA(A1:A5)*2"
        │
        ▼
   tokenizer.js   →  [FUNC "SOMMA"] [LPAREN] [CELL A1] [COLON] [CELL A5] [RPAREN] [OP *] [NUMBER 2]
        │
        ▼
   parser.js      →  AST: { type:'binop', op:'*',
        │                   left:{ type:'func', name:'SOMMA', args:[range A1:A5] },
        │                   right:{ type:'number', value:2 } }
        ▼
   engine.js      →  15  (valutazione ricorsiva con memoizzazione)
```

* **Lexer** (`tokenizer.js`): numeri, testi, errori, riferimenti cella (`A1`, `$A$1`),
  identificatori, operatori, separatori. Distingue `SOMMA(` (funzione) da `A1` (riferimento)
  e `A:C` (intervallo di colonna).
* **Parser** (`parser.js`): parser **ricorsivo discendente** con i livelli
  `comparison → concat → additive → multiplicative → unary → power → postfix → primary`.
  L'argomento unario ha precedenza più bassa di `^` (come in matematica).
* **Evaluator** (`engine.js`): valutazione ricorsiva dell'AST con **memoizzazione per
  passata di ricalcolo**. Gli errori (`SpreadsheetError`) si propagano come valori, quindi
  `=A1/0` dentro `=SOMMA(A1:A5)` restituisce `#DIV/0!` senza interrompere il calcolo.
* **Criteri condizionali**: `">5"`, `"<3"`, `"=5"`, `"<>5"`, `"testo"`, `"pro*"` (jolly `*` e `?`),
  confronto case-insensitive.

**Coercizioni** (stile Excel): cella vuota → `0` in aritmetica e `""` nella concatenazione;
testo numerico → convertito; testo non numerico → `#VALORE!`; nelle matrici il testo e i
booleani sono **ignorati** dalle funzioni aggreghe (mentre un argomento testuale diretto
produce `#VALORE!`).

---

## 7. Gestione delle dipendenze

Il ricalcolo è **incrementale** e ibrido (push + pull):

1. **Push — chi dipende dalla cella modificata?**
   Ogni formula registra i **rettangoli** che cita (celle singole incluse). Le formule sono
   indicizzate in una **griglia spaziale a blocchi 10 × 10**: la ricerca dei dipendenti di una
   cella tocca solo i blocchi che la contengono, ed è O(1) per cella.
   * Con 10.000 celle e una sola modifica il costo è trascurabile.
   * Un intervallo enorme (`A1:CV100`) non crea 10.000 voci: viene memorizzato come
     rettangolo e occupa una sola voce per blocco.
2. **Pull — ricalcolo dei valori.**
   Le celle influenzate vengono ricalcolate **in modo ricorsivo** con memoizzazione: quando
   la cella X dipende da Y e Y è stata modificata, il valore di Y viene ricalcolato *mentre*
   si valuta X. Il risultato è che si ricalcola **solo il sottoalbero necessario**.
3. **Cicli.** La pila di valutazione (`stack`) rende il rilevamento dei riferimenti
   circolari naturale: quando si incontra una cella già in valutazione, il ciclo viene
   marcato e tutte le celle coinvolte ricevono `#RIF!` con il percorso del ciclo.
4. **Il motore è "push-pull" per scelta**: il *push* serve a sapere *cosa* ricalcolare (ed è
   quello che rende efficiente il caso "100 dipendenze"), il *pull* rende gratuiti il
   rilevamento dei cicli e l'ordine di valutazione (non serve un ordinamento topologico
   esplicito).

**Undo/redo.** Ogni modifica è registrata come azione invertibile (celle, stili o snapshot
per le operazioni strutturali). Lo storico è limitato a 100 azioni.

---

## 8. Risultati dei casi di test

### 8.1 Test automatici (`npm test`)

```
✓ tests/engine.test.js (17 test)
  ✓ motore di calcolo - casi di test obbligatori
  ✓ operatori e precedenza
  ✓ funzioni
  ✓ ricalcolo incrementale e dipendenze
  ✓ inserimento / eliminazione righe e colonne
✓ tests/lib.test.js (20 test)
  ✓ coordinate, tokenizer, parser, trasformazione formule
  ✓ assistente AI offline, CSV, registro funzioni
```

### 8.2 Casi di test richiesti dalla traccia

| # | Caso | Risultato atteso | Risultato ottenuto | Stato |
|---|---|---|---|---|
| 1 | `A1=5`, `A2=10`, `A3==SOMMA(A1:A2)` | `15` | `15` | ✅ |
| 2 | `B1=0`, `B2==A1/B1` | `#DIV/0!` | `#DIV/0!` (con dettaglio "Divisione per zero") | ✅ |
| 3 | `C1==C1` | errore di riferimento circolare | `#RIF!` — dettaglio `Riferimento circolare: C1 → C1` | ✅ |
| 4 | `D1==CONTA.SE(A1:A10;">5")` con valori misti | conteggio corretto | `6` su `[10,3,7,5,20,"testo",6,1,9,11]` | ✅ |
| 5 | `E1==SOMMA(A1:CV100)` su griglia vuota | `0`, nessun crash | `0`, nessun crash | ✅ |
| 6 | Scorrimento riga 1 → 100 e ritorno | nessun lag percepibile | 0,047 ms per passo di scroll, ~400 nodi DOM | ✅ |
| 7 | Modifica di una cella con 100 dipendenze | aggiornamento < 300 ms | **16 ms** fino al DOM (0,3 ms di calcolo puro) | ✅ |
| 8 | Disattivazione rete → ricarica | l'app funziona offline | ricarica completa da cache, griglia e ribbon operativi | ✅ |
| 9 | URL pubblico in finestra anonima | app funzionante, installabile, offline | ✅ (vedi §2) | ✅ |
| 10 | Verifica percorsi | nessun errore 404 in console | nessun 404; tutte le risorse in precache | ✅ |

### 8.3 Test manuali aggiuntivi

| Scenario | Esito |
|---|---|
| `=1+2*3` → 7, `=(1+2)*3` → 9, `=2^3^2` → 512, `=-2^2` → −4, `=10%` → 0,1 | ✅ |
| `=A1` dove A1 contiene testo | ✅ restituisce il testo |
| `=SOMMA(A1:A5)` con testo nella matrice | ✅ il testo è ignorato |
| `=PIPPO(1)` (funzione inesistente) | ✅ `#NOME?` |
| `=A1+1` con A1 testuale | ✅ `#VALORE!` |
| Inserimento riga: `=SOMMA(A1:A2)` → `=SOMMA(A2:A3)`, valore invariato | ✅ |
| Eliminazione riga referenziata | ✅ `#RIF!` |
| Selezione rettangolare A2:C5 | ✅ statistiche `SOMMA/MEDIA/MIN/MAX` corrette |
| Assistente AI: «somma A1:A2» | ✅ genera `=SOMMA(A1:A2)` |
| Assistente AI: «Spiega» | ✅ struttura passo-passo della formula |
| Modalità offline: reload con rete disattivata | ✅ app completa, interattiva |

---

## 9. Funzionalità extra

* **Assistente AI locale** (scheda *AI*): genera formule da linguaggio naturale
  («somma A1:A10», «conta i valori maggiori di 5 in B2:B20», «se A1 è maggiore di 10 allora 1
  altrimenti 0»), spiega la formula della cella selezionata (struttura ad albero),
  suggerisce formule contestuali, propone **refactoring** (`=A1+A2+A3` → `=SOMMA(A1:A3)`) e
  **analizza il foglio** (errori, riferimenti circolari, funzioni usate).
  *Tutto in locale: nessun dato viene inviato a server esterni.*
* **Connettore AI online opzionale**: si può indicare un endpoint compatibile con OpenAI e
  una chiave API. È **disattivato di default**, parte **solo** premendo «Invia» ed è
  esplicitamente segnalato all'utente (la chiave resta nel `localStorage` del browser).
* **Salvataggio automatico** su `localStorage` (con debounce) e ripristino automatico al
  riavvio.
* **Import/export CSV** (separatore `;` rilevato automaticamente, virgolette gestite).
* **Undo/redo** con 100 livelli.
* **Tema chiaro/scuro**, installazione come app, prompt di installazione integrato.
* **45 funzioni** (oltre alle 8 richieste), alias inglesi, criteri con jolly `*`/`?`.
* **Inserimento/eliminazione di righe e colonne** con traslazione dei riferimenti.
* **Guida in-app** con l'elenco completo delle funzioni e delle scorciatoie.

---

## 10. Difficoltà incontrate e come sono state risolte

| Difficoltà | Soluzione adottata |
|---|---|
| **Riferimenti circolari** con un evaluator ricorsivo: rischio di loop infinito | pila di valutazione: se la cella è già in valutazione il ciclo viene marcato e tutte le celle coinvolte ricevono `#RIF!` con il percorso |
| **Ricalcolo di 10.000 celle a ogni t keystroke** | grafo delle dipendenze con indice spaziale a blocchi + ricalcolo pull con memoizzazione: 100 dipendenze si aggiornano in 0,3 ms |
| **Intervalli enormi** (`A1:CV100` = 10.000 celle) che avrebbero gonfiato il grafo | i riferimenti sono memorizzati come **rettangoli**, non come elenco di celle: l'indice a blocchi ne mantiene il costo costante |
| **Parser ambigui**: `LOG10` è una cella o una funzione? `A1:B5` è un intervallo | il lexer distingue in base al carattere successivo (`(` ⇒ funzione) e all'espressione regolare; `A:C` e `1:5` sono supportati come intervalli di colonna/riga |
| **Virgolette e separatori ambigui** (`;` vs `,` vs `.` decimale) | il lexer accetta `;` e `,` come separatori di argomenti e `.`/`,` come separatore decimale nei numeri; i testi tra virgolette non sono mai toccati |
| **Formattazione dei numeri**: creare un `Intl.NumberFormat` per ogni cella costava decine di ms | formatter **memoizzati** per formato (`values.js`) |
| **Reattività su 10.000 celle** (Svelte proxy deep = lento) | il motore resta non reattivo; un contatore `revision` invalida solo la finestra visibile |
| **UI bloccata perché il motore non notificava le modifiche** (la barra di stato restava ferma dopo il ripristino da `localStorage`) | il store si è sottoscritto a `engine.onChange`: ogni modifica del motore invalida la UI (`sheet.svelte.js`) |
| **Percorsi assoluti = PWA rotta su GitHub Pages** | `base: './'` in Vite, `start_url`/`scope`/`icon` relativi nel manifest, `register('./sw.js', {scope:'./'})` |
| **Service worker che non metteva in cache i bundle con hash** | un plugin Vite (`swPrecacheManifest`) inietta nel `sw.js` l'elenco reale dei file prodotti al build; il nome della cache cambia a ogni build, così le cache obsolete vengono eliminate |
| **Offline "semi funzionante"**: con il server giù la navigazione restituiva un errore 502 invece della copia in cache | il gestore `fetch` del SW usa la copia in cache **anche** quando la rete risponde con un errore HTTP, non solo quando la rete è assente |
| **Service worker in sviluppo**: il placeholder del manifest non è un JSON valido → SW non installabile | il placeholder è racchiuso in un `JSON.parse` dentro un `try/catch`: in sviluppo la precache è ridotta all'application shell, in produzione è completa |
| **Icone PNG senza librerie di imaging** | generatore di icone scritto da zero (`scripts/generate-icons.mjs`): disegna su buffer RGBA e serializza in PNG con un encoder minimale basato su `zlib` |

---

## 11. Domande di riflessione

**1. Quale parte del codice hai scritto tu e quale è stata generata dall'AI? Come hai
verificato la correttezza?**
L'AI ha generato la maggior parte del codice (parser, motore, componenti Svelte, CSS,
service worker). La *verifica* è stata interamente nostra e automatizzata: 17 test unitari
del motore (`npm test`) che coprono i 5 casi obbligatori della traccia, la precedenza degli
operatori, la gestione degli errori, il ricalcolo incrementale con 100 dipendenze e la
traslazione dei riferimenti a seguito di insert/delete righe. Ogni correzione è partita da
un test che falliva (per esempio il test `SOMMA.SE` ha rivelato che l'aspettativa era
sbagliata, non il codice; il test sulla trasformazione delle formule ha rivelato un doppio
parentesi nella ricostruzione testuale). I testi in UI (barra delle formule, scorciatoie,
selezione, pannello AI, offline) sono stati verificati pilotando davvero il browser.

**2. Quali prompt sono stati più efficaci? Perché?**
I più efficaci sono quelli che chiedevano una **struttura concettuale** e un **criterio di
scelta**, non il codice pronto: «come si struttura un parser di formule con precedenza
operatori?», «come implementare il rilevamento dei riferimenti circolari in un evaluator
ricorsivo?», «qual è l'alternativa a espandere ogni intervallo in una lista di celle?».
Fornivano scheletri verificabili che l'AI riempiva in modo coerente con il resto del
progetto. I prompt «scrivimi tutto» producevano codice plausibile ma con dettagli sbagliati
(separatori degli argomenti, precedenza unario/potenza, gestione dei jolly nei criteri).

**3. Cosa ha fatto l'AI che hai dovuto correggere? Perché?**
- Ha ricostruito la formula `=SOMMA(A1:A2)` come `=SOMMA((A2:A3)` dopo un inserimento di
  riga: la "(" veniva emessa due volte (dal token di funzione e dal token di parentesi).
- Ha prodotto `Intl.NumberFormat` **nuovo per ogni cella**: con ~400 celle visibili il
  rendering rallentava sensibilmente. Risolto memoizzando i formatter.
- Non ha collegato gli eventi del motore (`engine.onChange`) alla reattività: la UI
  «non sapeva» che il foglio era cambiato. Risolto sottoscrivendo il listener nello store.
- Ha usato percorsi assoluti per il service worker: corretto in `base: './'` + `scope: './'`.
- Nel ricalcolo iniziale la trasformazione delle formule non gestiva i riferimenti che
  diventano `#RIF!` dopo l'eliminazione di una riga.

**4. Quale strategia di virtualizzazione hai scelta e perché? Quali alternative hai
valutato?**
Finestra visibile calcolata da `scrollTop`/`scrollLeft` con overscan, celle posizionate in
modo assoluto dentro un canvas dimensionato come l'intera griglia, intestazioni in
contenitori separati sincronizzati a mano. Ho valutato (e scartato) il rendering di tutte le
10.000 celle, `content-visibility: auto` (da solo non evita di costruire il DOM), il Canvas 2D
(resa ottima, ma editing e accessibilità impossibili) e la tabella HTML virtualizzata
(box model rigido, scroll più scomodo).

**5. Come hai gestito le dipendenze tra celle per evitare ricalcoli inutili su 10.000 celle?**
Ogni formula registra i rettangoli che cita; un indice spaziale a blocchi 10 × 10 permette di
trovare in tempo costante le formule che dipendono dalla cella modificata. Il ricalcolo è poi
*pull*: le dipendenze vengono ricalcolate ricorsivamente con memoizzazione per passata.
Solo l'insieme influenzato viene ricalcolato — 100 dipendenze in 0,3 ms.

**6. Quale piattaforma hai scelto per il deploy e perché? Quali problemi hai incontrato?**
Entrambe: GitHub Pages con la workflow in `.github/workflows/deploy.yml` (build + test +
deploy automatico a ogni push) e Vercel con `vercel.json`. I problemi sono stati quasi
sempre gli stessi: **percorsi assoluti** (che su GitHub Pages cercano `sw.js` nella radice
del dominio invece che in `/<repo>/`) e **scope del service worker**. Entrambi risolti con
percorsi relativi ovunque. Un problema ulteriore, tipico del solo GitHub Pages: il
service worker deve servire una `index.html` valida **anche** quando il server risponde con
un errore (502): ora la gestione `fetch` ricade sulla copia in cache anche in quel caso.

**7. Come hai verificato che la PWA funzioni correttamente dall'URL pubblico e non solo in
locale?**
Con una finestra anonima e il DevTools: stato *activated and running* del service worker,
manifest senza errori, icone caricate, nessun 404 in console, modalità *Offline* del
DevTools con ricarica completa, e installazione dell'app dalla barra degli indirizzi.
In locale la verifica equivalente è stata automatizzata: il test offline è stato eseguito
**spegnendo il server** e ricaricando la pagina — l'app si è riavviata comunque dalla cache.

**8. Cosa cambieresti se dovessi rifare la prova?**
- Partirei dal test end-to-end prima della UI: scrivere per primi i test del motore e
  automatizzare i 10 casi della traccia in un unico comando.
- Implementerei da subito la selezione rettangolare e la copia/incolla: sono il 90%
  dell'esperienza d'uso di un foglio, e obbligano a progettare bene il modello delle celle.
- Documenterei subito la convenzione sugli argomenti (`;` e `.`): averla decisa a metà
  progetto ha costretto più di una rifinitura del parser.
- Valuterei di non usare `mathjs` per le sole funzioni matematiche di base: il bundle
  aggiunge ~58 kB gzip per un servizio che il `Math` nativo copre già.

---

## 12. Uso dell'AI

Il progetto è stato sviluppato con l'assistente AI come strumento di coppia: il codice è
stato generato dall'AI, la **verifica** e le **decisioni architetturali** sono state nostre.
Il diario completo (5+ prompt, risposte sintetizzate, modifiche manuali, almeno un prompt
sul deploy) è in **[AI_LOG.md](./AI_LOG.md)**.

---

## 13. Struttura del progetto

```
Tabelle_calcolo_GPOI/
├── index.html                 entry point (percorsi relativi, manifest, meta PWA)
├── vite.config.js             build config + plugin che genera la precache del SW
├── svelte.config.js
├── package.json
├── vercel.json                config di deploy per Vercel
├── public/
│   ├── manifest.json          manifest PWA (percorsi relativi)
│   ├── sw.js                  service worker (precache + strategie di cache)
│   └── icons/                 icon-192, icon-512, maskable, favicon.svg
├── scripts/
│   ├── generate-icons.mjs     generatore di icone PNG (senza librerie)
│   └── serve.mjs              server statico per la build
├── src/                       vedi §4
├── tests/
│   ├── engine.test.js        17 test unitari del motore
│   └── lib.test.js           20 test su coordinate, parser, AI, CSV
├── .github/workflows/deploy.yml
├── README.md
└── AI_LOG.md
```

---

## Licenza e crediti

Progetto didattico. Le uniche dipendenze di terze parti sono **Pico.css** (UI), **mathjs**
(funzioni matematiche) e **dayjs** (data e ora): il motore di calcolo, il parser delle
formule, la virtualizzazione, la persistenza e il service worker sono scritti da zero.
