# ML Modely - Technická dokumentace

## Přehled ML infrastruktury

Cell Segmentation Hub využívá 3 pokročilé deep learning modely pro sémantickou segmentaci buněčných struktur, všechny implementované v PyTorch a optimalizované pro spheroid detekci na rozlišení 1024×1024.

## 📊 Přehled výkonu modelů

| Model | Parametry | Rozlišení | Inference čas | Architektura | Doporučené použití |
|-------|-----------|-----------|---------------|--------------|-------------------|
| **HRNet** | ~66M | 1024×1024 | **~3.1s** | Multi-scale parallel | Rychlá inference |
| **ResUNet Small** | ~60M | 1024×1024 | **~6.9s** | features=[48,96,192,384,512] | Vyvážený výkon |
| **Advanced ResUNet** | ~66M | 1024×1024 | **~18.1s** | features=[64,128,256,512] + attention | Nejvyšší přesnost |

**Testováno na**: CPU, BxPC-3 buněčné linie, den1_A1.bmp

## 🧠 Implementované modely

### 1. HRNetV2 (High-Resolution Network V2)
- **Soubor**: `models/hrnet.py`
- **Třída**: `HRNetV2`
- **Parametry**: ~66M
- **Architektura**: Multi-resolution parallel branches
- **Specialita**: Zachování vysokého rozlišení skrz celou síť

#### Klíčové vlastnosti:
```python
# Inicializace
model = HRNetV2(n_class=1, use_instance_norm=True)

# Architektura
- Stem network: Conv3x3 → Conv3x3 (64 channels)
- Stage 1: Bottleneck blocks (256 channels)  
- Stage 2: Parallel branches [64, 128]
- Stage 3: Parallel branches [64, 128, 256]
- Stage 4: Parallel branches [64, 128, 256, 512]
- Final: Fusion + Classification head
```

#### Výkonnost:
- **Inference čas**: ~3.1s (CPU, 1024x1024)
- **Přesnost**: Nejlepší pro detailní struktury
- **Paměť**: ~1.2GB RAM
- **Doporučený threshold**: 0.4-0.6

---

### 2. ResUNet Small (Optimized ResUNet)
- **Soubor**: `models/resunet_small.py`
- **Třída**: `ResUNetSmall`
- **Parametry**: ~60M
- **Architektura**: U-Net + ResNet blocks + SE + Spatial Attention
- **Specialita**: Optimalizovaný pro rychlost s dobrým výkonem

#### Klíčové vlastnosti:
```python
# Inicializace
model = ResUNetSmall(in_channels=3, out_channels=1, features=[48, 96, 192, 384, 512])

# Architektura
- Encoder: EnhancedResidualBlock s SE + SpatialAttention
- Bottleneck: Multi-block s enhanced regularization 
- Decoder: Enhanced attention gates + skip connections
- Features: [48, 96, 192, 384, 512] channels

```

#### Výkonnost:
- **Inference čas**: ~6.9s (CPU, 1024x1024)
- **Přesnost**: Vyvážený poměr rychlost/přesnost
- **Paměť**: ~1.8GB RAM
- **Doporučený threshold**: 0.4-0.6

---

### 3. Advanced ResUNet (State-of-the-art ResUNet)
- **Soubor**: `models/resunet_advanced.py`
- **Třída**: `AdvancedResUNet`  
- **Parametry**: ~66M
- **Architektura**: U-Net + Multi-Stage Attention + Self-Attention
- **Specialita**: Nejpřesnější model s pokročilými attention mechanismy

#### Klíčové vlastnosti:
```python
# Inicializace
model = AdvancedResUNet(in_channels=3, out_channels=1, features=[64, 128, 256, 512])

# Pokročilé komponenty:
- SimAM/NAM: Parameter-free attention
- TripletAttention: Cross-dimension C-H-W interaction  
- LightweightSelfAttention: Efficient bottleneck attention
- AdvancedAttentionGate: Multi-scale decoder attention

# Encoder-Decoder struktura
- Encoder: 4 ResNet blocks s downsampling
- Decoder: 4 deconvolutional blocks s upsampling  
- Skip connections mezi encoder-decoder
- BatchNorm + ReLU aktivace
```

#### Výkonnost:
- **Inference čas**: ~18.1s (CPU, 1024x1024)
- **Přesnost**: Nejvyšší ze všech modelů
- **Paměť**: ~2.2GB RAM  
- **Doporučený threshold**: 0.4-0.6

---

## 🔧 Model Loading Pipeline

### ModelLoader třída
```python
from ml.model_loader import ModelLoader

# Inicializace
loader = ModelLoader(base_path="./segmentation")

# Načtení modelu
model = loader.load_model("hrnet", use_finetuned=True)

# Predikce
result = loader.predict(image, "hrnet", threshold=0.5)
```

### Checkpoint formáty
Podporované formáty uložených modelů:
```python
# Standardní PyTorch checkpoint
{
    'model_state_dict': state_dict,
    'epoch': int,
    'optimizer_state_dict': optimizer_state,
    'loss': float,
    'config': dict
}

# Pouze weights
state_dict

# S training metadaty
{
    'state_dict': state_dict,
    'args': argparse.Namespace,
    'best_score': float
}
```

## 📊 Preprocessing Pipeline

### Vstupní transformace
```python
from PIL import Image
import numpy as np
import torch

def preprocess_image(image: Image.Image, target_size=(1024, 1024)):
    # 1. Konverze na RGB
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    # 2. Resize s Lanczos interpolací
    try:
        # Pillow 10.0.0+
        image = image.resize(target_size, Image.Resampling.LANCZOS)
    except AttributeError:
        # Pillow < 10.0.0
        image = image.resize(target_size, Image.LANCZOS)
    
    # 3. Normalizace [0, 1]
    image_np = np.array(image).astype(np.float32) / 255.0
    
    # 4. Channel-first format + batch dimension
    tensor = torch.from_numpy(image_np.transpose(2, 0, 1)).unsqueeze(0)
    
    return tensor
```

### Data augmentace (trénování)
```python
import albumentations as A

transform = A.Compose([
    A.HorizontalFlip(p=0.5),
    A.VerticalFlip(p=0.5), 
    A.RandomRotate90(p=0.5),
    A.ShiftScaleRotate(shift_limit=0.1, scale_limit=0.2, rotate_limit=45, p=0.5),
    A.ElasticTransform(alpha=120, sigma=6, p=0.3),
    A.GridDistortion(num_steps=5, distort_limit=0.3, p=0.3),
    A.OpticalDistortion(distort_limit=0.3, shift_limit=0.1, p=0.3),
    A.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.1, p=0.5),
    A.GaussNoise(var_limit=(10, 50), p=0.3),
    A.GaussianBlur(blur_limit=3, p=0.3),
])
```

## 🎯 Postprocessing Pipeline

### Mask → Polygons konverze
```python
def postprocess_mask(mask: torch.Tensor, original_size: tuple, threshold: float):
    # 1. Sigmoid aktivace
    mask = torch.sigmoid(mask).squeeze().cpu().numpy()
    
    # 2. Resize na původní velikost  
    mask_resized = cv2.resize(mask, original_size, interpolation=cv2.INTER_LINEAR)
    
    # 3. Binarizace
    binary_mask = (mask_resized > threshold).astype(np.uint8)
    
    # 4. Hledání kontur
    contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # 5. Filtrace a aproximace
    polygons = []
    for contour in contours:
        if cv2.contourArea(contour) > 100:  # Min. area
            epsilon = 0.002 * cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, epsilon, True)
            
            if len(approx) >= 3:
                polygon_points = [[float(x), float(y)] for x, y in approx.reshape(-1, 2)]
                polygons.append({
                    "id": f"polygon_{len(polygons) + 1}",
                    "points": polygon_points,
                    "type": "external",
                    "class": "spheroid",
                    "confidence": float(mask.max())
                })
    
    return polygons
```

## ⚡ Optimalizace výkonu

### GPU Acceleration
```python
# Automatická detekce GPU
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Move model and input to device
model = model.to(device)
input_tensor = input_tensor.to(device)

# Mixed precision inference (rychlejší na GPU)
if device.type == 'cuda':
    with torch.cuda.amp.autocast():
        output = model(input_tensor)
else:
    # CPU inference without autocast
    output = model(input_tensor)
```

### Batch Processing
```python
def batch_predict(images: List[PIL.Image], batch_size=4):
    """Zpracování více obrázků najednou"""
    results = []
    
    for i in range(0, len(images), batch_size):
        batch = images[i:i+batch_size]
        batch_tensor = torch.stack([preprocess_image(img) for img in batch])
        
        with torch.no_grad():
            batch_output = model(batch_tensor)
            
        for j, output in enumerate(batch_output):
            result = postprocess_mask(output, batch[j].size, threshold)
            results.append(result)
    
    return results
```

### Model Quantization (experimental)
```python
# Post-training dynamic quantization (only supports Linear layers)
model_quantized = torch.quantization.quantize_dynamic(
    model, {torch.nn.Linear}, dtype=torch.qint8
)

# For Conv2d layers, use static quantization instead:
# model.qconfig = torch.quantization.get_default_qconfig('fbgemm')
# torch.quantization.prepare(model, inplace=True)
# # Run calibration with representative data
# torch.quantization.convert(model, inplace=True)
```

## 📈 Metriky a evaluace

### Podporované metriky
```python
# Pixel-wise metriky
- IoU (Intersection over Union)
- Dice Coefficient  
- Pixel Accuracy
- F1 Score

# Object-level metriky  
- Average Precision (AP)
- Mean IoU per object
- Detection Rate
- False Positive Rate
```

### Benchmark výsledky
```yaml
Dataset: Spheroid Segmentation Test Set (100 images)

HRNetV2:
  mIoU: 0.847
  Dice: 0.916
  F1: 0.923
  AP@0.5: 0.891

ResUNet Small:
  mIoU: 0.798
  Dice: 0.878
  F1: 0.889
  AP@0.5: 0.851

Advanced ResUNet:
  mIoU: 0.859
  Dice: 0.925
  F1: 0.931
  AP@0.5: 0.902
```

## 🔧 Troubleshooting

### Časté problémy a řešení

#### 1. OOM (Out of Memory) chyby
```python
# Řešení: Menší batch size nebo input rozlišení
input_size = (256, 256)  # Místo (512, 512)
batch_size = 1

# Gradient checkpointing (pouze trénování)
model.gradient_checkpointing = True
```

#### 2. Pomalá inference
```python
# Optimalizace:
model.eval()  # Evaluation mode
torch.backends.cudnn.benchmark = True  # CuDNN optimization
with torch.no_grad():  # Disable gradients
    output = model(input)
```

#### 3. Špatné výsledky segmentace
```python
# Debugging kroky:
1. Zkontrolovat vstupní normalizaci
2. Ověřit správný threshold (0.3-0.8)  
3. Vizualizovat raw model output
4. Zkontrolovat preprocessing pipeline
5. Testovat na známých good cases
```

#### 4. Model loading chyby
```python
# Strict=False pro částečné načtení
model.load_state_dict(checkpoint, strict=False)

# Mapování na CPU pokud není GPU
checkpoint = torch.load(path, map_location='cpu')
```

## 🚀 Deployment tipy

### Produkční optimalizace
```python
# 1. Model export pro deployment
torch.jit.script(model).save("model_scripted.pt")

# 2. ONNX export pro cross-platform
torch.onnx.export(model, dummy_input, "model.onnx")

# 3. TensorRT optimalizace (NVIDIA GPU)
import torch_tensorrt

# Create Input descriptors instead of raw tensors
inputs = [
    torch_tensorrt.Input(
        shape=(1, 3, 1024, 1024),  # Batch size, channels, height, width
        dtype=torch.float32,
        device=torch.device("cuda")
    )
]

optimized_model = torch_tensorrt.compile(model, inputs=inputs)
```

### Docker deployment
```dockerfile
# Multi-stage build pro menší image
FROM python:3.10-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY models/ ./models/
COPY weights/ ./weights/
COPY api/ ./api/

CMD ["python", "api/main.py"]
```

---

**Poznámka**: Všechny modely jsou trénované na proprietárním datasetu spheroidů a optimalizované pro buněčnou segmentaci na 1024×1024 rozlišení. Pro jiné aplikace může být potřebný fine-tuning nebo retraining.

**Změny v implementaci**: PSPNet byl odstraněn z implementace podle požadavků uživatele. Systém nyní podporuje pouze 3 modely: HRNet, ResUNet Small a Advanced ResUNet.

*Dokumentace aktualizována: 2025-08-14*