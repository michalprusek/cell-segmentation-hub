import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Project Management Workflow', () => {
  const testUser = {
    email: `project-test-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const testProject = {
    name: 'E2E Test Project',
    description: 'A project created for end-to-end testing',
  };

  test.beforeEach(async ({ page }) => {
    // Register and login before each test
    await page.goto('/');
    await page.getByRole('link', { name: /sign up/i }).click();

    await page.getByLabel(/email/i).fill(testUser.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);
    await page.getByRole('checkbox', { name: /terms/i }).check();

    await page.getByRole('button', { name: /sign up/i }).click();
    await expect(page).toHaveURL('/dashboard');
  });

  test('should create a new project', async ({ page }) => {
    // Click create project button
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();

    // Fill project form
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);

    // Submit form
    await page.getByRole('button', { name: /create|save/i }).click();

    // Should show success message
    await expect(page.getByText(/project.*created|success/i)).toBeVisible();

    // Should show project in dashboard
    await expect(page.getByText(testProject.name)).toBeVisible();
  });

  test('should view project details', async ({ page }) => {
    // Create project first
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    // Click on project to view details
    await page.getByText(testProject.name).click();

    // Should navigate to project detail page
    await expect(page).toHaveURL(/\/projects\/.*/);

    // Should show project information
    await expect(page.getByText(testProject.name)).toBeVisible();
    await expect(page.getByText(testProject.description)).toBeVisible();
  });

  test('should edit project information', async ({ page }) => {
    // Create project first
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    // Click edit button (might be in dropdown or direct button)
    await page.getByRole('button', { name: /edit|more options/i }).click();

    if (await page.getByText(/edit/i).isVisible()) {
      await page.getByText(/edit/i).click();
    }

    // Update project information
    const updatedName = 'Updated E2E Test Project';
    const updatedDescription = 'Updated description for testing';

    await page.getByLabel(/project name|name/i).fill(updatedName);
    await page.getByLabel(/description/i).fill(updatedDescription);

    // Save changes
    await page.getByRole('button', { name: /save|update/i }).click();

    // Should show success message
    await expect(page.getByText(/updated|saved/i)).toBeVisible();

    // Should show updated information
    await expect(page.getByText(updatedName)).toBeVisible();
  });

  test('should upload images to project', async ({ page }) => {
    // Create project first
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    // Navigate to project
    await page.getByText(testProject.name).click();

    // Create a test image file (you might need to have actual test images)
    const testImagePath = path.join(
      __dirname,
      '..',
      'fixtures',
      'test-image.jpg'
    );

    // Upload image (this depends on your upload component implementation)
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(testImagePath);
    } else {
      // If using drag-and-drop, you might need to use different approach
      await page.getByText(/drag.*drop|browse|upload/i).click();
      await fileInput.setInputFiles(testImagePath);
    }

    // Should show uploaded image
    await expect(
      page.getByText(/test-image\.jpg|image.*uploaded/i)
    ).toBeVisible();
  });

  test('should start segmentation process', async ({ page }) => {
    // Create project and upload image first
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    await page.getByText(testProject.name).click();

    // Upload test image (assuming upload process)
    const testImagePath = path.join(
      __dirname,
      '..',
      'fixtures',
      'test-image.jpg'
    );
    const fileInput = page.locator('input[type="file"]').first();

    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(testImagePath);
      // Wait for upload completion indicator
      await expect(page.getByText(/uploaded|success/i)).toBeVisible({
        timeout: 10000,
      });
    }

    // Start segmentation
    await page
      .getByRole('button', { name: /segment|analyze|process/i })
      .click();

    // Select model if needed
    if (await page.getByText(/select.*model/i).isVisible()) {
      await page.getByRole('combobox', { name: /model/i }).click();
      await page
        .getByText(/hrnet|resunet/i)
        .first()
        .click();
    }

    // Start processing
    await page.getByRole('button', { name: /start|process|segment/i }).click();

    // Should show processing status
    await expect(
      page.getByText(/processing|analyzing|in progress/i)
    ).toBeVisible();
  });

  test('should delete project', async ({ page }) => {
    // Create project first
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    // Delete project
    await page.getByRole('button', { name: /delete|more options/i }).click();

    if (await page.getByText(/delete/i).isVisible()) {
      await page.getByText(/delete/i).click();
    }

    // Confirm deletion
    await page.getByRole('button', { name: /confirm|yes|delete/i }).click();

    // Should show success message
    await expect(page.getByText(/deleted|removed/i)).toBeVisible();

    // Project should no longer be visible
    await expect(page.getByText(testProject.name)).not.toBeVisible();
  });

  test('should show empty state when no projects exist', async ({ page }) => {
    // Should show empty state message
    await expect(
      page.getByText(/no projects|get started|create.*first/i)
    ).toBeVisible();

    // Should show create project button
    await expect(
      page.getByRole('button', { name: /create.*project|new.*project/i })
    ).toBeVisible();
  });

  test('should filter and search projects', async ({ page }) => {
    // Create multiple projects
    const projects = [
      { name: 'Project Alpha', description: 'First test project' },
      { name: 'Project Beta', description: 'Second test project' },
      { name: 'Project Gamma', description: 'Third test project' },
    ];

    for (const project of projects) {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill(project.name);
      await page.getByLabel(/description/i).fill(project.description);
      await page.getByRole('button', { name: /create|save/i }).click();
      // Wait for project to appear in the list
      await expect(page.getByText(project.name)).toBeVisible({ timeout: 5000 });
    }

    // Test search functionality if available
    const searchInput = page.getByPlaceholder(/search.*projects|search/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill('Alpha');

      // Should show only matching project
      await expect(page.getByText('Project Alpha')).toBeVisible();
      await expect(page.getByText('Project Beta')).not.toBeVisible();

      // Clear search
      await searchInput.clear();

      // Should show all projects again
      await expect(page.getByText('Project Alpha')).toBeVisible();
      await expect(page.getByText('Project Beta')).toBeVisible();
    }
  });

  test('should handle project creation validation', async ({ page }) => {
    // Try to create project without name
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByRole('button', { name: /create|save/i }).click();

    // Should show validation error
    await expect(
      page.getByText(/project name.*required|name.*required/i)
    ).toBeVisible();

    // Try to create project with very long name
    const longName = 'A'.repeat(300);
    await page.getByLabel(/project name|name/i).fill(longName);
    await page.getByRole('button', { name: /create|save/i }).click();

    // Should show validation error for name length
    await expect(
      page.getByText(/name.*too long|maximum.*length/i)
    ).toBeVisible();
  });

  test('should show project statistics', async ({ page }) => {
    // Create project with some data
    await page
      .getByRole('button', { name: /create.*project|new.*project/i })
      .click();
    await page.getByLabel(/project name|name/i).fill(testProject.name);
    await page.getByLabel(/description/i).fill(testProject.description);
    await page.getByRole('button', { name: /create|save/i }).click();

    await page.getByText(testProject.name).click();

    // Should show project statistics
    await expect(page.getByText(/0.*images|no.*images/i)).toBeVisible();
    await expect(page.getByText(/created|last.*updated/i)).toBeVisible();
  });
});
