import json
import os
import sys

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


model_dir = os.environ['PAPERQUAY_BENCHMARK_MODEL_DIR']
tokenizer = Tokenizer.from_file(os.path.join(model_dir, 'tokenizer.json'))
tokenizer.enable_truncation(max_length=128)
session = ort.InferenceSession(
    os.path.join(model_dir, 'onnx', 'model_quantized.onnx'),
    providers=['CPUExecutionProvider'],
)
vectors = []
for text in json.load(sys.stdin.buffer):
    encoded = tokenizer.encode(text)
    inputs = {
        'input_ids': np.array([encoded.ids], dtype=np.int64),
        'attention_mask': np.array([encoded.attention_mask], dtype=np.int64),
        'token_type_ids': np.array([encoded.type_ids], dtype=np.int64),
    }
    hidden = session.run(None, inputs)[0]
    mask = inputs['attention_mask'][..., None]
    vector = (hidden * mask).sum(axis=1)[0] / mask.sum()
    vector /= np.linalg.norm(vector)
    vectors.append(vector.tolist())
json.dump(vectors, sys.stdout)
