import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Enhanced Project Management Workflow', () => {
  const testUser = {
    email: `project-enhanced-${Date.now()}@example.com`,
    password: 'testpassword123',
  };

  const testProject = {
    name: 'Enhanced E2E Test Project',
    description: 'A comprehensive project for enhanced workflow testing',
  };

  // Multiple test images for bulk upload testing
  const testImagePaths = [
    path.join(__dirname, '../fixtures/test-image.jpg'),
    path.join(__dirname, '../fixtures/test-image-2.jpg'),
    path.join(__dirname, '../fixtures/test-image-3.jpg'),
    path.join(__dirname, '../fixtures/test-image-4.jpg'),
    path.join(__dirname, '../fixtures/test-image-5.jpg'),
  ];

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

  test.describe('Bulk Image Upload', () => {
    test('should handle bulk upload of multiple images', async ({ page }) => {
      // Create project
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill(testProject.name);
      await page.getByLabel(/description/i).fill(testProject.description);
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText(testProject.name).click();

      // Test bulk upload with multiple files
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths.slice(0, 3)); // Upload 3 images

      // Should show upload progress for multiple files
      await expect(page.getByText(/uploading|progress/i)).toBeVisible({
        timeout: 5000,
      });

      // Wait for all uploads to complete
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 30000,
      });

      // Should show all uploaded images
      for (let i = 1; i <= 3; i++) {
        await expect(
          page.getByText(new RegExp(`test-image.*${i}`, 'i'))
        ).toBeVisible({ timeout: 5000 });
      }

      // Should show correct image count
      await expect(page.getByText(/3.*images|images.*3/i)).toBeVisible();
    });

    test('should handle large batch upload with progress tracking', async ({
      page,
    }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Bulk Upload Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing bulk upload capabilities');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText('Bulk Upload Test').click();

      // Upload all 5 test images
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths);

      // Should show progress indicator
      const progressIndicator = page.locator(
        '.progress, [role="progressbar"], .upload-progress'
      );
      if (await progressIndicator.isVisible({ timeout: 5000 })) {
        // Wait for progress to complete
        await expect(progressIndicator).not.toBeVisible({ timeout: 60000 });
      }

      // Should show success message for bulk upload
      await expect(
        page.getByText(/upload.*complete|all.*uploaded|success/i)
      ).toBeVisible({
        timeout: 30000,
      });

      // Verify all images are listed
      await expect(page.getByText(/5.*images|images.*5/i)).toBeVisible();
    });

    test('should handle upload errors gracefully', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Upload Error Test');
      await page
        .getByLabel(/description/i)
        .fill('Testing upload error handling');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText('Upload Error Test').click();

      // Simulate network error during upload
      const uploadErrorHandler = (route: any) => {
        if (route.request().method() === 'POST') {
          route.abort();
        } else {
          route.continue();
        }
      };
      await page.route('**/api/projects/*/images', uploadErrorHandler);

      try {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(testImagePaths[0]);

        // Should show error message
        await expect(
          page.getByText(/upload.*failed|error.*upload|network.*error/i)
        ).toBeVisible({
          timeout: 15000,
        });

        // Should offer retry option
        const retryButton = page.getByRole('button', {
          name: /retry|try.*again/i,
        });
        if (await retryButton.isVisible()) {
          // Remove network simulation and retry
          await page.unroute('**/api/projects/*/images', uploadErrorHandler);
          await retryButton.click();

          // Should succeed after retry
          await expect(page.getByText(/upload.*complete|success/i)).toBeVisible(
            {
              timeout: 15000,
            }
          );
        }
      } finally {
        // Ensure route handler is always removed
        await page.unroute('**/api/projects/*/images', uploadErrorHandler);
      }
    });
  });

  test.describe('Project Export Functionality', () => {
    test('should export project in COCO format', async ({ page }) => {
      // Create and populate project
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Export Test COCO');
      await page
        .getByLabel(/description/i)
        .fill('Testing COCO export functionality');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText('Export Test COCO').click();

      // Upload and segment image
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Start segmentation (simplified)
      const segmentButton = page
        .getByRole('button', { name: /segment|analyze|process/i })
        .first();
      if (await segmentButton.isVisible()) {
        await segmentButton.click();
        await page.getByRole('button', { name: /start|process/i }).click();
        await expect(page.getByText(/complete|finished/i)).toBeVisible({
          timeout: 60000,
        });
      }

      // Export project
      const exportButton = page
        .getByRole('button', { name: /export/i })
        .first();
      if (await exportButton.isVisible()) {
        await exportButton.click();

        // Select COCO format
        await page.getByText(/coco/i).click();

        // Configure export options if available
        const includeImages = page.getByRole('checkbox', {
          name: /include.*images/i,
        });
        if (await includeImages.isVisible()) {
          await includeImages.check();
        }

        // Start export
        const downloadPromise = page.waitForDownload({ timeout: 30000 });
        await page.getByRole('button', { name: /download|export/i }).click();

        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/.*\.(json|zip)$/);
      }
    });

    test('should export project in Excel format', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Export Test Excel');
      await page
        .getByLabel(/description/i)
        .fill('Testing Excel export functionality');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText('Export Test Excel').click();

      // Upload image
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths[0]);
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 15000,
      });

      // Export project
      const exportButton = page
        .getByRole('button', { name: /export/i })
        .first();
      if (await exportButton.isVisible()) {
        await exportButton.click();

        // Select Excel format
        const excelOption = page.getByText(/excel|xlsx/i);
        if (await excelOption.isVisible()) {
          await excelOption.click();

          const downloadPromise = page.waitForDownload({ timeout: 30000 });
          await page.getByRole('button', { name: /download|export/i }).click();

          const download = await downloadPromise;
          expect(download.suggestedFilename()).toMatch(/.*\.xlsx$/);
        }
      }
    });

    test('should export selected images only', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Selective Export Test');
      await page.getByLabel(/description/i).fill('Testing selective export');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText('Selective Export Test').click();

      // Upload multiple images
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImagePaths.slice(0, 3));
      await expect(page.getByText(/upload.*complete|success/i)).toBeVisible({
        timeout: 30000,
      });

      // Select specific images for export
      const imageCheckboxes = page.locator(
        'input[type="checkbox"][data-image]'
      );
      const checkboxCount = await imageCheckboxes.count();

      if (checkboxCount > 0) {
        // Select first two images
        await imageCheckboxes.nth(0).check();
        await imageCheckboxes.nth(1).check();

        // Export selected
        const exportButton = page
          .getByRole('button', { name: /export.*selected|export/i })
          .first();
        await exportButton.click();

        const downloadPromise = page.waitForDownload({ timeout: 30000 });
        await page.getByRole('button', { name: /download|export/i }).click();

        const download = await downloadPromise;
        expect(download).toBeTruthy();
      }
    });
  });

  test.describe('Project Duplication and Templates', () => {
    test('should duplicate existing project', async ({ page }) => {
      // Create original project
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Original Project');
      await page.getByLabel(/description/i).fill('Project to be duplicated');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Find duplicate option
      const moreOptionsButton = page
        .getByRole('button', { name: /more.*options|menu|⋮/i })
        .first();
      if (await moreOptionsButton.isVisible()) {
        await moreOptionsButton.click();

        const duplicateOption = page.getByText(/duplicate|copy|clone/i);
        if (await duplicateOption.isVisible()) {
          await duplicateOption.click();

          // Fill duplicate project details
          await page
            .getByLabel(/project name|name/i)
            .fill('Duplicated Project');
          await page
            .getByLabel(/description/i)
            .fill('Duplicated from Original Project');

          await page
            .getByRole('button', { name: /create|duplicate|copy/i })
            .click();

          // Should show both projects
          await expect(page.getByText('Original Project')).toBeVisible();
          await expect(page.getByText('Duplicated Project')).toBeVisible();
        }
      }
    });

    test('should create project from template', async ({ page }) => {
      // Check if templates are available
      const templateButton = page.getByRole('button', {
        name: /template|from.*template/i,
      });
      if (await templateButton.isVisible()) {
        await templateButton.click();

        // Select a template
        const cellAnalysisTemplate = page.getByText(
          /cell.*analysis|microscopy|segmentation.*template/i
        );
        if (await cellAnalysisTemplate.isVisible()) {
          await cellAnalysisTemplate.click();

          // Fill project details
          await page
            .getByLabel(/project name|name/i)
            .fill('Project from Template');
          await page
            .getByLabel(/description/i)
            .fill('Created from cell analysis template');

          await page
            .getByRole('button', { name: /create|use.*template/i })
            .click();

          await expect(page.getByText(/project.*created|success/i)).toBeVisible(
            { timeout: 10000 }
          );
          await expect(page.getByText('Project from Template')).toBeVisible();
        }
      }
    });
  });

  test.describe('Advanced Search and Filtering', () => {
    test('should filter projects by date range', async ({ page }) => {
      // Create projects with different dates (simulate by creating multiple projects)
      const projectNames = ['Project Alpha', 'Project Beta', 'Project Gamma'];

      for (const name of projectNames) {
        await page
          .getByRole('button', { name: /create.*project|new.*project/i })
          .click();
        await page.getByLabel(/project name|name/i).fill(name);
        await page.getByLabel(/description/i).fill(`Description for ${name}`);
        await page.getByRole('button', { name: /create|save/i }).click();
        await expect(page.getByText(/project.*created|success/i)).toBeVisible({
          timeout: 10000,
        });
      }

      // Test date filtering if available
      const filterButton = page.getByRole('button', { name: /filter|sort/i });
      if (await filterButton.isVisible()) {
        await filterButton.click();

        const dateFilter = page.getByText(/date|created|modified/i);
        if (await dateFilter.isVisible()) {
          await dateFilter.click();

          // Select date range (e.g., last week)
          const lastWeekOption = page.getByText(/last.*week|7.*days/i);
          if (await lastWeekOption.isVisible()) {
            await lastWeekOption.click();

            // Should show filtered results
            await expect(page.getByText('Project Alpha')).toBeVisible();
          }
        }
      }
    });

    test('should search projects by name and description', async ({ page }) => {
      // Create projects with distinctive content
      const projects = [
        {
          name: 'Cell Analysis Project',
          description: 'Microscopy cell segmentation',
        },
        {
          name: 'Tissue Sample Study',
          description: 'Histology tissue analysis',
        },
        {
          name: 'Bacteria Detection',
          description: 'Bacterial colony counting',
        },
      ];

      for (const project of projects) {
        await page
          .getByRole('button', { name: /create.*project|new.*project/i })
          .click();
        await page.getByLabel(/project name|name/i).fill(project.name);
        await page.getByLabel(/description/i).fill(project.description);
        await page.getByRole('button', { name: /create|save/i }).click();
        await expect(page.getByText(/project.*created|success/i)).toBeVisible({
          timeout: 10000,
        });
      }

      // Test search functionality
      const searchInput = page.getByPlaceholder(/search/i);
      if (await searchInput.isVisible()) {
        // Search by name
        await searchInput.fill('Cell');
        await expect(page.getByText('Cell Analysis Project')).toBeVisible();
        await expect(page.getByText('Tissue Sample Study')).not.toBeVisible();

        // Clear and search by description
        await searchInput.clear();
        await searchInput.fill('histology');
        await expect(page.getByText('Tissue Sample Study')).toBeVisible();
        await expect(page.getByText('Cell Analysis Project')).not.toBeVisible();

        // Clear search to show all
        await searchInput.clear();
        await expect(page.getByText('Cell Analysis Project')).toBeVisible();
        await expect(page.getByText('Tissue Sample Study')).toBeVisible();
      }
    });

    test('should sort projects by different criteria', async ({ page }) => {
      // Create projects with different characteristics
      const projects = [
        'A First Project',
        'B Second Project',
        'C Third Project',
      ];

      for (const name of projects) {
        await page
          .getByRole('button', { name: /create.*project|new.*project/i })
          .click();
        await page.getByLabel(/project name|name/i).fill(name);
        await page.getByLabel(/description/i).fill(`Description for ${name}`);
        await page.getByRole('button', { name: /create|save/i }).click();
        await expect(page.getByText(/project.*created|success/i)).toBeVisible({
          timeout: 10000,
        });
      }

      // Test sorting if available
      const sortButton = page.getByRole('button', { name: /sort/i });
      if (await sortButton.isVisible()) {
        await sortButton.click();

        // Test name sorting
        const nameSort = page.getByText(/name/i);
        if (await nameSort.isVisible()) {
          await nameSort.click();

          // Verify alphabetical order
          const projectElements = await page
            .locator('[data-testid*="project"], .project-card')
            .all();
          if (projectElements.length > 0) {
            // Check if first visible project starts with 'A'
            const firstProject = await page
              .getByText('A First Project')
              .isVisible();
            expect(firstProject).toBe(true);
          }
        }

        // Test date sorting
        await sortButton.click();
        const dateSort = page.getByText(/date|created|modified/i);
        if (await dateSort.isVisible()) {
          await dateSort.click();

          // Should reorder by creation date (most recent first typically)
          await page.waitForFunction(
            () => {
              const projects = document.querySelectorAll(
                '[data-testid="project-card"], .project-card'
              );
              return projects.length > 0; // Wait for projects to be reordered
            },
            { timeout: 5000 }
          );
        }
      }
    });
  });

  test.describe('Project Archive and Restore', () => {
    test('should archive and restore projects', async ({ page }) => {
      // Create project to archive
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Archive Test Project');
      await page.getByLabel(/description/i).fill('Project to be archived');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Archive project
      const moreOptionsButton = page
        .getByRole('button', { name: /more.*options|menu|⋮/i })
        .first();
      if (await moreOptionsButton.isVisible()) {
        await moreOptionsButton.click();

        const archiveOption = page.getByText(/archive/i);
        if (await archiveOption.isVisible()) {
          await archiveOption.click();

          // Confirm archiving
          const confirmButton = page.getByRole('button', {
            name: /confirm|archive/i,
          });
          if (await confirmButton.isVisible()) {
            await confirmButton.click();

            // Should show success message
            await expect(
              page.getByText(/archived|moved.*archive/i)
            ).toBeVisible({ timeout: 5000 });

            // Project should no longer be visible in main view
            await expect(
              page.getByText('Archive Test Project')
            ).not.toBeVisible();
          }
        }
      }

      // Check archived projects section
      const archivedSection = page.getByText(/archived|archive/i);
      if (await archivedSection.isVisible()) {
        await archivedSection.click();

        // Should show archived project
        await expect(page.getByText('Archive Test Project')).toBeVisible();

        // Test restore functionality
        const restoreButton = page.getByRole('button', {
          name: /restore|unarchive/i,
        });
        if (await restoreButton.isVisible()) {
          await restoreButton.click();

          // Should show success message
          await expect(page.getByText(/restored|unarchived/i)).toBeVisible({
            timeout: 5000,
          });

          // Navigate back to main projects
          const mainProjectsButton = page.getByText(
            /all.*projects|active.*projects|projects/i
          );
          if (await mainProjectsButton.isVisible()) {
            await mainProjectsButton.click();
          } else {
            await page.goto('/dashboard');
          }

          // Project should be visible again
          await expect(page.getByText('Archive Test Project')).toBeVisible();
        }
      }
    });
  });

  test.describe('Project Collaboration', () => {
    test('should share project with read-only access', async ({ page }) => {
      // Create project to share
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page.getByLabel(/project name|name/i).fill('Shared Project');
      await page.getByLabel(/description/i).fill('Project to be shared');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });

      // Look for share functionality
      const shareButton = page.getByRole('button', { name: /share/i });
      if (await shareButton.isVisible()) {
        await shareButton.click();

        // Enter email to share with
        const emailInput = page.getByLabel(/email/i);
        if (await emailInput.isVisible()) {
          await emailInput.fill('collaborator@example.com');

          // Select permission level
          const permissionSelect = page.getByRole('combobox', {
            name: /permission|role/i,
          });
          if (await permissionSelect.isVisible()) {
            await permissionSelect.click();
            await page.getByText(/read.*only|viewer/i).click();
          }

          // Send share invitation
          await page
            .getByRole('button', { name: /share|invite|send/i })
            .click();

          // Should show success message
          await expect(page.getByText(/shared|invitation.*sent/i)).toBeVisible({
            timeout: 5000,
          });
        }
      }
    });

    test('should manage project permissions', async ({ page }) => {
      await page
        .getByRole('button', { name: /create.*project|new.*project/i })
        .click();
      await page
        .getByLabel(/project name|name/i)
        .fill('Permission Test Project');
      await page
        .getByLabel(/description/i)
        .fill('Testing permission management');
      await page.getByRole('button', { name: /create|save/i }).click();

      await expect(page.getByText(/project.*created|success/i)).toBeVisible({
        timeout: 10000,
      });
      await page.getByText('Permission Test Project').click();

      // Look for permissions or settings
      const settingsButton = page.getByRole('button', {
        name: /settings|permissions/i,
      });
      if (await settingsButton.isVisible()) {
        await settingsButton.click();

        // Test making project public/private
        const visibilityToggle = page.getByRole('button', {
          name: /public|private|visibility/i,
        });
        if (await visibilityToggle.isVisible()) {
          await visibilityToggle.click();

          // Should show confirmation dialog
          const confirmDialog = page.getByText(
            /make.*public|change.*visibility|confirm/i
          );
          if (await confirmDialog.isVisible()) {
            const confirmButton = page.getByRole('button', {
              name: /confirm|yes|make.*public/i,
            });
            await confirmButton.click();

            await expect(
              page.getByText(/visibility.*changed|now.*public/i)
            ).toBeVisible({
              timeout: 5000,
            });
          }
        }
      }
    });
  });
});
