# Frontend API Integration Test Script

## Prerequisites
1. Backend server running on `http://localhost:3001/api`
2. Frontend development server running on `http://localhost:8080`
3. Axios dependency installed: `npm install`

## Test Scenarios

### 1. Authentication Flow

#### Test Registration
1. Navigate to `/sign-up`
2. Fill in the form:
   - Email: `test@example.com`
   - Password: `password123`
   - Username (optional): `Test User`
3. Submit form
4. Should redirect to dashboard on success
5. Check for success toast message
6. Verify localStorage contains `accessToken` and `refreshToken`

#### Test Login
1. Navigate to `/sign-in`
2. Fill in the form:
   - Email: `test@example.com`
   - Password: `password123`
3. Submit form
4. Should redirect to dashboard on success
5. Check for success toast message
6. Verify localStorage contains tokens

#### Test Logout
1. From any authenticated page, click logout
2. Should redirect to `/sign-in`
3. Check for success toast message
4. Verify localStorage tokens are cleared

### 2. Project Management

#### Test Create Project
1. Navigate to `/dashboard`
2. Click "New Project" or "+" button
3. Fill in the form:
   - Name: `Test Project`
   - Description: `This is a test project`
4. Submit form
5. Should see success toast
6. New project should appear in projects list

#### Test View Project
1. From dashboard, click on a project
2. Should navigate to `/project/{id}`
3. Should display project details and empty images list

#### Test Delete Project
1. From project card, click three-dots menu
2. Click "Delete"
3. Should see success toast
4. Project should be removed from list

### 3. Image Upload

#### Test Image Upload
1. Navigate to a project detail page
2. Use the image uploader component
3. Select one or more image files
4. Should see upload progress
5. Should see success toast on completion
6. Images should appear in project images list

#### Test Auto-Segmentation
1. During upload, ensure "Auto-segment" toggle is enabled
2. After upload, images should have status "processing"
3. Should eventually change to "completed" or "failed"

### 4. User Profile

#### Test Profile Update
1. Navigate to `/settings`
2. Update profile fields:
   - Full Name: `Updated Name`
   - Organization: `Test Org`
   - Bio: `Updated bio`
3. Submit form
4. Should see success toast
5. Changes should be reflected in form

### 5. Error Handling

#### Test Network Errors
1. Stop the backend server
2. Try any API operation (login, create project, etc.)
3. Should see appropriate error toast messages
4. Should not crash the application

#### Test Invalid Credentials
1. Try logging in with wrong credentials
2. Should see error message
3. Should not redirect to dashboard

#### Test Unauthorized Access
1. Clear localStorage tokens
2. Try accessing `/dashboard` directly
3. Should redirect to `/sign-in`

### 6. Token Refresh

#### Test Token Refresh
1. Login normally
2. Wait for access token to expire (or manually expire it)
3. Make an API call that requires authentication
4. Should automatically refresh token and retry request
5. Should not require user to log in again

## Expected API Responses

### Authentication
- `POST /auth/login` → `{ accessToken, refreshToken, user }`
- `POST /auth/register` → `{ accessToken, refreshToken, user }`
- `POST /auth/logout` → success
- `POST /auth/refresh` → `{ accessToken }`
- `GET /auth/profile` → user profile data

### Projects
- `GET /projects` → `{ projects: [], total, page, totalPages }`
- `POST /projects` → project object
- `GET /projects/:id` → project object
- `PUT /projects/:id` → updated project object
- `DELETE /projects/:id` → success

### Images
- `GET /projects/:id/images` → `{ images: [], total, page, totalPages }`
- `POST /projects/:id/images` → array of uploaded images
- `DELETE /projects/:projectId/images/:imageId` → success

### Segmentation
- `POST /segmentation/process` → segmentation result
- `GET /segmentation/results/:imageId` → array of results

## Manual Verification Points

1. **UI/UX**: All existing UI components work as before
2. **Loading States**: Proper loading indicators during API calls
3. **Error States**: Friendly error messages for failed operations
4. **Navigation**: All routing works correctly
5. **Responsive Design**: Layout works on different screen sizes
6. **Accessibility**: Keyboard navigation and screen readers work

## Development Tools for Testing

### Browser Developer Tools
1. **Network Tab**: Monitor API requests and responses
2. **Console**: Check for JavaScript errors
3. **Application Tab**: Verify localStorage token management

### Testing with cURL
```bash
# Test authentication
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Test protected endpoint
curl -X GET http://localhost:3001/api/projects \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Common Issues to Check

1. **CORS**: Ensure backend allows frontend origin
2. **Content-Type**: API requests use correct content type
3. **Authorization**: Bearer token format is correct
4. **Error Handling**: Network errors don't break UI
5. **Loading States**: UI shows loading during async operations
6. **Memory Leaks**: File upload previews are cleaned up
7. **Token Expiry**: Refresh mechanism works correctly

## Success Criteria

✅ All authentication flows work without errors
✅ Project CRUD operations function correctly  
✅ Image upload and display works properly
✅ User profile updates save successfully
✅ Error handling is graceful and informative
✅ No console errors during normal operation
✅ Token refresh happens automatically
✅ UI remains responsive and functional