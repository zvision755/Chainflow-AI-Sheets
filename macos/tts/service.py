"""Bundled, offline Kokoro MLX/Metal service; audio only lives in RAM."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import io
import logging
import os
from pathlib import Path
import re
import time
import threading
import tempfile
from typing import Literal

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
import numpy as np
import mlx.core as mx
import json
import soundfile as sf
import unidic
import unidic_lite
unidic.DICDIR = unidic_lite.DICDIR
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from mlx_audio.tts.models.kokoro import Model, ModelConfig, KokoroPipeline
from misaki import en, ja, zh, espeak
import espeakng_loader

# eSpeak NG's Darwin path buffer is only 160 bytes. A short temporary alias
# keeps long application installation paths usable; no audio is stored here.
dictionary_alias = tempfile.TemporaryDirectory(prefix='chainflow-espeak-', dir='/tmp')
Path(dictionary_alias.name, 'espeak-ng-data').symlink_to(espeakng_loader.get_data_path(), target_is_directory=True)
os.environ['ESPEAK_DATA_PATH'] = dictionary_alias.name

logging.getLogger('kokoro_onnx').setLevel(logging.ERROR)
logging.getLogger('jieba').setLevel(logging.ERROR)
ROOT = Path(__file__).parent
LANGS = {'ja': 'j', 'en': 'a', 'en-gb': 'b', 'zh': 'z'}
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='kokoro-metal')
engine = None
pending = 0
SPEECH_TIMEOUT = 90

class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    model: Literal['kokoro'] = 'kokoro'
    input: str = Field(min_length=1, max_length=4096)
    voice: str = 'af_heart'
    language: Literal['ja', 'en', 'en-gb', 'zh']
    speed: float = Field(default=1, ge=0.5, le=2)
    response_format: Literal['wav'] = 'wav'
    stream: Literal[False] = False

class Engine:
    def __init__(self):
        model = Path(os.environ.get('KOKORO_MODEL_DIR', ROOT / 'models'))
        if not mx.metal.is_available():
            raise RuntimeError('Apple Silicon Metal is required; no CPU fallback')
        mx.set_default_device(mx.gpu)
        mx.set_cache_limit(128 * 1024**2)
        config = json.loads((model / 'config.json').read_text())
        self.model = Model(ModelConfig.from_dict(config))
        self.model.load_weights(list(self.model.sanitize(mx.load(str(model / 'kokoro-v1_0.safetensors'))).items()))
        mx.eval(self.model.parameters())
        self.voice_paths = {p.stem: p for p in (model / 'voices').glob('*.safetensors') if re.fullmatch(r'[abjz][fm]_[a-z0-9_]+',p.stem)}
        self.voices = sorted(self.voice_paths)
        self.pipelines = {lang:KokoroPipeline(lang_code=code,model=self.model,repo_id=str(model)) for lang,code in LANGS.items()}
        for lang,text in [('ja','こんにちは。'),('en','Hello.'),('en-gb','Hello.'),('zh','你好。')]:
            if not self.pipelines[lang].g2p(text)[0]:
                raise RuntimeError('Bundled dictionary unavailable')

    def pieces(self, text, pipeline):
        for paragraph in re.split(r'\n+', text.strip()):
            if not paragraph.strip(): continue
            if pipeline.lang_code in 'ab':
                yield paragraph
                continue
            stack = [paragraph]
            while stack:
                part = stack.pop()
                phonemes = pipeline.g2p(part)[0]
                if len(phonemes) <= 500:
                    yield part
                else:
                    if len(part)<2: raise ValueError('Cannot split phonemes')
                    middle=len(part)//2
                    boundaries=[m.end() for m in re.finditer(r'[。！？.!?；;,，]\s*',part) if m.end()<len(part)]
                    cut=min(boundaries,key=lambda n:abs(n-middle)) if boundaries else middle
                    stack.extend([part[cut:],part[:cut]])

    def synthesize(self, request):
        chunks=[]
        pipeline=self.pipelines[request.language]
        with mx.stream(mx.gpu):
            for piece in self.pieces(request.input,pipeline):
                for result in pipeline(piece,voice=str(self.voice_paths[request.voice]),speed=request.speed):
                    if result.audio is not None:
                        mx.eval(result.audio)
                        chunks.append(np.asarray(result.audio,dtype=np.float32).reshape(-1))
        if not chunks: raise ValueError('No spoken phonemes')
        audio=np.concatenate(chunks)
        if not np.isfinite(audio).all() or not np.any(audio) or len(audio)>24000*600:
            raise ValueError('Invalid or excessive audio')
        output=io.BytesIO()
        sf.write(output,np.clip(audio,-1,1),24000,format='WAV',subtype='PCM_16')
        return output.getvalue()

@asynccontextmanager
async def lifespan(app):
    global engine
    engine = await asyncio.get_running_loop().run_in_executor(executor, Engine)
    print('Bundled Kokoro ready (MLX Metal, offline)', flush=True)
    yield
    executor.shutdown(wait=True, cancel_futures=True)

app = FastAPI(title='ChainFlow built-in Kokoro', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

@app.exception_handler(RequestValidationError)
async def invalid_parameters(_request, _error):
    return JSONResponse({'detail': 'Invalid TTS parameters'}, status_code=422, headers={'Cache-Control': 'no-store'})

@app.middleware('http')
async def no_cache_and_size(request: Request, call_next):
    if request.headers.get('authorization'):
        return JSONResponse({'detail': 'Built-in Kokoro needs no key'}, status_code=400, headers={'Cache-Control': 'no-store'})
    if int(request.headers.get('content-length', '0') or 0) > 30000:
        return JSONResponse({'detail': 'Request too large'}, status_code=413, headers={'Cache-Control': 'no-store'})
    # Bound even chunked input before parsing, without printing or retaining text.
    if request.method == 'POST':
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 30000:
                return JSONResponse({'detail': 'Request too large'}, status_code=413, headers={'Cache-Control': 'no-store'})
        request._body = bytes(body)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    return response

@app.get('/health')
def health():
    return {'ok': engine is not None, 'model': 'kokoro', 'backend': 'mlx-metal', 'metal': mx.metal.is_available(), 'offline': True, 'pending': pending}

@app.get('/v1/audio/voices')
def voices():
    return {'voices': engine.voices}

@app.post('/v1/audio/speech')
async def speech(request: SpeechRequest):
    global pending
    if not request.input.strip() or request.voice not in engine.voices or request.voice[0] != LANGS[request.language]:
        raise HTTPException(400, 'Invalid text or language/voice combination')
    if pending >= 1:
        raise HTTPException(429, 'Kokoro busy', headers={'Retry-After': '2'})
    pending += 1
    future = asyncio.get_running_loop().run_in_executor(executor, engine.synthesize, request)
    def finished(_):
        global pending
        pending -= 1
    future.add_done_callback(finished)
    # Client cancellation never frees the model slot until Metal work has finished.
    try:
        data = await asyncio.wait_for(asyncio.shield(future), timeout=SPEECH_TIMEOUT)
    except asyncio.TimeoutError:
        raise HTTPException(504, 'Speech timeout') from None
    except ValueError:
        raise HTTPException(400, 'Text cannot be synthesized') from None
    except Exception:
        raise HTTPException(500, 'Speech synthesis failed') from None
    return Response(data, media_type='audio/wav', headers={'X-TTS-Backend': 'kokoro-mlx-metal'})

if __name__ == '__main__':
    # A killed launcher must not leave a model process running indefinitely.
    parent = int(os.environ.get('CHAINFLOW_PARENT_PID', '0'))
    if parent > 1:
        def watch_parent():
            while True:
                time.sleep(2)
                try:
                    os.kill(parent, 0)
                except ProcessLookupError:
                    dictionary_alias.cleanup()
                    os._exit(0)
        threading.Thread(target=watch_parent, daemon=True).start()
    import uvicorn
    uvicorn.run(app, host=os.environ.get('KOKORO_HOST', '127.0.0.1'), port=int(os.environ.get('KOKORO_PORT', '8881')), access_log=False)
