import unittest
from unittest.mock import patch
from types import SimpleNamespace
import service

class MlxTests(unittest.TestCase):
    def test_metal_is_required_without_cpu_fallback(self):
        with patch.object(service.mx.metal, 'is_available', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'Metal is required'):
                service.Engine()

    def test_long_cjk_text_is_split_without_truncation(self):
        engine = object.__new__(service.Engine)
        pipeline = SimpleNamespace(lang_code='j', g2p=lambda text: (text * 3, None))
        text = ('これは長い文章です。' * 110)
        pieces = list(engine.pieces(text, pipeline))
        self.assertEqual(''.join(pieces), text)
        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(len(pipeline.g2p(piece)[0]) <= 500 for piece in pieces))

if __name__ == '__main__': unittest.main()
