# Medical AI Backend Service
import sys
from pathlib import Path

# Automatically add ai-backend directory to sys.path so 'app' package is always resolvable
_pkg_root = Path(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))
