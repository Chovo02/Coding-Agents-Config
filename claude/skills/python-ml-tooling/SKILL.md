---
name: python-ml-tooling
description: Python tooling for ML projects with uv, ruff and pytest. Use when setting up or editing pyproject.toml, adding dependencies, running or writing tests, linting or formatting Python, or structuring tests for ML code (training steps, data transforms, metrics).
---

# Python ML tooling (uv, ruff, pytest)

Use the project's own tooling. Look for `uv.lock` / `[tool.ruff]` / `[tool.pytest.ini_options]` first; do not
introduce a tool the project does not already use unless asked. Skip uv in Poetry (`poetry.lock`) or PDM projects.

## uv

```bash
uv sync                 # create/sync the env (updates the lockfile if needed)
uv sync --locked        # fail if uv.lock is out of date (use in CI)
uv add torch            # runtime dependency
uv add --dev pytest ruff
uv run python train.py  # run inside the project env
uv run pytest -q
```

- Run project tools with `uv run <tool>` so the pinned version is used. Use `uvx <tool>` only for one-off,
  well-known tools not in the project (it runs PyPI packages: be careful).
- Commit `uv.lock`. Keep dev tools in a dependency group, not in runtime dependencies.
- PyTorch wheels (CPU/CUDA) may need a project-specific index in `pyproject.toml`; check the project's setup
  before changing the torch pin.

## ruff

```bash
uv run ruff check path/to/file.py       # lint only what you touched
uv run ruff check --diff path/to/file.py  # preview fixes
uv run ruff format --check path/to/file.py
```

- Do not reformat a file wholesale if `ruff format --diff` shows changes everywhere: the project likely does
  not use ruff formatting, and a noisy diff hides the real change.
- Scope fixes to the files you are editing. Apply `--fix` only when asked; never `--unsafe-fixes` without
  reviewing `ruff rule <CODE>` first. Run `ruff check --fix` before `ruff format` when both are wanted.
- Notebooks (`.ipynb`) are not linted by default in this setup; keep logic worth linting in `.py` files.

## pytest for ML code

Follow test → implement → refactor for pure logic (transforms, metrics, splitting, feature code). For
training code test the contract, not the learning outcome.

- **Determinism:** a fixture that seeds `random`, `numpy` and `torch` (and sets
  `torch.use_deterministic_algorithms` only if the project already does).
- **Tiny synthetic data:** build a few rows/tensors inline; never load the real dataset in unit tests.
- **Shapes and dtypes:** assert output shape, dtype and device of a model forward pass on a small batch.
- **Numeric comparisons:** `torch.testing.assert_close` / `np.testing.assert_allclose` with explicit
  tolerances, never `==` on floats.
- **Smoke test for training:** one or two steps on a tiny batch must run and produce a finite loss; mark
  anything slow or GPU-bound with `@pytest.mark.slow` / `@pytest.mark.gpu` and deselect by default.
- **Leakage guard in tests:** assert that fitted preprocessing (scalers, encoders) is fit on train only.

```python
@pytest.fixture(autouse=True)
def seed():
    random.seed(0); np.random.seed(0); torch.manual_seed(0)

def test_forward_shape():
    model = build_model(in_dim=8, out_dim=3)
    out = model(torch.randn(4, 8))
    assert out.shape == (4, 3) and torch.isfinite(out).all()
```

## Checklist before finishing

1. `uv run ruff check` on changed files is clean.
2. `uv run pytest -q` passes (slow/GPU tests excluded unless asked).
3. `uv.lock` updated if dependencies changed.
