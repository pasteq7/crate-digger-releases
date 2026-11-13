"""Music importer: adapts genre routing/tag cleanup from music_auto.py.
Runs as a bundled helper. Tags staged copies; explicit folder moves remove sources only after verification.
"""
import json
import hashlib
import os
import re
import shutil
import stat
import sys
import uuid
import zipfile
from pathlib import Path, PurePosixPath
import mutagen
from mutagen.id3 import ID3, ID3NoHeaderError, TCON
from mutagen.wave import WAVE
from mutagen.mp4 import MP4

AUDIO = {'.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aiff', '.aif', '.wma', '.ape', '.wv'}
EXTRAS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.txt', '.cue', '.m3u', '.m3u8', '.log'}
STAGING = '.crate-digger-import-staging'

def emit(**event):
    print(json.dumps(event, ensure_ascii=True), flush=True)

def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', value).strip().rstrip('. ')[:150]
    if not value or value in {'.', '..'}:
        raise ValueError('A folder or file name is empty.')
    if re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', value, re.I):
        value = '_' + value
    return value

def within(target, root):
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('The destination points outside your selected music folder.')
    return target

def tag(file, genre, clean):
    if not genre and not clean: return
    ext = file.suffix.lower()
    if ext == '.mp3':
        try: tags = ID3(file)
        except ID3NoHeaderError:
            if not genre: return
            tags = ID3()
        if genre: tags.setall('TCON', [TCON(encoding=3, text=[genre])])
        if clean: tags.delall('COMM')
        tags.save(file)
        return
    audio = WAVE(file) if ext == '.wav' else mutagen.File(file)
    if audio is None:
        raise ValueError('This audio format cannot be tagged; genre is saved in the import manifest.')
    if audio.tags is None:
        if not genre: return
        audio.add_tags()
    tags = audio.tags
    if isinstance(tags, ID3):
        if genre: tags.setall('TCON', [TCON(encoding=3, text=[genre])])
        if clean: tags.delall('COMM')
    elif isinstance(audio, MP4):
        if genre: tags['\xa9gen'] = [genre]
        if clean: tags.pop('\xa9cmt', None)
    else:
        key = 'WM/Genre' if ext == '.wma' else 'Genre' if ext == '.ape' else 'genre'
        if genre: tags[key] = [genre] if ext != '.ape' else genre
        if clean:
            for name in list(tags.keys()):
                if name.lower() in {'comment', 'description', 'wm/description'}: del tags[name]
    audio.save()

def routing(options, root):
    if 'destinationFolder' in options:
        relative = str(options['destinationFolder']).replace('\\', '/')
        if relative.startswith('/') or any(p in {'.', '..'} or ':' in p for p in relative.split('/') if p): raise ValueError('Choose a folder inside the destination root.')
        folder = within(root / relative, root)
        if not folder.is_dir(): raise ValueError('That destination folder is unavailable. Refresh the folder list.')
    else:
        folder = within(root / safe_name(str(options.get('genre') or 'Uncategorized')), root)
    return folder, safe_name(folder.name) if options.get('tagGenre', True) else None

def prepare_stage(options, root):
    # Native app chooses app data (same volume) or a per-volume scratch folder.
    # Never place transient audio inside a watched music destination.
    staging_root = Path(options.get('stagingRoot') or (root.parent / STAGING))
    if staging_root.is_symlink() or staging_root.is_junction(): raise ValueError('The import scratch folder must not be a link.')
    staging_root = staging_root.resolve()
    if staging_root.is_relative_to(root): raise ValueError('Import scratch space must be outside the music folder.')
    staging_root.mkdir(parents=True, exist_ok=True)
    if staging_root.stat().st_dev != root.stat().st_dev: raise ValueError('Import scratch space must be on the same drive as the destination.')
    if os.name == 'nt':
        import ctypes
        attributes = ctypes.windll.kernel32.GetFileAttributesW(str(staging_root))
        if attributes != -1: ctypes.windll.kernel32.SetFileAttributesW(str(staging_root), attributes | 2)
    stage = within(staging_root / uuid.uuid4().hex, staging_root)
    stage.mkdir(exist_ok=False)
    return staging_root, stage

def cleanup_stage(stage, staging_root):
    if not stage.exists(): return
    within(stage, staging_root)
    if stage.parent.resolve() != staging_root.resolve() or not re.fullmatch('[a-f0-9]{32}', stage.name): raise ValueError('Invalid staging cleanup path.')
    shutil.rmtree(stage)

def import_zip(options):
    source = Path(options['zip']).resolve(strict=True)
    root = Path(options['root']).resolve(strict=True)
    if source.suffix.lower() != '.zip' or not source.is_file() or not root.is_dir():
        raise ValueError('Choose a ZIP file and an existing destination folder.')
    genre_dir, genre = routing(options, root)
    album = safe_name(source.stem)
    if genre_dir.is_symlink():
        raise ValueError('Import folders must not be symbolic links.')
    staging_root, stage = prepare_stage(options, root)
    warnings = []
    original_stat = source.stat()
    try:
        with zipfile.ZipFile(source) as archive:
            entries = []
            collisions = set()
            total = 0
            for info in archive.infolist():
                raw = info.filename.replace('\\', '/')
                parts = PurePosixPath(raw).parts
                if raw.startswith('/') or any(p in {'.', '..'} or ':' in p for p in parts):
                    raise ValueError('The ZIP contains an unsafe path.')
                if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                    raise ValueError('Encrypted ZIPs and symbolic links are not supported.')
                if info.is_dir() or '__MACOSX' in parts or not parts: continue
                if Path(raw).suffix.lower() not in AUDIO | EXTRAS: continue
                relative = Path(*(safe_name(p) for p in parts))
                key = str(relative).casefold()
                if key in collisions: raise ValueError('The ZIP has duplicate file names.')
                collisions.add(key)
                total += info.file_size
                if total > 40 * 1024**3 or len(entries) >= 20000:
                    raise ValueError('This ZIP is too large (limit: 40 GB or 20,000 files).')
                entries.append((info, relative))
            music_count = sum(p.suffix.lower() in AUDIO for _, p in entries)
            if not music_count: raise ValueError('No supported music files were found in this ZIP.')
            # Remove one redundant album wrapper; preserve artist/disc structure below it.
            first = {p.parts[0] for _, p in entries}
            flatten = len(first) == 1 and all(len(p.parts) > 1 for _, p in entries)
            for index, (info, relative) in enumerate(entries):
                if flatten: relative = Path(*relative.parts[1:])
                target = within(stage / relative, stage)
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as src, target.open('xb') as out:
                    shutil.copyfileobj(src, out, 1024 * 1024)
                emit(phase='extracting', done=index + 1, total=len(entries), current=str(relative))
                if target.suffix.lower() in AUDIO:
                    try: tag(target, genre, bool(options.get('cleanComments', True)))
                    except Exception:
                        # Restore the original bytes if a tag writer failed part-way through.
                        with archive.open(info) as src, target.open('wb') as out:
                            shutil.copyfileobj(src, out, 1024 * 1024)
                        warnings.append(f'{relative}: original tags kept.' + (' Genre recorded in manifest.' if genre else ''))
                    emit(phase='tagging', done=index + 1, total=len(entries), current=str(relative))
        if (source.stat().st_size, source.stat().st_mtime_ns) != (original_stat.st_size, original_stat.st_mtime_ns):
            raise ValueError('The ZIP changed during import. Wait for its download to finish and retry.')
        (stage / '.crate-digger-import.json').write_text(json.dumps({'version': 1, 'genre': genre, 'source': source.name}), encoding='utf-8')
        genre_dir.mkdir(parents=True, exist_ok=True)
        within(genre_dir, root)
        # Windows rename fails if the destination exists. Never merge or overwrite a library album.
        for number in range(1, 10000):
            destination = within(genre_dir / (album if number == 1 else f'{album} ({number})'), root)
            if destination.exists(): continue
            try:
                os.rename(stage, destination)
                break
            except FileExistsError: continue
        else: raise ValueError('Too many albums with this ZIP name already exist.')
        emit(phase='complete', destination=str(destination), tracks=music_count, warnings=warnings)
    finally:
        # Only the unique staging directory created above may be removed.
        cleanup_stage(stage, staging_root)

def file_hash(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()

def folder_entries(source):
    files, directories = [], []
    total = 0
    def unreadable(error): raise error
    for current, dirs, names in os.walk(source, followlinks=False, onerror=unreadable):
        for name in dirs + names:
            entry = Path(current) / name
            if entry.is_symlink() or entry.is_junction():
                raise ValueError('Music folder moves cannot contain symbolic links or junctions.')
            relative = entry.relative_to(source)
            if entry.is_dir(): directories.append(relative)
            elif entry.is_file():
                total += entry.stat().st_size
                if total > 40 * 1024**3 or len(files) >= 20000:
                    raise ValueError('This music folder is too large (limit: 40 GB or 20,000 files).')
                files.append(relative)
            else: raise ValueError('The dropped folder contains a special file that cannot be moved.')
    return files, directories

def verify_source(source, hashes, directories):
    files, dirs = folder_entries(source)
    return set(files) == set(hashes) and set(dirs) == set(directories) and all(file_hash(source / f) == digest for f, digest in hashes.items())

def import_folder(options):
    selected = Path(options.get('source') or options.get('zip'))
    if selected.is_symlink() or selected.is_junction(): raise ValueError('Drop the actual music folder, not a folder link.')
    source = selected.resolve(strict=True)
    root = Path(options['root']).resolve(strict=True)
    if not source.is_dir() or not root.is_dir(): raise ValueError('Choose an existing music folder and destination.')
    protected = {Path(source.anchor), Path.home(), *(Path.home() / n for n in ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'AppData'])}
    protected.update(Path(os.environ[n]).resolve() for n in ['APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)'] if os.environ.get(n))
    if source in protected or root.is_relative_to(source): raise ValueError('Drop a specific album/music folder; system folders and destination ancestors cannot be moved.')
    genre_dir, genre = routing(options, root)
    if genre_dir.resolve().is_relative_to(source): raise ValueError('The genre destination is inside the dropped folder. Choose another genre or drop individual album folders.')
    if source.parent == genre_dir.resolve(): raise ValueError('This folder is already in the selected genre destination. Choose another genre to move it.')
    staging_root, stage = prepare_stage(options, root)
    warnings, hashes = [], {}
    try:
        files, directories = folder_entries(source)
        music_count = sum(p.suffix.lower() in AUDIO for p in files)
        if not music_count: raise ValueError('No supported music files were found in this folder.')
        for directory in directories: within(stage / directory, stage).mkdir(parents=True, exist_ok=True)
        for index, relative in enumerate(files):
            original, target = source / relative, within(stage / relative, stage)
            # Copy all regular files, including unknown sidecars, before any source removal.
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, target)
            digest = file_hash(original)
            if file_hash(target) != digest: raise ValueError('A source file changed while copying. The original folder was kept.')
            hashes[relative] = digest
            emit(phase='copying', done=index + 1, total=len(files), current=str(relative))
            if target.suffix.lower() in AUDIO:
                try: tag(target, genre, bool(options.get('cleanComments', True)))
                except Exception:
                    shutil.copy2(original, target)
                    if file_hash(target) != digest: raise ValueError('A source file changed during tagging. The original folder was kept.')
                    warnings.append(f'{relative}: original tags kept.' + (' Genre recorded in manifest.' if genre else ''))
                emit(phase='tagging', done=index + 1, total=len(files), current=str(relative))
        if not verify_source(source, hashes, directories): raise ValueError('The source folder changed during import. It was kept; retry after other applications finish writing.')
        (stage / '.crate-digger-import.json').write_text(json.dumps({'version': 1, 'genre': genre, 'source': source.name, 'kind': 'folder'}), encoding='utf-8')
        genre_dir.mkdir(parents=True, exist_ok=True)
        within(genre_dir, root)
        for number in range(1, 10000):
            destination = within(genre_dir / (safe_name(source.name) if number == 1 else f'{safe_name(source.name)} ({number})'), root)
            if destination.exists(): continue
            try: os.rename(stage, destination); break
            except FileExistsError: continue
        else: raise ValueError('Too many folders with this name already exist.')
        # Publish the complete tagged copy first. Rename the original on its own
        # volume, verify again, then remove it. Failures leave a usable copy intact.
        held = source.parent / ('.crate-digger-original-' + uuid.uuid4().hex)
        source_removed, original_backup = False, None
        try:
            os.rename(source, held)
            within(held, source.parent)
            if not verify_source(held, hashes, directories): raise ValueError('The source changed before removal.')
            if held.parent.resolve() != source.parent.resolve() or not held.name.startswith('.crate-digger-original-'): raise ValueError('Invalid original-folder cleanup path.')
            shutil.rmtree(held)
            source_removed = True
        except Exception:
            if held.exists():
                if not source.exists():
                    try: os.rename(held, source)
                    except OSError: original_backup = str(held)
                else: original_backup = str(held)
            warnings.append('The sorted copy is ready, but the original could not be fully removed. ' + (f'Remaining original files: {original_backup}' if original_backup else f'Original folder: {source}'))
        emit(phase='complete', destination=str(destination), tracks=music_count, warnings=warnings, sourceRemoved=source_removed, originalBackup=original_backup)
    finally:
        cleanup_stage(stage, staging_root)

if __name__ == '__main__':
    try:
        options = json.loads(sys.stdin.readline())
        if options.get('kind') == 'folder': import_folder(options)
        else: import_zip(options)
    except Exception as error:
        emit(phase='failed', error=str(error))
        sys.exit(1)
