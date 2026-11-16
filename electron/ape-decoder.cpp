#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>

// Small, separate decoder process. The source file is never opened for writing.
int wmain(int argc, wchar_t** argv) {
    if (argc != 3 || GetFileAttributesW(argv[2]) != INVALID_FILE_ATTRIBUTES) return 2;
    wchar_t library[32768];
    DWORD length = GetModuleFileNameW(nullptr, library, 32768);
    if (!length || length >= 32768) return 3;
    wchar_t* slash = wcsrchr(library, L'\\');
    if (!slash) return 3;
    wcscpy_s(slash + 1, 32768 - (slash + 1 - library), L"MACDll64.dll");
    HMODULE module = LoadLibraryExW(library, nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!module) return 4;
    using Decode = int (__stdcall*)(const wchar_t*, const wchar_t*, void*, int);
    auto decode = reinterpret_cast<Decode>(GetProcAddress(module, "DecompressFileW2"));
    int result = decode ? decode(argv[1], argv[2], nullptr, 2) : 5;
    FreeLibrary(module);
    if (result) fwprintf(stderr, L"Monkey's Audio could not decode this file (code %d).\n", result);
    return result ? 6 : 0;
}
