# Project API - Test Examples

Tato dokumentace obsahuje příklady testování Project API pomocí curl příkazů.

## Předpoklady

1. Server běží na `http://localhost:3001`
2. Máte platný JWT token (získaný z auth API)
3. Váš účet má ověřený email

## Získání JWT tokenu

Nejprve se přihlaste pro získání JWT tokenu:

```bash
# Přihlášení
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

Zkopírujte `accessToken` z odpovědi a použijte ho v následujících příkazech.

## Testovací příkazy

### 1. Vytvoření nového projektu
```bash
curl -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "title": "Testovací projekt",
    "description": "Popis testovacího projektu pro segmentaci buněk"
  }'
```

### 2. Získání seznamu projektů s paginací
```bash
# Základní požadavek
curl -X GET http://localhost:3001/api/projects \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# S parametry paginace a vyhledávání
curl -X GET "http://localhost:3001/api/projects?page=1&limit=5&search=test&sortBy=title&sortOrder=asc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Získání konkrétního projektu
```bash
curl -X GET http://localhost:3001/api/projects/PROJECT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Aktualizace projektu
```bash
curl -X PUT http://localhost:3001/api/projects/PROJECT_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "title": "Aktualizovaný název projektu",
    "description": "Nový popis projektu"
  }'
```

### 5. Získání statistik projektu
```bash
curl -X GET http://localhost:3001/api/projects/PROJECT_ID/stats \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 6. Smazání projektu
```bash
curl -X DELETE http://localhost:3001/api/projects/PROJECT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Očekávané odpovědi

### Úspěšné vytvoření projektu (201)
```json
{
  "success": true,
  "data": {
    "id": "uuid-projektu",
    "title": "Testovací projekt",
    "description": "Popis testovacího projektu pro segmentaci buněk",
    "userId": "user-uuid",
    "createdAt": "2025-08-14T18:00:00.000Z",
    "updatedAt": "2025-08-14T18:00:00.000Z",
    "user": {
      "id": "user-uuid",
      "email": "test@example.com"
    },
    "_count": {
      "images": 0
    }
  },
  "message": "Projekt byl úspěšně vytvořen"
}
```

### Paginovaný seznam projektů (200)
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-projektu",
      "title": "Testovací projekt",
      "description": "Popis projektu",
      "userId": "user-uuid",
      "createdAt": "2025-08-14T18:00:00.000Z",
      "updatedAt": "2025-08-14T18:00:00.000Z",
      "_count": {
        "images": 3
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  },
  "message": "Projekty byly úspěšně načteny"
}
```

### Detail projektu s obrázky (200)
```json
{
  "success": true,
  "data": {
    "id": "uuid-projektu",
    "title": "Testovací projekt",
    "description": "Popis projektu",
    "userId": "user-uuid",
    "createdAt": "2025-08-14T18:00:00.000Z",
    "updatedAt": "2025-08-14T18:00:00.000Z",
    "user": {
      "id": "user-uuid",
      "email": "test@example.com"
    },
    "images": [
      {
        "id": "image-uuid",
        "name": "sample.jpg",
        "segmentationStatus": "completed",
        "createdAt": "2025-08-14T18:30:00.000Z",
        "fileSize": 1024000,
        "width": 1920,
        "height": 1080,
        "mimeType": "image/jpeg"
      }
    ],
    "_count": {
      "images": 1
    }
  },
  "message": "Projekt byl úspěšně načten"
}
```

### Statistiky projektu (200)
```json
{
  "success": true,
  "data": {
    "project": {
      "id": "uuid-projektu",
      "title": "Testovací projekt",
      "createdAt": "2025-08-14T18:00:00.000Z",
      "updatedAt": "2025-08-14T18:00:00.000Z"
    },
    "images": {
      "total": 10,
      "byStatus": {
        "pending": 2,
        "processing": 1,
        "completed": 6,
        "failed": 1
      },
      "totalFileSize": 52428800
    },
    "segmentations": {
      "total": 6
    },
    "progress": {
      "completionPercentage": 60,
      "completedImages": 6,
      "remainingImages": 4
    }
  },
  "message": "Statistiky projektu byly úspěšně načteny"
}
```

## Chybové odpovědi

### Neautorizovaný přístup (401)
```json
{
  "success": false,
  "error": "Chybí autentizační token"
}
```

### Projekt nenalezen (404)
```json
{
  "success": false,
  "error": "Projekt nebyl nalezen nebo k němu nemáte oprávnění"
}
```

### Validační chyba (400)
```json
{
  "success": false,
  "error": "Validační chyba"
}
```

## Bezpečnost a oprávnění

- Všechny endpointy vyžadují autentizaci (JWT token)
- Všechny endpointy vyžadují ověřený email
- Uživatelé mohou přistupovat pouze ke svým vlastním projektům
- Kontrola vlastnictví probíhá automaticky na úrovni service layer
- Při smazání projektu se automaticky smažou všechny související obrázky a segmentace (cascade delete)