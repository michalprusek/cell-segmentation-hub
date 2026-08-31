# focus_qc calibration report

- tolerance: +-0.3 um   guard band: 0.1 um
- stacks: 5

## Leave-one-stack-out validation

| held-out stack | channel | threshold from others | sensitivity | specificity | balanced acc |
|---|---|---|---|---|---|
| Z_stack_001 | IRM | 7.59 | 1.00 | 1.00 | 1.000 |
| Z_stack_001 | TIRF 488 | 0.195 | 1.00 | 1.00 | 1.000 |
| Z_stack_001 | **OR rule** | - | 1.00 | 1.00 | **1.000** |
| Z_stack_002 | IRM | 9.58 | 0.86 | 0.97 | 0.913 |
| Z_stack_002 | TIRF 488 | 0.218 | 1.00 | 1.00 | 1.000 |
| Z_stack_002 | **OR rule** | - | 0.86 | 1.00 | **0.929** |
| Z_stack_003 | IRM | 8.92 | 0.86 | 0.97 | 0.913 |
| Z_stack_003 | TIRF 488 | 0.269 | 0.86 | 1.00 | 0.929 |
| Z_stack_003 | **OR rule** | - | 0.86 | 1.00 | **0.929** |
| Z_stack_004 | IRM | 6.46 | 1.00 | 0.94 | 0.969 |
| Z_stack_004 | TIRF 488 | 0.156 | 1.00 | 0.94 | 0.969 |
| Z_stack_004 | **OR rule** | - | 1.00 | 0.94 | **0.969** |
| Z_stack_005 | IRM | 6.58 | 1.00 | 0.94 | 0.969 |
| Z_stack_005 | TIRF 488 | 0.147 | 1.00 | 0.88 | 0.938 |
| Z_stack_005 | **OR rule** | - | 1.00 | 0.94 | **0.969** |

| channel | mean balanced acc | worst fold |
|---|---|---|
| IRM | 0.953 | 0.913 |
| TIRF 488 | 0.967 | 0.929 |
| OR (frame verdict) | 0.959 | 0.929 |

## Final calibration (all stacks)

| modality | threshold | noise sigma range | background range |
|---|---|---|---|
| irm | 7.64 | 166 – 170 | 16401 – 16748 |
| fluor | 0.1844 | 5.79 – 5.89 | 110 – 111 |
