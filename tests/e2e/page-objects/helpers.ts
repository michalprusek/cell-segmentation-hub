import { Page } from '@playwright/test';

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

export async function createProject(
  page: Page,
  name: string,
  description: string
) {
  await page.click('text=Create Project');
  await page.waitForSelector('[data-testid="create-project-dialog"]');
  await page.fill('input[name="name"]', name);
  await page.fill('textarea[name="description"]', description);
  await page.click('button:has-text("Create")');
  await page.waitForSelector(`text=${name}`);
}

export async function uploadImage(page: Page, imagePath: string) {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('button:has-text("Upload Images")');
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(imagePath);
  await page.waitForSelector('text=Upload complete');
}
