import sys
import wave
import zipfile
from pathlib import Path
from mutagen.wave import WAVE
from mutagen.id3 import TIT2, TPE1, TALB, TCON, COMM
root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
wav=root/'01 Dub.wav'
with wave.open(str(wav),'wb') as w:
    w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000);w.writeframes(b'\0\0'*8000)
audio=WAVE(wav);audio.add_tags()
for t in [TIT2(encoding=3,text=['Dub Test']),TPE1(encoding=3,text=['Test Artist']),TALB(encoding=3,text=['Test Album']),TCON(encoding=3,text=['Old Genre']),COMM(encoding=3,lang='eng',desc='',text=['Old comment'])]:audio.tags.add(t)
audio.save()
with zipfile.ZipFile(root/'Test Album.zip','w') as z:z.write(wav,'Test Album/01 Dub.wav')
