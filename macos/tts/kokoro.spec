# Run only with the project macos/tts/.venv PyInstaller.
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, copy_metadata, collect_submodules
from pathlib import Path
from importlib.metadata import distributions
import sysconfig
root=Path(SPECPATH)
data=collect_data_files('mlx_audio',include_py_files=True)
for distribution in distributions():
    name=distribution.metadata['Name']
    data+=copy_metadata(name)
    modules=(distribution.read_text('top_level.txt') or name.replace('-','_')).splitlines()
    for module in modules:
        if module.isidentifier(): data+=collect_data_files(module)
for package in ['mlx','misaki','unidic_lite','unidic','en_core_web_sm','jieba','pypinyin','cn2an','espeakng_loader','spacy','thinc','num2words','pyopenjtalk','cutlet']:
    data+=collect_data_files(package)
for package in ['misaki','mlx','mlx-audio','spacy','en-core-web-sm','phonemizer-fork','espeakng-loader']:
    data+=copy_metadata(package)
# Never collect same-named namespace folders from the developer checkout.
site_packages=Path(sysconfig.get_path('purelib')).resolve()
data=[item for item in data if Path(item[0]).resolve().is_relative_to(site_packages)]
a=Analysis([str(root/'service.py')],pathex=[str(root)],binaries=collect_dynamic_libs('mlx'),datas=data,
 hiddenimports=collect_submodules('mlx')+['misaki.en','misaki.espeak','misaki.ja','misaki.zh','en_core_web_sm','uvicorn.logging','uvicorn.loops.auto','uvicorn.protocols.http.h11_impl','uvicorn.lifespan.on'],
 excludes=['torch','tensorflow','onnxruntime','matplotlib','pandas','sklearn','IPython','pytest'],noarchive=False)
pyz=PYZ(a.pure)
exe=EXE(pyz,a.scripts,[],exclude_binaries=True,name='kokoro-mlx',debug=False,bootloader_ignore_signals=False,strip=False,upx=False,console=True,target_arch='arm64',codesign_identity=None)
coll=COLLECT(exe,a.binaries,a.datas,strip=False,upx=False,name='kokoro-mlx')
