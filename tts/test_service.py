import asyncio
import threading
import unittest
from unittest.mock import patch
import httpx
import service

DATA = {'model':'kokoro','input':'フレーム','voice':'jf_alpha','language':'ja','speed':1,'response_format':'wav','stream':False}

class FakeEngine:
    voices = ['jf_alpha', 'af_heart', 'bf_emma', 'zf_xiaobei']
    def __init__(self):
        self.calls = 0
        self.gate = None
        self.entered = threading.Event()
    def synthesize(self, request):
        self.calls += 1
        self.entered.set()
        if self.gate:
            self.gate.wait(1)
        return b'RIFF' + b'\0'*4 + b'WAVE' + b'\0'*32

class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = FakeEngine()
        self.patch = patch.object(service, 'engine', self.engine)
        self.patch.start()
        service.pending = 0
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=service.app), base_url='http://localhost')
    async def asyncTearDown(self):
        await self.client.aclose()
        self.patch.stop()
    async def test_binary_no_cache_and_separate_synthesis(self):
        for _ in range(2):
            response = await self.client.post('/v1/audio/speech', json=DATA)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.headers['cache-control'],'no-store')
            self.assertEqual(response.content[8:12],b'WAVE')
        self.assertEqual(self.engine.calls,2)
        self.assertEqual(service.pending,0)
    async def test_guards_and_voice_discovery_never_invoke_model(self):
        self.assertEqual((await self.client.get('/v1/audio/voices')).json()['voices'],self.engine.voices)
        for change, code in [({'voice':'af_heart'},400),({'model':'remote-model'},422),({'input':'x'*4097},422),({'speed':0.3},422),({'input':' '},400),({'stream':True},422)]:
            self.assertEqual((await self.client.post('/v1/audio/speech',json={**DATA,**change})).status_code,code)
        self.assertEqual((await self.client.post('/v1/audio/speech',json=DATA,headers={'Authorization':'Bearer not-a-real-key'})).status_code,400)
        self.assertEqual((await self.client.post('/v1/audio/speech',content=b'x'*30001)).status_code,413)
        self.assertEqual(self.engine.calls,0)
    async def test_timeout_does_not_release_cpu_slot_while_work_remains(self):
        self.engine.gate=threading.Event()
        with patch.object(service,'SPEECH_TIMEOUT',0.025):
            first=asyncio.create_task(self.client.post('/v1/audio/speech',json=DATA))
            for _ in range(100):
                if self.engine.entered.is_set():break
                await asyncio.sleep(0.002)
            self.assertEqual((await self.client.post('/v1/audio/speech',json=DATA)).status_code,429)
            self.assertEqual((await first).status_code,504)
            self.assertEqual(service.pending,1)
            self.assertEqual((await self.client.post('/v1/audio/speech',json=DATA)).status_code,429)
            self.engine.gate.set()
            for _ in range(100):
                if service.pending==0:break
                await asyncio.sleep(0.002)
            self.assertEqual(service.pending,0)
            self.assertEqual((await self.client.post('/v1/audio/speech',json=DATA)).status_code,200)

if __name__=='__main__': unittest.main()
