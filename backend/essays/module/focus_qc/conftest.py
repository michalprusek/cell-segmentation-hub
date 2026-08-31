"""Make the package importable as ``focus_qc`` no matter which directory pytest runs from."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
