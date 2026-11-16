"""Create a generated APE fixture with the official, bundled test SDK DLL."""
import ctypes
import sys
import wave
from pathlib import Path

dll_path, wav_path, ape_path = [Path(value).resolve() for value in sys.argv[1:4]]
if not wav_path.exists():
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(wav_path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b'\x10\x00\xf0\xff' * 8000 * 30)
if ape_path.exists():
    raise ValueError('Fixture output already exists.')
library = ctypes.WinDLL(str(dll_path))
encode = library.CompressFileW2
encode.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_int,
                   ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_bool]
encode.restype = ctypes.c_int
result = encode(str(wav_path), str(ape_path), 2000, None, 1, None, False)
if result:
    raise RuntimeError(f'APE fixture encoding failed: {result}')
