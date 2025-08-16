# Test Image Management API

Tento dokument obsahuje příklady testování image management API.

## Předpoklady

1. Server běží na `http://localhost:3001`
2. Máte autentizovaného uživatele s access tokenem
3. Máte vytvořený projekt s známým ID

## Získání access tokenu

```bash
# Přihlášení uživatele
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "securePassword123"
  }'

# Uložte accessToken z odpovědi
export ACCESS_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## 1. Upload obrázků do projektu

```bash
# Upload jednoho obrázku (simulace)
curl -X POST http://localhost:3001/api/projects/{PROJECT_ID}/images \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "images=@path/to/image1.jpg"

# Upload více obrázků najednou
curl -X POST http://localhost:3001/api/projects/{PROJECT_ID}/images \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "images=@path/to/image1.jpg" \
  -F "images=@path/to/image2.png" \
  -F "images=@path/to/image3.bmp"
```

### Testování s dummy daty (bez skutečných souborů)

Bohužel multer vyžaduje skutečné soubory. Můžete vytvořit testovací obrázky:

```bash
# Vytvoření testovacích obrázků (pokud máte ImageMagick)
convert -size 100x100 xc:red test1.jpg
convert -size 200x150 xc:blue test2.png
convert -size 300x200 xc:green test3.bmp

# Nebo stáhněte testovací obrázky
curl -o test1.jpg "https://via.placeholder.com/100x100/FF0000/FFFFFF.jpg"
curl -o test2.png "https://via.placeholder.com/200x150/0000FF/FFFFFF.png"
```

## 2. Získání seznamu obrázků v projektu

```bash
# Základní seznam
curl -X GET http://localhost:3001/api/projects/{PROJECT_ID}/images \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# S paginací
curl -X GET "http://localhost:3001/api/projects/{PROJECT_ID}/images?page=1&limit=10" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# S filtrem podle statusu
curl -X GET "http://localhost:3001/api/projects/{PROJECT_ID}/images?status=pending" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# S řazením
curl -X GET "http://localhost:3001/api/projects/{PROJECT_ID}/images?sortBy=fileSize&sortOrder=desc" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Kombinace parametrů
curl -X GET "http://localhost:3001/api/projects/{PROJECT_ID}/images?page=1&limit=5&status=completed&sortBy=createdAt&sortOrder=asc" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## 3. Získání detailu konkrétního obrázku

```bash
# Detail obrázku
curl -X GET http://localhost:3001/api/projects/{PROJECT_ID}/images/{IMAGE_ID} \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## 4. Smazání obrázku

```bash
# Smazání obrázku (včetně souborů ze storage)
curl -X DELETE http://localhost:3001/api/projects/{PROJECT_ID}/images/{IMAGE_ID} \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## 5. Statistiky obrázků v projektu

```bash
# Celkové statistiky
curl -X GET http://localhost:3001/api/projects/{PROJECT_ID}/images/stats \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## 6. Přístup k nahraným souborům

```bash
# Originální obrázek
curl -X GET http://localhost:3001/uploads/{userId}/{projectId}/originals/{filename} \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Thumbnail
curl -X GET http://localhost:3001/uploads/{userId}/{projectId}/thumbnails/{filename} \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Poznámka: Pro skutečnou aplikaci budete potřebovat implementovat autentizaci pro statické soubory
```

## Očekávané odpovědi

### Úspěšný upload

```json
{
  "success": true,
  "message": "Úspěšně nahráno 2 obrázků",
  "data": {
    "images": [
      {
        "id": "uuid-image-1",
        "name": "image1.jpg",
        "originalPath": "userId/projectId/originals/timestamp_image1.jpg",
        "thumbnailPath": "userId/projectId/thumbnails/timestamp_image1.jpg",
        "projectId": "project-uuid",
        "segmentationStatus": "pending",
        "fileSize": 153456,
        "width": 1920,
        "height": 1080,
        "mimeType": "image/jpeg",
        "createdAt": "2023-...",
        "updatedAt": "2023-...",
        "originalUrl": "/uploads/userId/projectId/originals/timestamp_image1.jpg",
        "thumbnailUrl": "/uploads/userId/projectId/thumbnails/timestamp_image1.jpg"
      }
    ],
    "count": 2
  }
}
```

### Seznam obrázků

```json
{
  "success": true,
  "message": "Seznam obrázků úspěšně načten",
  "data": {
    "images": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### Statistiky

```json
{
  "success": true,
  "message": "Statistiky obrázků úspěšně načteny",
  "data": {
    "stats": {
      "totalImages": 45,
      "totalSize": 157286400,
      "byStatus": {
        "pending": 12,
        "processing": 5,
        "completed": 25,
        "failed": 3
      },
      "byMimeType": {
        "image/jpeg": 30,
        "image/png": 10,
        "image/bmp": 3,
        "image/tiff": 2
      }
    }
  }
}
```

## Testování chybových stavů

```bash
# Upload bez souborů
curl -X POST http://localhost:3001/api/projects/{PROJECT_ID}/images \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Upload nepodporovaného formátu
curl -X POST http://localhost:3001/api/projects/{PROJECT_ID}/images \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "images=@document.pdf"

# Přístup k cizímu projektu
curl -X GET http://localhost:3001/api/projects/{OTHER_USER_PROJECT_ID}/images \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Neexistující obrázek
curl -X GET http://localhost:3001/api/projects/{PROJECT_ID}/images/non-existent-uuid \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Podporované formáty a limity

- **Podporované formáty**: JPG, JPEG, PNG, BMP, TIFF, TIF
- **Maximální velikost souboru**: 10MB
- **Maximální počet souborů v jednom požadavku**: 20
- **Automatické generování thumbnailů**: 300x300px (JPEG, kvalita 85%)

## Bezpečnostní poznámky

1. Všechny endpointy vyžadují autentizaci
2. Uživatelé mají přístup pouze ke svým projektům
3. Soubory jsou ukládány s časovým razítkem pro zabránění konfliktů
4. Podporovány jsou pouze povolené MIME typy
5. Velikost souborů je omezena

## Troubleshooting

### Časté chyby

1. **"Je nutné vybrat alespoň jeden soubor"** - Nezapomeňte přidat soubor do požadavku
2. **"Nepodporovaný formát souboru"** - Použijte pouze podporované formáty obrázků
3. **"Soubor je příliš velký"** - Zmenšete velikost souboru pod 10MB
4. **"Projekt nenalezen nebo nemáte oprávnění"** - Zkontrolujte ID projektu a oprávnění
5. **401 Unauthorized** - Zkontrolujte autentizační token