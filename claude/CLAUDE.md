# Uso di skill e plugin

## Conflitti: quale skill scegliere
- **Grill**: `grill-me` per stress-test di un piano. `grill-me-pro` (revisione Codex) SOLO se lo chiedo
  esplicitamente: è lenta e costosa. Su piani ad alto rischio (auth, schema DB, migrazioni, pagamenti,
  concorrenza) puoi proporla in una riga, mai avviarla.
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
