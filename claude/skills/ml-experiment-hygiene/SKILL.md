---
name: ml-experiment-hygiene
description: Keep ML experiments reproducible and honest. Use when writing or editing a training/evaluation script or pipeline, adding experiment tracking (MLflow or ClearML), deciding what to log, splitting data, comparing models, or about to claim that a change improved a metric. Also use to decide what belongs in a notebook versus a script.
---

# ML experiment hygiene

Legend: **[V]** verified against the official docs via Context7 (Nov 2026); **[U]** not verified, check the
installed version's docs before relying on it.

## 1. Reproducibility first

- Seed `random`, `numpy`, `torch` (and CUDA, DataLoader workers) from **one** config value; log it.
- Keep every hyperparameter in one config (dict / dataclass / file), not scattered literals.
- Split once, deterministically (seed or hash of a stable key), **before** any fitted preprocessing; save the
  split (indices or ids) as an artifact. See `ml-debugging` for the leakage checks.
- Record what produced a result: git commit, data version/path + size or hash, key library versions.

## 2. Tracker: which one

- Default to **MLflow**. Use **ClearML** if the repo already imports `clearml`. Never log to both.
- Tracking calls belong in scripts and pipelines, not in exploratory notebook cells.

### MLflow

- Setup: `mlflow.set_tracking_uri(uri)`, `mlflow.set_experiment(name)`, then `with mlflow.start_run(run_name=...):` **[V]**.
- Params: `mlflow.log_param(k, v)`; metrics: `mlflow.log_metric(k, v)` or `mlflow.log_metrics({...}, step=epoch)` **[V]**.
- Tags for filtering: `mlflow.set_tags({...})` (e.g. dataset_version, model_family, git commit) **[V]**.
- Artifacts: `mlflow.log_artifact(path)` for a file or directory, `mlflow.log_figure(fig, "name.png")` for matplotlib
  figures **[V]**; `mlflow.log_artifacts(dir)` for a folder of files **[V, mentioned in a tutorial note]**.
- Models: `mlflow.sklearn.log_model(model, name="model")`. In current docs the argument is `name=`; older
  versions used `artifact_path=` **[V for name=; U for the exact version where it changed]**.
- Autolog: `mlflow.autolog()` for supported libraries, or per flavor `mlflow.pytorch.autolog()` /
  `mlflow.sklearn.autolog()` **[V]**. If you train with PyTorch but preprocess with scikit-learn, call
  `mlflow.sklearn.autolog(disable=True)` so only PyTorch is logged **[V]**. Autolog does not replace logging
  your seed, data version and split artifact.
- Hyperparameter search: one parent `start_run()` and children with `start_run(nested=True)` **[V]**.

### ClearML

- Initialize ClearML **before anything else** so its automatic hooks can track as much as possible:
  `task = Task.init(project_name=..., task_name=...)` **[V]**.
- Model upload: `output_uri=True` uploads saved models; otherwise only the local path is stored **[V]**.
- Hyperparameters: `cfg = task.connect(cfg_dict)` and **use the returned dict**: a remote run can override
  values **[V]**.
- Artifacts: `task.upload_artifact("name", artifact_object=obj)` **[V]**.
- Scalars: `task.get_logger()` then `Logger.report_scalar(...)` **[V that it exists; U for the argument order]**.
- In a notebook call `task.close()` yourself; in a script the task closes when the script ends **[V]**.

### What to log in every run (either tracker)

Params (incl. seed and split ids/ratio), data version, git commit; train / validation / test metrics **named
separately** with the step; the best checkpoint or model; the config file; the split indices; key plots
(learning curve, confusion matrix). Name runs so they can be told apart (`model-lr-seed`).

## 3. Notebook vs script

- **Notebooks:** EDA, quick checks, plots. Keep outputs out of version control (strip them, e.g. with `nbstripout`)
  **[U: tool name is from experience, not checked in this session]**.
- **Scripts / modules:** anything that trains, evaluates, builds features or ships. When a notebook cell becomes
  logic you rerun, move it to a `.py` function with a test (see `python-ml-tooling`), and import it back.
- No hidden state: a notebook must run top to bottom in a fresh kernel before its numbers are quoted.

## 4. Before saying "it improved"

Do not claim a gain until you have **rerun the metric after the change** and compared it with a baseline.

1. Same data split, same metric, same seed policy as the baseline; change one thing.
2. Rerun and read the actual number; quote it with the run id / command that produced it.
3. If the difference is small, repeat over several seeds and report mean ± spread, not one lucky run.
4. Check the trivial baseline (majority class / mean predictor / simple linear model) is still beaten.
5. Report only what you ran: if you did not rerun it, say "not verified".
