---
name: ml-debugging
description: Debug ML training and evaluation problems before proposing fixes. Use when a loss is NaN/inf or diverges, a model does not learn or plateaus, validation is suspiciously good or much worse than train, results are not reproducible, or a PyTorch / scikit-learn pipeline behaves unexpectedly.
---

# ML debugging

**No fixes without a root cause.** Change one thing at a time, state a hypothesis before each change, and never
stack fixes. If three fixes failed, stop and question the setup (data, objective, architecture) with the user.

## Process

1. **Reproduce and read.** Read the full error/warning and the metric curves. Fix the seed and get a run that
   fails the same way. If it is not reproducible, make it reproducible first (seeds, data order, workers).
2. **Shrink.** Smallest failing case: a handful of samples, one batch, CPU, `num_workers=0`.
3. **Check what changed.** `git diff`, new data, new dependency/CUDA/torch version, config changes.
4. **Instrument boundaries.** Log shapes, dtypes, ranges, NaN/inf counts and class balance at each stage
   (raw data → preprocessing → batch → model output → loss → metric). Find *where* it first goes wrong.
5. **One hypothesis, one minimal test.** "I think X because Y", change only X, compare against the baseline.
6. **Lock it in.** Add a small test that reproduces the bug (see `python-ml-tooling`), then fix the cause.

## Sanity checks to run first

- **Overfit one batch:** a model that cannot drive the loss to ~0 on 1–8 samples has a bug in model, loss,
  labels or optimizer step, not a tuning problem.
- **Initial loss:** for classification it should be ≈ `ln(num_classes)`; far off means wrong init, labels or loss.
- **Random-label / shuffled-label run:** performance must drop to chance; if not, there is leakage.
- **Trivial baseline:** compare against majority class / mean predictor / a linear model before trusting a gain.

## Symptom → likely causes

| Symptom | Check first |
|---|---|
| Loss NaN/inf | LR too high; `log(0)`/division by zero; unnormalized inputs; NaNs in data (`isfinite`); fp16 overflow (try fp32 or grad scaling); no gradient clipping |
| Loss does not decrease | Wrong LR; `optimizer.zero_grad()` missing/misplaced; `loss.backward()`/`step()` order; frozen params (`requires_grad`); labels misaligned with inputs; loss expects logits vs probabilities |
| Loss decreases, metric does not | Metric computed on wrong axis/threshold; argmax vs sigmoid; class imbalance; label encoding mismatch |
| Train ≫ validation | Overfitting; leakage on the *train* side only; augmentation applied to eval; train/val distribution shift |
| Validation too good | **Leakage** (see below); duplicates across splits; validation used for model selection and reporting |
| Results differ between runs | Unseeded RNG (python/numpy/torch/DataLoader workers); nondeterministic ops; data order; multi-GPU |
| Works on CPU, fails/slow on GPU | Tensors on different devices; dtype mismatch; OOM (batch size, `no_grad`, accumulating graphs via `loss` stored without `.item()`); CUDA errors → rerun with `CUDA_LAUNCH_BLOCKING=1` |

## Leakage hunt

- Preprocessing (scaling, imputation, encoding, feature selection, PCA, target encoding) **fit before the split**.
- Same entity/patient/user/group in train and test (use group-aware splits); duplicates and near-duplicates.
- Time series split randomly instead of chronologically; features computed from the future.
- Features that exist only after the outcome (post-outcome columns, IDs encoding the label).
- Hyperparameters or early stopping tuned on the test set.

## PyTorch checklist

- `model.train()` for training, `model.eval()` + `torch.no_grad()` for evaluation (dropout/batchnorm differ).
- Model and every tensor on the same device; correct dtype (`long` labels for cross-entropy).
- `CrossEntropyLoss` takes raw logits, not softmax; `BCEWithLogitsLoss` takes logits.
- `zero_grad` → `backward` → (clip) → `step`; scheduler stepped at the intended frequency.
- Seed `random`, `numpy`, `torch` (+ `torch.cuda`), and the `DataLoader` generator/`worker_init_fn`.
- Don't keep tensors that carry graphs across iterations (`running += loss.item()`).

## scikit-learn checklist

- Put preprocessing and the estimator in one `Pipeline` / `ColumnTransformer`, and cross-validate the whole
  pipeline so every fold fits transforms on its training part only.
- Use `StratifiedKFold` for imbalanced classes, `GroupKFold` for grouped data, `TimeSeriesSplit` for time.
- Set `random_state` everywhere it exists; check `scoring` matches the real objective.

## When to stop and ask

Three failed hypotheses, a metric that contradicts the baseline, or a fix that needs a redesign of the data
split or objective: report what you measured and ask before continuing.
