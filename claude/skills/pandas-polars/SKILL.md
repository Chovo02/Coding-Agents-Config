---
name: pandas-polars
description: Choose and write pandas or Polars code for ML data work. Use when loading, cleaning, transforming, joining or aggregating tabular data (CSV, Parquet, DataFrames), converting between pandas, Polars, NumPy, scikit-learn and PyTorch, or translating pandas to Polars. Not for Polars Cloud or distributed workloads.
---

# pandas vs Polars for ML work

## Which one to use

| Context | Use |
|---|---|
| Scripts, pipelines, production-ready code | **Polars**, lazy API |
| Notebooks, EDA, quick experiments | **pandas** |
| A library requires one (scikit-learn, plotting, legacy code) | whatever it takes, converted **at the boundary** |

- Follow the project: if a file or module already uses one library, keep it. Do not mix both inside one
  transformation chain; convert once at the edges (`pl.from_pandas(pdf)`, `df.to_pandas()`, `df.to_numpy()`).
- Before writing an API call you are unsure of, check the installed version
  (`python -c "import polars as pl; print(pl.__version__)"`). Do not assume a pandas spelling exists in
  Polars: there is no index, no `iloc`, no `groupby` (it is `group_by`).
- Translating pandas → Polars: rewrite in expressions, do not transliterate method by method.

## Polars rules (scripts / pipelines)

- **Lazy by default:** `pl.scan_csv/parquet(...)` or `df.lazy()`, build the whole query, one `.collect()` at
  the end. Do not collect intermediate results.
- **Expressions, not Python functions:** avoid `map_elements`/`map_batches` unless no expression exists; a
  `PolarsInefficientMapWarning` names the fix, so apply it instead of silencing the warning.
- **Filter early,** before `group_by`, `join` and `with_columns`. Put all new columns in one `with_columns`.
- **Strict typing:** cast explicitly (`.cast(pl.Float64, strict=False)` to turn bad values into nulls); parse
  dates with `str.to_date()` / `str.to_datetime()`, not `.cast()`.
- **Dirty files:** handle nulls and dates at the scan, e.g. `pl.scan_csv(p, null_values=["N/A", ""],
  try_parse_dates=True)`; inspect with `lf.collect_schema()` instead of guessing column names or dtypes.

### Polars gotchas

- Literals in `then()`/`otherwise()` must be `pl.lit("x")`; a bare string is read as a column name.
- Comparisons with null drop the row silently; keep nulls explicitly with `| pl.col("v").is_null()`.
- Combine conditions with `&`, `|`, `~` and parentheses around each condition (not `and`/`or`).
- A bare aggregation in `with_columns` broadcasts the global value; per-group needs `.over("group")`.
- Joins and `group_by` do not keep row order: `.sort()` when order matters, or `maintain_order=`.
- Rows with null join keys drop from inner joins unless `nulls_equal=True`.
- Regex column selection needs anchors: `pl.col("^sales_.*$")`.

## pandas rules (notebooks / EDA)

- Vectorized operations over `apply`/row loops; select with `.loc[...]`, never chained indexing.
- Call `.copy()` when you will mutate a slice; avoid `inplace=True`.
- Check `df.shape`, `df.dtypes`, `df.isna().mean()` and `df["target"].value_counts(normalize=True)` before
  modeling. Keep notebook logic that must reach production for a script (see `ml-experiment-hygiene`).

## Leakage-safe data handling (both libraries)

- Split **first** (train / validation / test; group- or time-aware if the data needs it), then compute any
  statistic (mean, std, category set, imputation value, target encoding) **on train only** and apply it to the
  others. Prefer an sklearn `Pipeline` / `ColumnTransformer` so this is enforced by construction.
- Do not shuffle time series; do not aggregate over the full dataset before splitting (`.over()`,
  `groupby().transform()` on all rows leaks the test rows into train features).
- Make splits reproducible: fixed seed, saved split indices or a deterministic hash on a stable key.
- After joins, assert row counts and key uniqueness so a many-to-many join cannot silently duplicate rows
  across splits.

## Boundaries with scikit-learn and PyTorch

- scikit-learn: pass `df.to_pandas()` or `df.to_numpy()` at the last step of the Polars pipeline; keep column
  order fixed and save the feature list with the model.
- PyTorch: convert once to tensors (`torch.from_numpy(df.to_numpy())`) and check dtype (`float32` features,
  `long` class labels); do not build tensors row by row inside the `Dataset.__getitem__` from a DataFrame.
