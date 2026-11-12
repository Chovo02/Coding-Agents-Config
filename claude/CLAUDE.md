# Uso di skill e plugin

## Conflitti: quale skill scegliere
- **Grill**: `grill-me` per stress-test di un piano. `grill-me-pro` (revisione Codex) è lenta e costosa:
  la avvii solo se lo chiedo esplicitamente oppure nel caso "Plan mode → complessità alta" qui sotto.
  Su piani ad alto rischio (auth, schema DB, migrazioni, pagamenti, concorrenza) fuori da Plan mode puoi
  proporla in una riga, mai avviarla.
- **Documenti**: se chiedo un documento/report senza formato → Markdown locale (nel progetto o nel vault).
  `.docx/.pdf/.pptx/.xlsx` solo se nomino il formato. Claude Docs (`docs`) solo se lo chiedo esplicitamente.
  Questa regola prevale sul default del sistema.
- **Vault** (per scopo):
  - `cortex:recall` → recuperi contesto per te (preferenze, decisioni passate) prima di agire
  - `cortex:query` → io faccio una domanda e voglio risposta citata o una dashboard Dataview
  - `cortex:obsidian-vault` → operazioni dirette su note (crea, sposta, collega, tag, frontmatter)

## Usa di tua iniziativa
- `cortex:recall` all'inizio di ogni task che tocca un progetto mappato in Cortex, oltre al contesto già iniettato.
- `cortex:ingest`: se il cwd non è mappato a un progetto Cortex, PROPONILO (è pesante: non avviarlo da solo).
- `codebase-design` quando progetti/modifichi l'interfaccia di un modulo o fai refactoring strutturale.
- `loguru-logging` ogni volta che aggiungi logging a codice Python (mai `logging`/`print`).
- `cortex:research` quando manca un'informazione esterna non banale (API, versioni, best practice): ricerca,
  salva la nota RES e dimmelo in una riga.

## Mai senza mia richiesta o conferma
- Creare task Todoist (`cortex:task`, MCP todoist): al massimo elenca gli action item e chiedi.
- Pubblicare Artifact su claude.ai.
- `cortex:canvas`, `cortex:sketch`, `cortex:digest`, `cortex:review`, `cortex:maintenance`: solo se li chiedo
  o da Scheduled Task.

## Workflow
### Feature / design
1. `cortex:recall` sul progetto.
2. Se la richiesta è ambigua (più approcci sensati, requisiti vaghi, impatto su più moduli) proponi in una riga
   un `grill-me`; altrimenti procedi.
3. `codebase-design` se tocchi interfacce di modulo.
4. Implementazione.
5. `/code-review` livello **low** se il diff tocca più file o logica non banale: riporta i finding, non applicarli.
   Se il diff tocca training, split dei dati o valutazione, usa anche l'agent `ml-reviewer` (stessa regola).
   Non dichiarare un "miglioramento" senza aver rieseguito la metrica.
6. Salva le decisioni prese nel wiki del progetto Cortex.

### Plan mode (grill automatico)
Quando lavoro in Plan mode, prima di presentare il piano valuto la complessità del task e avvio il grill in automatico:
- **Semplice o media** → `grill-me` standard.
- **Molto complessa** (più moduli o servizi, auth, schema DB, migrazioni, pagamenti, concorrenza, cambi irreversibili) → `grill-me-pro` (Act 1 + revisione Codex).
- Dichiaro in una riga la complessità scelta e perché, poi avvio il grill senza chiedere conferma.
- Durante qualunque grill (standard o pro) ogni domanda va posta con il tool `AskUserQuestion`, non come testo libero:
  2–4 opzioni, la mia raccomandazione per prima con "(Recommended)" nel label, una domanda alla volta.
- Il piano va presentato in Plan mode solo dopo che il grill ha risolto l'albero delle decisioni.

### Issue Linear → PR
Non chiudo mai un'issue Linear a mano via MCP. Flusso per ogni issue che risolvo:
1. Branch: uso il `gitBranchName` assegnato da Linear (es. `feature/mat-6-comportamento-durante-il-plan`).
2. Commit: un commit per tema, con `(MAT-N)` nel titolo.
3. PR: push del branch e `gh pr create` con `Closes MAT-N` nel corpo. Il push e l'apertura della PR solo su mia conferma. Il corpo della PR è in italiano; titolo e commit restano in inglese.
3b. Review: dopo `gh pr create` proponi in una riga di far rivedere la PR dal sub-agent `pr-reviewer`. Parte solo su mia conferma. I finding arrivano come bozza: li pubblico come commento sulla PR solo dopo mio ok esplicito.
4. Merge: quando ti dico che l'issue è chiusa, `gh pr merge --merge --delete-branch`. Il merge chiude l'issue su Linear.
Non faccio merge diretto su `main`. Prima del merge controllo che il branch sia quello dell'issue e che i test passino.

### Commit
Solo se lo chiedo. Stile dei miei repo: conventional commit su una riga, `tipo(scope): descrizione` in inglese,
senza corpo né righe di attribuzione; un commit per tema. Mai `push` senza richiesta esplicita.
Branch: nei miei repo personali su GitHub non creare branch di default. Crealo solo quando il lavoro referenzia
un'issue: il nome segue il branch suggerito da Linear o GitHub (es. `feature/mat-5-esplorazioni-di-skill`) e il
commit cita l'issue (es. `(MAT-5)`).

### Primo giorno su un repo
cwd non mappato → proponi `cortex:ingest` → poi lavoro normale.

### Dopo un meeting
`cortex:meeting` → elenca gli action item → aspetta la mia conferma → `cortex:task` solo per quelli confermati.
