import hashlib
import io
import json
import subprocess
import tempfile
import unittest
import wave
import zipfile
from pathlib import Path
from mutagen.id3 import TIT2, TPE1, TALB, COMM, TCON
from mutagen.wave import WAVE

BASE = Path(__file__).resolve().parents[1]

def digest(file): return hashlib.sha256(file.read_bytes()).hexdigest()

class ImportTest(unittest.TestCase):
    def setUp(self):
        (BASE / '.test-data').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=BASE / '.test-data')
        self.base = Path(self.temp.name)
        self.root = self.base / 'Music'
        self.root.mkdir()
    def tearDown(self): self.temp.cleanup()
    def wav(self):
        file = self.base / 'original.wav'
        with wave.open(str(file), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000); w.writeframes(b'\0\0' * 800)
        audio = WAVE(file); audio.add_tags()
        for tag in [TIT2(encoding=3, text=['Dub Test']), TPE1(encoding=3, text=['Test Artist']), TALB(encoding=3, text=['Test Album']), TCON(encoding=3, text=['Old Genre']), COMM(encoding=3, lang='eng', desc='', text=['Old comment'])]: audio.tags.add(tag)
        audio.save(); return file
    def archive(self, entries, name='Artist - Album.zip'):
        file = self.base / name
        with zipfile.ZipFile(file, 'w') as z:
            for n, data in entries: z.writestr(n, data)
        return file
    def run_import(self, zip, clean=True, executable=None):
        command = [str(executable)] if executable else ['C:\\Python312\\python.exe', str(BASE / 'electron/import_music.py')]
        p = subprocess.run(command, input=json.dumps({'zip':str(zip), 'root':str(self.root), 'genre':'Dub', 'cleanComments':clean})+'\n', capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        events = [json.loads(line) for line in p.stdout.splitlines()]
        return p.returncode, events[-1]
    def test_tag_new_wav_preserve_audio_source_zip_and_existing_albums(self):
        wav = self.wav(); data = wav.read_bytes()
        zip = self.archive([('Album/01.wav',data), ('Album/cover.jpg',b'art')]); before=digest(zip)
        code, result = self.run_import(zip)
        self.assertEqual(code, 0, result)
        dest = Path(result['destination']); self.assertEqual(dest.parent, self.root/'Dub')
        tags=WAVE(dest/'01.wav').tags
        self.assertEqual(str(tags['TCON']), 'Dub'); self.assertEqual(str(tags['TALB']), 'Test Album'); self.assertFalse(tags.getall('COMM'))
        with wave.open(str(dest/'01.wav'),'rb') as w: self.assertEqual(w.readframes(800),b'\0\0'*800)
        self.assertEqual(digest(zip),before); self.assertEqual(wav.read_bytes(),data)
        first=digest(dest/'01.wav'); code, second=self.run_import(zip)
        self.assertEqual(code,0); self.assertTrue(second['destination'].endswith('(2)')); self.assertEqual(digest(dest/'01.wav'),first)
        self.assertEqual(json.loads((dest/'.crate-digger-import.json').read_text())['genre'],'Dub')
    def test_optional_comment_preservation(self):
        zip=self.archive([('01.wav', self.wav().read_bytes())]);code,result=self.run_import(zip,False)
        self.assertEqual(code,0);self.assertTrue(WAVE(Path(result['destination'])/'01.wav').tags.getall('COMM'))
    def test_unsupported_tags_restore_original_bytes_and_report_warning(self):
        data=b'invalid raw audio kept intact';zip=self.archive([('01.aac',data)])
        code,result=self.run_import(zip);self.assertEqual(code,0);self.assertTrue(result['warnings']);self.assertEqual((Path(result['destination'])/'01.aac').read_bytes(),data)
    def test_unsafe_paths_and_symlinks_rejected_without_publishing(self):
        for name in ['../escape.wav','C:/escape.wav','/absolute.wav','safe/../../escape.wav','safe\\..\\escape.wav']:
            with self.subTest(name=name):
                zip=self.archive([(name,b'audio')]);code,result=self.run_import(zip)
                self.assertNotEqual(code,0); self.assertEqual(result['phase'],'failed');self.assertTrue(zip.exists());self.assertFalse((self.root/'Dub').exists())
        info=zipfile.ZipInfo('link.wav');info.create_system=3;info.external_attr=(0o120777<<16)
        zip=self.archive([(info,b'../../escape.wav')]);self.assertNotEqual(self.run_import(zip)[0],0)
        self.assertEqual(list((self.base/'.crate-digger-import-staging').iterdir()),[])
    def test_duplicate_sanitized_names_and_non_music_archives_rejected(self):
        for entries in [[('01?.wav',b'a'),('01*.wav',b'b')],[('cover.jpg',b'art')]]:
            zip=self.archive(entries);self.assertNotEqual(self.run_import(zip)[0],0)
    def test_bundled_helper_requires_no_python_installation(self):
        helper=BASE/'build/importer/CrateDiggerImport.exe'
        if not helper.exists(): self.skipTest('Build helper first')
        zip=self.archive([('01.wav',self.wav().read_bytes())]);code,result=self.run_import(zip,executable=helper)
        self.assertEqual(code,0,result);self.assertEqual(str(WAVE(Path(result['destination'])/'01.wav').tags['TCON']),'Dub')
    def move_folder(self, source, executable=None):
        command=[str(executable)] if executable else ['C:\\Python312\\python.exe',str(BASE/'electron/import_music.py')]
        p=subprocess.run(command,input=json.dumps({'kind':'folder','source':str(source),'root':str(self.root),'genre':'Dub','cleanComments':True})+'\n',capture_output=True,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
        return p.returncode,[json.loads(line) for line in p.stdout.splitlines()][-1]
    def test_music_folder_move_tags_copy_preserves_sidecars_and_removes_source(self):
        source=self.base/'Incoming Album';source.mkdir();(source/'CD1').mkdir();(source/'Empty folder').mkdir()
        wav=self.wav();(source/'CD1'/'01.wav').write_bytes(wav.read_bytes());(source/'unknown-sidecar.bin').write_bytes(b'keep every file')
        code,result=self.move_folder(source);self.assertEqual(code,0,result);self.assertTrue(result['sourceRemoved']);self.assertFalse(source.exists())
        dest=Path(result['destination']);self.assertEqual(dest,self.root/'Dub'/'Incoming Album');self.assertEqual((dest/'unknown-sidecar.bin').read_bytes(),b'keep every file');self.assertTrue((dest/'Empty folder').is_dir())
        self.assertEqual(str(WAVE(dest/'CD1'/'01.wav').tags['TCON']),'Dub');self.assertEqual(str(WAVE(dest/'CD1'/'01.wav').tags['TALB']),'Test Album')
        with wave.open(str(dest/'CD1'/'01.wav'),'rb') as w:self.assertEqual(w.readframes(800),b'\0\0'*800)
    def test_folder_move_never_overwrites_existing_album(self):
        existing=self.root/'Dub'/'Incoming';existing.mkdir(parents=True);(existing/'keep.txt').write_text('untouched')
        source=self.base/'Incoming';source.mkdir();(source/'01.wav').write_bytes(self.wav().read_bytes())
        code,result=self.move_folder(source);self.assertEqual(code,0,result);self.assertTrue(result['destination'].endswith('(2)'));self.assertEqual((existing/'keep.txt').read_text(),'untouched')
    def test_folder_rejects_destination_ancestors_nonmusic_and_source_inside_genre_itself(self):
        for source in [self.root,self.base]:
            code,result=self.move_folder(source);self.assertNotEqual(code,0);self.assertTrue(source.exists())
        empty=self.base/'No music';empty.mkdir();(empty/'note.txt').write_text('keep')
        code,result=self.move_folder(empty);self.assertNotEqual(code,0);self.assertEqual((empty/'note.txt').read_text(),'keep')
        genre=self.root/'Dub';genre.mkdir();(genre/'01.wav').write_bytes(self.wav().read_bytes())
        code,result=self.move_folder(genre);self.assertNotEqual(code,0);self.assertTrue((genre/'01.wav').exists())
    def test_actual_root_or_existing_subfolder_routing_with_optional_genre_tag(self):
        folder=self.root/'Roots & Steppers';folder.mkdir()
        zip=self.archive([('01.wav',self.wav().read_bytes())])
        for relative, enabled, expected in [('',False,'Old Genre'),('Roots & Steppers',True,'Roots & Steppers')]:
            opts={'zip':str(zip),'root':str(self.root),'destinationFolder':relative,'tagGenre':enabled,'cleanComments':False}
            p=subprocess.run(['C:\\Python312\\python.exe',str(BASE/'electron/import_music.py')],input=json.dumps(opts)+'\n',capture_output=True,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
            result=json.loads(p.stdout.splitlines()[-1]);self.assertEqual(p.returncode,0,result)
            dest=Path(result['destination']);self.assertEqual(dest.parent,self.root/relative)
            self.assertEqual(str(WAVE(dest/'01.wav').tags['TCON']),expected)
            self.assertTrue(WAVE(dest/'01.wav').tags.getall('COMM'))
            self.assertEqual(json.loads((dest/'.crate-digger-import.json').read_text())['genre'],expected if enabled else None)
        self.assertFalse((self.root/'Uncategorized').exists())
    def test_music_watchers_only_see_the_published_album_never_staging_audio(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('crate_import_test',BASE/'electron/import_music.py')
        helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
        zip=self.archive([('01.wav',self.wav().read_bytes())]);events=[]
        def observe(**event):
            events.append(event)
            if event['phase'] in {'extracting','tagging'}:
                self.assertEqual(list(self.root.rglob('*.wav')),[])
                self.assertTrue(list((self.base/'.crate-digger-import-staging').rglob('*.wav')))
        helper.emit=observe
        helper.import_zip({'zip':str(zip),'root':str(self.root),'genre':'Dub'})
        self.assertEqual(events[-1]['phase'],'complete')
        self.assertEqual(len(list(self.root.rglob('*.wav'))),1)
        self.assertFalse((self.root/'.crate-digger-import-staging').exists())
        with self.assertRaises(ValueError):
            helper.import_zip({'zip':str(zip),'root':str(self.root),'genre':'Dub','stagingRoot':str(self.root/'bad-scratch')})

if __name__=='__main__': unittest.main(verbosity=2)
