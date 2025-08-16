#!/bin/bash

# Test script pro Project API
# Použití: ./test-projects.sh

BASE_URL="http://localhost:3001"
CONTENT_TYPE="Content-Type: application/json"

echo "=== Project API Test Script ==="
echo ""

# 1. Přihlášení pro získání JWT tokenu
echo "1. Přihlašování..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "$CONTENT_TYPE" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }')

echo "Login response: $LOGIN_RESPONSE"
echo ""

# Extrakce JWT tokenu z odpovědi
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
    echo "❌ Nepodařilo se získat access token. Ukončuji test."
    exit 1
fi

echo "✅ Access token získán: ${ACCESS_TOKEN:0:20}..."
echo ""

# 2. Test neautorizovaného přístupu
echo "2. Test neautorizovaného přístupu..."
curl -s -X GET "$BASE_URL/api/projects" | echo "Response: $(cat)"
echo ""

# 3. Vytvoření nového projektu
echo "3. Vytvoření nového projektu..."
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/projects" \
  -H "$CONTENT_TYPE" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "title": "Test Projekt API",
    "description": "Testovací projekt vytvořený API testem"
  }')

echo "Create response: $CREATE_RESPONSE"
echo ""

# Extrakce ID projektu
PROJECT_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$PROJECT_ID" ]; then
    echo "❌ Nepodařilo se vytvořit projekt. Ukončuji test."
    exit 1
fi

echo "✅ Projekt vytvořen s ID: $PROJECT_ID"
echo ""

# 4. Získání seznamu projektů
echo "4. Získání seznamu projektů..."
curl -s -X GET "$BASE_URL/api/projects" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | echo "List response: $(cat)"
echo ""

# 5. Získání konkrétního projektu
echo "5. Získání konkrétního projektu..."
curl -s -X GET "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | echo "Get project response: $(cat)"
echo ""

# 6. Aktualizace projektu
echo "6. Aktualizace projektu..."
curl -s -X PUT "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "$CONTENT_TYPE" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "title": "Aktualizovaný Test Projekt",
    "description": "Aktualizovaný popis projektu"
  }' | echo "Update response: $(cat)"
echo ""

# 7. Získání statistik projektu
echo "7. Získání statistik projektu..."
curl -s -X GET "$BASE_URL/api/projects/$PROJECT_ID/stats" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | echo "Stats response: $(cat)"
echo ""

# 8. Test paginace a vyhledávání
echo "8. Test paginace a vyhledávání..."
curl -s -X GET "$BASE_URL/api/projects?page=1&limit=5&search=test&sortBy=title&sortOrder=asc" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | echo "Search response: $(cat)"
echo ""

# 9. Test s neplatným ID projektu
echo "9. Test s neplatným ID projektu..."
curl -s -X GET "$BASE_URL/api/projects/neplatne-uuid" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | echo "Invalid ID response: $(cat)"
echo ""

# 10. Smazání projektu
echo "10. Smazání projektu..."
curl -s -X DELETE "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | echo "Delete response: $(cat)"
echo ""

# 11. Ověření smazání
echo "11. Ověření smazání projektu..."
curl -s -X GET "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | echo "Verify deletion response: $(cat)"
echo ""

echo "=== Test dokončen ==="