"""Project-owned, offline Kokoro ONNX service; generated audio only lives in RAM."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import io
import logging
import os
from pathlib import Path
import re
import time
from typing import Literal

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
import numpy as np
import onnxruntime as ort
import soundfile as sf
import unidic
import unidic_lite
unidic.DICDIR = unidic_lite.DICDIR
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from kokoro_onnx import Kokoro
from misaki import en, ja, zh, espeak

logging.getLogger('kokoro_onnx').setLevel(logging.ERROR)
logging.getLogger('jieba').setLevel(logging.ERROR)
ROOT = Path(__file__).parent
LANGS = {'ja': 'j', 'en': 'a', 'en-gb': 'b', 'zh': 'z'}
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='kokoro-cpu')
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
        options = ort.SessionOptions()
        options.intra_op_num_threads = int(os.environ.get('KOKORO_THREADS', '2'))
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(model / 'kokoro-v1.0.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
        self.kokoro = Kokoro.from_session(session, str(model / 'voices-v1.0.bin'))
        self.voices = [v for v in self.kokoro.get_voices() if re.fullmatch(r'[abjz][fm]_[a-z0-9_]+', v)]
        self.g2p = {
            'ja': ja.JAG2P(),
            'en': en.G2P(trf=False, british=False, fallback=espeak.EspeakFallback(british=False)),
            'en-gb': en.G2P(trf=False, british=True, fallback=espeak.EspeakFallback(british=True)),
            'zh': zh.ZHG2P(),
        }
        for language, text in [('ja', 'こんにちは。'), ('en', 'Hello.'), ('en-gb', 'Hello.'), ('zh', '你好。')]:
            if not self.g2p[language](text)[0]:
                raise RuntimeError('Bundled phoneme dictionary unavailable')

    def synthesize(self, request):
        phonemes = self.g2p[request.language](request.input)[0]
        if not phonemes or not phonemes.strip():
            raise ValueError('No spoken phonemes')
        audio, rate = self.kokoro.create(phonemes, voice=request.voice, speed=request.speed, is_phonemes=True)
        if not np.isfinite(audio).all() or not np.any(audio) or len(audio) > 24000 * 600:
            raise ValueError('Invalid or excessive audio')
        output = io.BytesIO()
        sf.write(output, np.clip(audio, -1, 1), rate, format='WAV', subtype='PCM_16')
        return output.getvalue()

@asynccontextmanager
async def lifespan(app):
    global engine
    engine = await asyncio.get_running_loop().run_in_executor(executor, Engine)
    print('Bundled Kokoro ready (ONNX CPU, offline)', flush=True)
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
    return {'ok': engine is not None, 'model': 'kokoro', 'backend': 'onnx-cpu', 'offline': True, 'pending': pending}

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
    # Client cancellation never frees the model slot until CPU work has finished.
    try:
        data = await asyncio.wait_for(asyncio.shield(future), timeout=SPEECH_TIMEOUT)
    except asyncio.TimeoutError:
        raise HTTPException(504, 'Speech timeout') from None
    except ValueError:
        raise HTTPException(400, 'Text cannot be synthesized') from None
    except Exception:
        raise HTTPException(500, 'Speech synthesis failed') from None
    return Response(data, media_type='audio/wav', headers={'X-TTS-Backend': 'kokoro-onnx-cpu'})

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host=os.environ.get('KOKORO_HOST', '127.0.0.1'), port=int(os.environ.get('KOKORO_PORT', '8881')), access_log=False)
