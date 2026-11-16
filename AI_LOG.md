# AI_LOG — diario dell'uso dell'AI

> Registro di come l'AI è stato usato durante lo sviluppo di **Mini-Foglio di Calcolo — PWA**.
>
> **Regola seguita:** l'AI scrive il codice, **noi decidiamo l'architettura, verifichiamo il
> risultato e correggiamo**. Ogni risposta dell'AI è stata ricontrollata con test automatici
> (`npm test`) o con il browser reale (Chrome), mai accettata così com'è.
>
> Sintesi: **8 prompt**, di cui **2 dedicati al deploy/pubblicazione** e **1 al debug**.

---

## Prompt 1 — Struttura del parser delle formule

> **Prompt**
> *"Sto scrivendo da zero il motore di un foglio di calcolo: il parsing delle formule deve
> essere mio (niente librerie). Qual è la struttura consigliata per un parser di formule con
> supporto a: riferimenti `A1`, intervalli `A1:B5`, funzioni con argomenti separati da `;`,
> operatori `+ - * /` con precedenza matematica e parentesi? Mi interessa la **grammatica** e
> l'ordine dei livelli, non il codice. Inoltre: come gestisci l'ambiguità tra un riferimento
> cella (`A1`) e un nome di funzione (`SOMMA`)?"*

**Risposta sintetica dell'AI**

Ha proposto un **parser ricorsivo discendente** con una grammatica a livelli, dal più basso al
più alto: `confronto → concatenazione → addizione → moltiplicazione → unario → potenza →
postfisso → primario`. Ha spiegato che il livello "unario" deve stare *sotto* quello della
potenza per avere la precedenza matematica standard (`-2^2 = -4`, non `4`). Per l'ambiguità ha
suggerito di risolverla **nel lexer**: se il token identificatore è immediatamente seguito da
`(` è una funzione, altrimenti un riferimento; gli intervalli si riconoscono come
`RIFERIMENTO ':' RIFERIMENTO` a livello di parser. Ha infine consigliato di costruire l'AST
e di tenere l'evaluator separato dal parser.

**Cosa abbiamo modificato / adattato**

- Adottata la grammatica, ma con una differenza: il livello unario è stato collocato **sopra**
  il/moltiplicativo e **sotto** la potenza, con il potere implementato come
  `parsePower → parsePostfix` e il segno in `parseUnary`, in modo che `-2^2` dia `-4` e
  `2^-3` sia valido.
- Aggiunto il supporto per gli **intervalli di colonna** (`A:C`) e di **riga** (`1:5`), che
  l'AI non aveva previsto: il lexer produce un token `WORD` per `A` e il parser lo
  interpreta come colonna quando trova `:`.
- Aggiunto il token `ERROR` per le costanti `#DIV/0!`, `#VALORE!`, `#RIF!`, `#NOME?`.
- Aggiunto l'operatore di concatenazione `&` e i confronti `= <> < > <= >=` (necessari per i
  criteri condizionali).
- Scelta deliberata: gli argomenti sono separati da **`;`** (convenzione italiana della
  traccia) con `,` accettato come alternativa; il separatore decimale è `.` (la `,` viene
  comunque accettata nei numeri).

---

## Prompt 2 — Riferimenti circolari in un evaluator

> **Prompt**
> *"Il mio evaluator è ricorsivo: quando valuto `=A1+1` risolvo il valore di A1, che a sua
> volta può essere una formula. Come rilevo in modo affidabile i **riferimenti circolari**
> (`A1 = =A1` o `A1 → B1 → A1`) senza mandare in loop infinito? Ho letto di due approcci:
> grafo delle dipendenze con ordinamento topologico, oppure colorazione di grafi durante la
> DFS. Quale conviene per una griglia piccola (100×100) con ricalcolo **incrementale**? E
> come faccio a propagare gli errori (`#DIV/0!`) senza interrompere il calcolo?"*

**Risposta sintetica dell'AI**

Ha descritto i due approcci classici (rilevamento cicli di Tarjan con colorazione
bianco/grigio/nero; oppure controllo del "in progresso" durante la DFS) e ha sottolineato che
in entrambi i casi serve una **memoizzazione** per non ricalcolare gli stessi nodi.
Ha raccomandato, per un evaluator che risolve le celle "su richiesta", l'uso di una **pila di
valutazione**: se una cella è già nella pila, si è in un ciclo. Per gli errori ha suggerito di
modellarli come **valori** (non eccezioni) così che si propaghino naturalmente e si possa
usare `SE.ERRORE` per intercettarli.

**Cosa abbiamo modificato / adattato**

- Implementata la **pila di valutazione** (`stack` in `engine.js`): la soluzione più semplice
  e coerente con l'evaluator "pull" che avevamo scelto.
- Aggiunto il dettaglio del ciclo nella barra di stato (`Riferimento circolare: A1 → B1 → A1`),
  che l'AI non aveva previsto: senza il percorso l'utente non capisce *dove* è il ciclo.
- Gli errori sono diventati un tipo `SpreadsheetError` con `code`, `detail` e un flag
  `circular`: quest'ultimo permette di distinguere un riferimento circolare (`#RIF!` con
  dettaglio) da un riferimento fuori griglia.
- **Non** abbiamo implementato Tarjan: con la pila non serve un secondo algoritmo, e
  l'errore "circolare" viene propagato alle celle dipendenti come in Excel.
- Le funzioni con valutazione pigra (`SE`, `SE.ERRORE`, `ÈERRORE`) sono state aggiunte in
  seguito per evitare che il ramo non preso venga valutato (cortocircuito).

---

## Prompt 3 — Strategia di virtualizzazione della griglia

> **Prompt**
> *"La griglia ha 100 righe × 100 colonne = 10.000 celle e deve restare fluida durante lo
> scorrimento. Voglio **virtualizzarla**: nel DOM solo le celle visibili. Quale strategia
> consigli fra: (a) 10.000 `div` con `content-visibility:auto`, (b) finestra visibile calcolata
> da `scrollTop`/`scrollLeft` con rendering solo di quella, (c) Canvas 2D, (d) tabella HTML
> virtualizzata? Come gestisco le **intestazioni** (colonne A…CV e righe 1…100) che devono
> restare fisse durante lo scorrimento? E come faccio a non far "scattare" il rendering
> quando ci si muove velocemente?"*

**Risposta sintetica dell'AI**

Ha indicato **(b)** come la scelta corretta per una griglia di questo tipo, spiegando che
`content-visibility:auto` non basta (il DOM di 10.000 celle viene comunque costruito) e che
il Canvas 2D, pur essendo veloce, preclude l'editing accessibile. Per le intestazioni ha
proposto o `position: sticky` oppure — soluzione più robusta — **contenitori separati** con
`overflow:hidden` sincronizzati programmaticamente con lo scroll del corpo. Per evitare gli
scatti ha consigliato un **overscan** di alcune righe/colonne e di aggiornare la finestra in
modo incrementale.

**Cosa abbiamo modificato / adattato**

- Adottata la finestra visibile con **overscan di 4 celle** e posizionamento **assoluto** delle
  celle dentro un canvas che misura l'intera griglia (altrimenti le scrollbar non
  corrisponderebbero ai dati).
- Adottate le **intestazioni in contenitori separati** con `overflow:hidden` e
  sincronizzazione manuale (`colHeadEl.scrollLeft = bodyEl.scrollLeft`): `position:sticky`
  dentro un contenitore con figli posizionati in modo assoluto si era rivelato fragile.
- Aggiunto un **overlay** per il bordo della selezione multipla (un solo elemento assoluto al
  posto di bordi su ogni cella).
- Sostituita la griglia "a cascata" con una griglia CSS a 4 aree
  (`corner | intestazione colonne / intestazione righe | corpo`), con la griglia reale in
  `position:absolute`.
- Misurata l'effettiva consistenza del DOM: **~340–430 celle** invece di 10.000.

---

## Prompt 4 — Dipendenze fra celle e costo degli intervalli enormi

> **Prompt**
> *"Devo ricalcolare solo le celle che dipendono da quella appena modificata. Se creo il
> grafo espandendo ogni intervallo in una lista di celle, una formula come
> `=SOMMA(A1:CV100)` da sola mi crea 10.000 archi — e se l'utente ne scrive 100, il grafo
> esplode. Esiste un modo per rappresentare gli intervalli in modo compatto e trovare comunque
> velocemente «quali formule dipendono dalla cella (r,c) che ho appena modificato»? Sto
> usando JavaScript puro, niente librerie di grafi."*

**Risposta sintetica dell'AI**

Ha proposto di **non espandere** gli intervalli ma di memorizzarli come rettangoli e di usare
un **indice spaziale**: le celle vengono raggruppate in blocchi (per esempio 10 × 10) e ogni
formula viene registrata nei blocchi che interseca; per trovare i dipendenti di una cella si
consulta solo il blocco che la contiene e si verifica la contuità rettangolare. Ha anche
suggerito, in alternativa, un interval tree, giudicato però overkill per 100 × 100.

**Cosa abbiamo modificato / adattato**

- Implementato l'**indice a blocchi 10 × 10** (`blockIndex` in `engine.js`): la registrazione
  di una formula avviene nei blocchi intersecati, la ricerca dei dipendenti guarda **solo** il
  blocco della cella modificata.
- Il controllo finale è fatto confrontando la cella con il **rettangolo** della formula: il
  blocco è solo un acceleratore, la correttezza dipende dal rettangolo.
- Aggiunto un **secondo livello di ricalcolo "pull"** (l'AI non l'aveva distinto dal
  "push"): il *push* serve a sapere *cosa* ricalcolare, il *pull* (memoizzazione per passata)
  a calcolare i valori senza dover mantenere un ordinamento topologico esplicito.
- Verifica: 100 dipendenze si aggiornano in **0,3 ms**; l'intervallo `A1:CV100` occupa una
  sola voce per blocco (100 voci, non 10.000 celle).

---

## Prompt 5 — Prestazioni di rendering e reattività in Svelte

> **Prompt**
> *"Due problemi di prestazioni con Svelte 5: (1) creo un `new Intl.NumberFormat('it-IT', …)`
> per ogni cella visibile (~400) a ogni render: il rendering rallenta; (2) ho 10.000 celle
> in una `Map` e la UI deve aggiornarsi quando il motore ricalcola. Se metto la `Map` in un
> `$state` profondo di Svelte il proxy è lentissimo. Come strutturare il codice per avere
> una UI reattiva ma senza proxy profondi su 10.000 elementi?"*

**Risposta sintetica dell'AI**

Ha proposto di **memoizzare i formatter** (una `Map` chiave → `Intl.NumberFormat`) e di
**separare il modello dalla UI**: il motore resta una struttura JavaScript normale e la
reattività viene introdotta solo dove serve, tramite un **contatore di versione** che la UI
legge dentro un `$derived`. Ha anche ricordato che in Svelte 5 gli oggetti in `$state` sono
proxy profondi e che per strutture grandi conviene usare `$state.raw` o tenere i dati fuori
dal reactivity system.

**Cosa abbiamo modificato / adattato**

- Memoizzati i formatter in `values.js` (chiave = opzioni serializzate) → il costo è passato
  da decine di millisecondi a trascurabile.
- Adottata la separazione **motore non reattivo / store reattivo**: `engine.js` è JavaScript
  puro (testabile con Vitest), `sheet.svelte.js` espone `revision`, `sel`, `editor`, … con le
  rune.
- Il contatore `revision` viene incrementato da `bump()` **e** da un listener su
  `engine.onChange` (aggiunto in un secondo momento: vedi Prompt 8).
- La finestra virtualizzata ricalcola i valori di **sole ~400 celle** a ogni invalidazione.

---

## Prompt 6 — Service worker: percorsi, scope e cache (problematico di deploy)

> **Prompt**
> *"Sto pubblicando una PWA su GitHub Pages, quindi l'app vive in
> `https://utente.github.io/<repo>/`. Ho letto che è l'errore più comune: usare
> `/sw.js` invece di `./sw.js` fa fallire il service worker, e il `manifest` deve avere
> `start_url: "./"` e `scope: "./"`. Oltre a questo, con Vite i bundle hanno un nome con
> hash: come faccio a mettere in cache i file giusti se non li conosco a priori? E come
> gestisco il fatto che in sviluppo non esiste alcun build?"*

**Risposta sintetica dell'AI**

Ha confermato il problema dei percorsi assoluti e spiegato che il `scope` del service worker
è determinato dalla **posizione del file `sw.js`** (salvo override con l'opzione `scope`),
per cui uno script in `/<repo>/sw.js` ottiene naturally scope `/<repo>/`. Per i bundle con
hash ha proposto due soluzioni: generare la lista dei file al build (un plugin Vite che
scrive un manifest JSON accanto allo `sw.js`) oppure usare la **runtime caching** (cache di
ogni risorsa man mano che viene richiesta). Ha infine ricordato che in sviluppo il
service worker va **disregistrato** perché può servire file vecchi.

**Cosa abbiamo modificato / adattato**

- Implementato un **plugin Vite** (`swPrecacheManifest` in `vite.config.js`): al termine del
  build legge la cartella `dist/`, genera l'elenco dei file e lo **inietta** nel
  `sw.js` sostituendo il placeholder `__PRECACHE_MANIFEST__`.
- Aggiunto un **hash di versione** nel nome della cache (`mini-sheet-<hash>`): a ogni build la
  cache cambia e le cache obsolete vengono eliminate dall'evento `activate`.
- Reso il placeholder **inerte in sviluppo**: è racchiuso in un `JSON.parse` dentro un
  `try/catch`, quindi in dev il SW si installa comunque (con la sola application shell) invece
  di fallire.
- Implementata la **runtime caching** come seconda linea di difesa: le risorse servite
  dalla cache vengono comunque aggiornate in background (*stale-while-revalidate*).
- Strategia per le navigazioni: **network-first** con fallback sulla copia in cache.

---

## Prompt 7 — Deploy: GitHub Pages e Vercel, e il "trucco" del 502 (problema di deploy)

> **Prompt**
> *"Ho la PWA quasi pronta e devo pubblicarla. La traccia suggerisce GitHub Pages (opzione A)
> oppure Vercel (opzione B). Vorrei capire: (1) con GitHub Pages conviene la cartella `/docs`
> o la root del repository? (2) Su Vercel la guida dice 'Build Command vuoto, Output Directory
> root', ma il mio progetto usa Vite e Svelte: devo davvero lasciare vuoti quei campi?
> (3) Come faccio a verificare che la PWA funzioni dall'URL pubblico e non solo in locale,
> tenendo conto che la cache del browser nasconde i problemi? (4) Se il sito èmomentaneamente
> giù (errore 502 dal server), la mia PWA installata deve ancora aprirsi: come gestisco
> l'evento `fetch` per la navigazione?"*

**Risposta sintetica dell'AI**

Ha chiarito che su GitHub Pages si può pubblicare dalla root oppure da `/docs` (in entrambi i
casi con `base: './'` funziona, perché il percorso è relativo). Per Vercel ha spiegato che
con un progetto che richiede un build il *preset* "Other" va comunque compilato:
l'unica differenza rispetto alla guida è che il comando di build non può essere vuoto e la
cartella di output è quella del build (`dist/`). Ha raccomandato di testare sempre in
**finestra anonima** e con il DevTools in modalità Offline. Sull'ultimo punto ha suggerito di
usare `cache.put` prima di rispondere e, in caso di errore di rete, di restituire la copia in
cache; ha però osservato che un `fetch` che **risponde** con un errore HTTP (502) non fa
scattare l'eccezione.

**Cosa abbiamo modificato / adattato**

- Scelto di supportare **entrambe** le piattaforme: workflow GitHub Actions per GitHub Pages
  (build + `npm test` + deploy automatico) e `vercel.json` per Vercel.
- Documentato apertamente nel README che, per uno stack Svelte + Vite, il *Build Command*
  **non** può essere vuoto e l'output è `dist/`: è la differenza rispetto alla traccia.
- Implementato il **caso del 502**: nel gestore `fetch` del service worker, se la risposta di
  rete non è `ok` (non solo se la rete è assente) si restituisce la copia in cache. Prima di
  questa modifica, con il server giù la navigazione restituiva la pagina di errore del proxy
  invece dell'app: il problema è stato individuato proprio spegnendo il server durante i
  test locali.
- Verificato offline **in modo oggettivo**: avvio dell'app → disattivazione della rete →
  ricarica della pagina → la griglia, il ribbon e la barra delle formule sono operativi.
- Verificata l'assenza di 404 e lo stato *activated* del service worker; il `manifest` è
  servito con `Cache-Control: no-cache` anche su Vercel (`vercel.json`).

---

## Prompt 8 — Refactoring e debug del codice generato

> **Prompt**
> *"Faccio un refactoring del progetto. Due problemi concreti: (1) la barra di stato mostra
> sempre «0 celle» e il tipo «Vuota» anche quando il foglio contiene dati, ma solo dopo aver
> modificato una cella il valore si aggiorna; (2) il `transformFormulaText` ricostruisce
> `=SOMMA(A1:A2)` come `=SOMMA((A2:A3)` dopo un inserimento di riga. Come sistemo il primo
> problema considerando che il motore di calcolo non e' reattivo e non deve diventarlo? E il
> secondo è un problema di tokenizzazione?"*

**Risposta sintetica dell'AI**

Sul primo punto ha spiegato che il contatore di revisione è la fonte di verità per la UI e
che, se il valore letto dal foglio non cambia ma la struttura cambia (per esempio dopo un
`fromJSON`), è normale che la UI resti indietro: la soluzione è far sì che **ogni**
modifica del motore emetta un evento. Sul secondo ha ipotizzato che la ricostruzione testuale
duplichi la parentesi di apertura, per esempio perché il token di funzione emette già `(` e
poi arriva anche il token di parentesi.

**Cosa abbiamo modificato / adattato**

- **Collegato il motore alla UI**: nello store è stato aggiunto
  `engine.onChange(() => { revision++ })`, così ogni mutazione del motore — inclusi
  `fromJSON`, `recalcAll`, `insertRows` — invalida la finestra visualizzata. È la modifica più
  importante fatta dopo il debugging: senza, il foglio ricaricato da `localStorage` restava
  "vecchio" nella barra di stato fino alla prima modifica manuale.
- Spostato `engine.cells.size` **dentro** il `$derived` della barra di stato: letto direttamente
  nel template non era osservato dal reactivity system.
- **Corretto il doppio paren**: nel lexer il token `FUNC` emette solo il nome della funzione;
  la `(` viene aggiunta dal token `LPAREN` successivo.
- Aggiunto un **test automatico** che copre proprio la traslazione dei riferimenti
  (`=SOMMA(A1:A2)` → `=SOMMA(A2:A3)` con valore invariato): il bug è stato trovato perché il
  test falliva, non perché lo si era notato a occhio.

---

## Riepilogo

| # | Tema | Tipo | Modifiche manuali/adattamenti |
|---|---|---|---|
| 1 | Grammatica del parser | concettuale | precedenza unario/potenza, intervalli di colonna e riga, costanti di errore, separatori |
| 2 | Riferimenti circolari | concettuale | pila di valutazione, dettaglio del ciclo, errori come valori, funzioni con valutazione pigra |
| 3 | Virtualizzazione | architettura | indice spaziale, overlay della selezione, griglia CSS a 4 aree |
| 4 | Grafo delle dipendenze | architettura | rettangoli + blocchi 10×10, ricalcolo pull con memoizzazione |
| 5 | Prestazioni Svelte | performance | formatter memoizzati, separazione motore/UI, contatore `revision` |
| 6 | Service worker | **deploy** | plugin Vite che inietta la precache, cache versionata, fallback in dev |
| 7 | Deploy GH Pages / Vercel | **deploy** | gestione del 502, `vercel.json`, workflow CI, verifica offline reale |
| 8 | Refactoring / debug | debugging | listener `engine.onChange`, doppio paren nel trasformatore, test di regressione |

**Cosa NON abbiamo delegato all'AI** (e perché):

* le **decisioni architetturali** (pull vs push, blocchi vs espansione, cache-first vs
  network-first) sono state prese da noi dopo aver valutato i costi reali del progetto;
* la **verifica** è sempre stata automatizzata o eseguita sul browser reale: nessuna
  funzionalità è stata data per buona sulla base della sola lettura del codice;
* il **refactoring finale** (naming, commenti in italiano, struttura dei file) è stato
  applicato manualmente per uniformità e per aderire alle richieste della traccia.
