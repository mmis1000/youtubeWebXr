"""Package the built extension and userscript for GitHub downloads."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
dist = root / 'dist'
output = root / 'release'
version = json.loads((dist / 'manifest.json').read_text(encoding='utf-8'))['version']
output.mkdir(exist_ok=True)
extension = output / f'youtube-webxr-extension-{version}.zip'
with zipfile.ZipFile(extension, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['manifest.json', 'youtube-xr.js', 'youtube-xr.js.map']:
        archive.write(dist / name, name)
userscript = output / 'youtube-webxr.user.js'
shutil.copyfile(dist / userscript.name, userscript)
(output / 'SHA256SUMS.txt').write_text(''.join(
    f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n'
    for path in [extension, userscript]
), encoding='utf-8')
print(f'Packaged extension {version} and userscript in {output}')
