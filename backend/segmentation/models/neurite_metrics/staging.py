#!/usr/bin/env python3
"""Developmental staging of neurons from their neurite morphology.

The rules are the biologist's, transcribed literally. Three decisions that the
rules do not state were settled with them on 2026-09-05 and are recorded here
because every stage boundary moves if they change:

* **Soma diameter is the MAJOR AXIS** of the fitted ellipse, not the
  area-equivalent diameter. On an elongated soma these differ by ~1.6x, so this
  makes every threshold stricter and pushes borderline cells DOWN a stage.
* **A connecting neurite is staged on its FULL length**, not on the half that is
  credited to each soma. The cell physically grew the whole process; halving is
  a bookkeeping rule that stops one neurite being counted twice in the length
  table, and it should not also demote the cell.
* **"Registered neurite" means >= 2 um** (`min_neurite_len`). Below that a
  process is ~11 px at 0.180 um/px and indistinguishable from a bump on the soma
  rim or a skeletonisation spur -- spur pruning itself runs at 1 um.

Non-neuronal somas are separated first and never staged; they carry
`stage = 'non-neuronal'`.
"""
from __future__ import annotations

from dataclasses import dataclass

STAGE_NON_NEURONAL = 'non-neuronal'
STAGE_1 = '1'
STAGE_1_2 = '1-2'
STAGE_2 = '2'
STAGE_3 = '3'
STAGE_UNKNOWN = 'unknown'

ORDER = [STAGE_NON_NEURONAL, STAGE_1, STAGE_1_2, STAGE_2, STAGE_3, STAGE_UNKNOWN]


@dataclass
class StageResult:
    stage: str
    reason: str
    longest_um: float | None = None
    second_um: float | None = None
    ratio_to_diameter: float | None = None


def stage_soma(neurite_lengths_um, soma_diameter_um, is_neuronal=True) -> StageResult:
    """Classify one soma.

    `neurite_lengths_um` are FULL lengths (see the module docstring) of the
    primary neurites that passed the >= 2 um registration threshold.
    """
    if not is_neuronal:
        return StageResult(STAGE_NON_NEURONAL, 'klasifikátor: není neuronální soma')
    if soma_diameter_um is None or soma_diameter_um <= 0:
        return StageResult(STAGE_UNKNOWN, 'neznámý průměr somatu')

    L = sorted((float(x) for x in neurite_lengths_um if x is not None), reverse=True)
    D = float(soma_diameter_um)

    if not L:
        return StageResult(STAGE_1, 'žádný registrovaný neurit (>= 2 µm)')

    longest = L[0]
    second = L[1] if len(L) > 1 else None
    ratio = longest / D

    if longest < 2.0 * D:
        return StageResult(STAGE_1_2,
                           f'nejdelší neurit {longest:.1f} µm < 2× průměr '
                           f'({2 * D:.1f} µm) — mikro neurity',
                           longest, second, ratio)

    # From here: at least one neurite >= 2x the diameter, so stage 2 or 3.
    if len(L) == 1:
        if longest >= 5.0 * D:
            return StageResult(STAGE_3,
                               f'jediný neurit {longest:.1f} µm >= 5× průměr '
                               f'({5 * D:.1f} µm)', longest, second, ratio)
        return StageResult(STAGE_2,
                           f'jediný neurit {longest:.1f} µm, ale < 5× průměr '
                           f'({5 * D:.1f} µm)', longest, second, ratio)

    if second is not None and second > 0 and longest >= 2.0 * second:
        return StageResult(STAGE_3,
                           f'nejdelší {longest:.1f} µm >= 2× druhý nejdelší '
                           f'({second:.1f} µm) — dominantní výběžek',
                           longest, second, ratio)
    return StageResult(STAGE_2,
                       f'nejdelší {longest:.1f} µm < 2× druhý nejdelší '
                       f'({second:.1f} µm) — žádný dominantní výběžek',
                       longest, second, ratio)
