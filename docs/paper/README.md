# PBM paper (LaTeX)

Two self-contained papers share one figure set:

| Source | Output | Engine |
|---|---|---|
| `main-en.tex` | `../color-mixing-algorithm.pdf` | pdfLaTeX |
| `main-zh.tex` | `../color-mixing-algorithm.zh-CN.pdf` | XeLaTeX + ctex (fandol) |

Build both and copy the PDFs into `docs/`:

```powershell
pwsh -File docs/paper/build.ps1
```

Intermediate files are written to `docs/paper/build/` (ignored by git).

## Figures

`figures/*.pdf` are vector conversions of `docs/assets/fig1..fig8*.svg`:

```powershell
node tools/svg-to-pdf.js
```

The converter uses headless Microsoft Edge (or Chrome) print-to-pdf; any
SVG-to-PDF converter producing the same page size can be used instead.

## Content

The paper reports measurements produced by the tooling in `tools/`:
`run-heldout.js` (in-sample / held-out tables), `run-ablation.js` (ablation),
`run-sensitivity.js` (gate thresholds), `run-continuity-probe.js` (continuity and
`cSat` ablation), `run-bench.js` (runtime), `fit-gamma.js` (harmonic-coefficient
fit and evaluation), and `run-physical.js` (synthetic spectral validation). All
random draws are seeded; bootstrap resampling uses a fixed stream, so the
reported confidence intervals are reproducible.

`run-bench.js` times every model in the host V8 realm. A `node:vm` context
inflates elementary-function calls by 50--100x (measured 8.9x for PBM, 8.7x for
the reference, 1.2x for the arithmetic-only baseline), so sandbox timings must
not be used; `--vm-control` reproduces that artifact for auditing only.

`node tools/run-regression.js` asserts the metric table, endpoint identity,
exchange symmetry and neighborhood continuity against
`tools/regression-baseline.json`. Regenerate the baseline with `--update` only
together with an intentional model change.
