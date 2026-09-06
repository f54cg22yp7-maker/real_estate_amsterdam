"""Minimal runner so tests work without pytest installed."""
import importlib, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
ok = True
for f in sorted(pathlib.Path(__file__).parent.glob("test_*.py")):
    mod = importlib.import_module(f"tests.{f.stem}")
    for name in dir(mod):
        if name.startswith("test_"):
            try:
                getattr(mod, name)(); print("PASS", name)
            except Exception as e:
                ok = False; print("FAIL", name, e)
sys.exit(0 if ok else 1)
