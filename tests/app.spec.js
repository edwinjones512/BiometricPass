const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs/promises');

let electronApp;
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [path.join(__dirname, '..', 'main.js')]
  });
  window = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
});

test('App starts on the Lock Screen', async () => {
  const isLockScreenVisible = await window.isVisible('#lock-screen');
  expect(isLockScreenVisible).toBe(true);
});

test('Unlock functionality works', async () => {
  await window.evaluate(() => {
    navigator.credentials.create = async () => ({ id: "mock-credential" });
  });

  await window.click('#btn-unlock');
  await expect(window.locator('#vault-screen')).not.toHaveClass(/hidden/, { timeout: 5000 });
});

test('Add credential and verify it persists', async () => {
  await window.click('#btn-add');
  await expect(window.locator('#add-modal')).not.toHaveClass(/hidden/);
  
  await window.fill('#input-title', 'Test Site');
  await window.fill('#input-username', 'testuser');
  await window.fill('#input-password', 'supersecret');
  await window.click('#btn-save');
  
  const listItems = window.locator('.list-item');
  await expect(listItems).toHaveCount(1);
});

test('Remove credential functionality works', async () => {
  // Wait for the list item to be rendered (from previous test)
  const listItems = window.locator('.list-item');
  await expect(listItems).toHaveCount(1);
  
  // Click the Remove button on the first item
  const removeBtn = listItems.nth(0).locator('button', { hasText: 'Remove' });
  await removeBtn.click();
  
  // Verify modal appears
  const removeModal = window.locator('#remove-modal');
  await expect(removeModal).not.toHaveClass(/hidden/);
  
  // Test cancel
  await window.click('#btn-remove-cancel');
  await expect(removeModal).toHaveClass(/hidden/);
  await expect(listItems).toHaveCount(1);
  
  // Test confirm
  await removeBtn.click();
  await expect(removeModal).not.toHaveClass(/hidden/);
  
  await window.click('#btn-remove-confirm');
  await expect(removeModal).toHaveClass(/hidden/);
  
  // Verify list is empty
  await expect(listItems).toHaveCount(0);
});

test('Generate Password feature works', async () => {
  const navItems = window.locator('.nav-item');
  await navItems.nth(1).click();
  
  await expect(window.locator('#generate-screen')).not.toHaveClass(/hidden/);
  
  const pwdDisplay = window.locator('#generated-password-display');
  const initialPwd = await pwdDisplay.textContent();
  expect(initialPwd.length).toBe(16);
  
  const slider = window.locator('#pwd-length');
  await slider.fill('24');
  await slider.dispatchEvent('input');
  
  const newPwd = await pwdDisplay.textContent();
  expect(newPwd.length).toBe(24);
  expect(newPwd).not.toBe(initialPwd);
  
  await window.click('#btn-generate-new');
  const thirdPwd = await pwdDisplay.textContent();
  expect(thirdPwd.length).toBe(24);
  expect(thirdPwd).not.toBe(newPwd);
});

test('Backup & Sync functionality works', async () => {
  // Navigate to Sync tab
  const navItems = window.locator('.nav-item');
  await navItems.nth(3).click();
  
  await expect(window.locator('#sync-screen')).not.toHaveClass(/hidden/);
  
  // Test Reveal Button
  const exportDisplay = window.locator('#export-key-display');
  await expect(exportDisplay).toHaveAttribute('type', 'password');
  
  await window.click('#btn-reveal-key');
  await expect(exportDisplay).toHaveAttribute('type', 'text');
  
  const exportedKey = await exportDisplay.inputValue();
  expect(exportedKey.length).toBeGreaterThan(10);
  
  // Test Import Key error handling
  await window.fill('#import-key-input', 'invalid-key');
  await window.click('#btn-import-key');
  
  const status = window.locator('#import-status');
  await expect(status).toContainText('Error', { timeout: 5000 });
  
  // Test Import Key with valid exported key
  await window.fill('#import-key-input', exportedKey);
  await window.click('#btn-import-key');
  
  await expect(status).toContainText('successfully linked', { timeout: 5000 });
});

test('Lock functionality works and clears UI', async () => {
  await window.click('#nav-lock');
  await expect(window.locator('#lock-screen')).not.toHaveClass(/hidden/);
  const listItems = window.locator('.list-item');
  await expect(listItems).toHaveCount(0);
});

test('Database file is encrypted on disk', async () => {
  const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  const dbPath = path.join(userDataPath, 'biometricpass.enc');
  const dbContent = await fs.readFile(dbPath, 'utf8');
  const parsed = JSON.parse(dbContent);
  
  expect(parsed.ciphertext).toBeDefined();
  expect(dbContent).not.toContain('Test Site');
});
