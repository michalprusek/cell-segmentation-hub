# Share Link Project Assignment Fix

## Problem

Když se uživatel registroval nebo přihlásil přes share link, sdílený projekt se nezobrazil v galerii projektů na Dashboardu.

## Root Cause

1. Backend správně aktualizoval databázi (nastavil `sharedWithId` a `status: 'accepted'`)
2. Ale zpracování `pendingShareToken` probíhalo až na Dashboard stránce
3. To způsobovalo race condition a časové problémy

## Solution Implemented

### Backend Changes (2 soubory)

1. **sharingController.ts**: Rozšířil response data v `acceptShareInvitation` endpoint
   - Přidal `shareId`, `sharedWithId`, `status` do response

2. **sharingService.ts**: Rozšířil databázový dotaz při přijetí pozvánky
   - Přidal `include` pro načtení kompletních dat (project, sharedBy, sharedWith)
   - Zajistil vrácení plných dat pro frontend

### Frontend Changes (2 soubory)

1. **AuthContext.tsx**: Přidal zpracování `pendingShareToken` přímo po sign in/sign up
   - Automaticky volá `acceptShareInvitation` po úspěšném přihlášení/registraci
   - Odstraňuje token z localStorage po úspěšném zpracování
   - Nezpomaluje navigaci při chybě

2. **Dashboard.tsx**: Přidal malé zpoždění pro databázovou propagaci
   - 500ms delay před voláním `fetchProjects()`
   - Zajišťuje správné načtení nově přijatých projektů

## Testing Scenarios

1. Nový uživatel registruje se přes share link
2. Existující uživatel přihlásí se přes share link
3. Přihlášený uživatel navštíví share link
4. Share link s email invitací vs. obecný link

## Files Modified

- backend/src/api/controllers/sharingController.ts
- backend/src/services/sharingService.ts
- src/contexts/AuthContext.tsx
- src/pages/Dashboard.tsx

## Commit

`fix: share link project assignment after registration/login` (571577b)
