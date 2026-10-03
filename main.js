const { app, BrowserWindow, ipcMain, clipboard, safeStorage, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');

// Hardcoded paths for the mock flat file database
const DB_PATH = path.join(app.getPath('userData'), 'biometricpass.enc');
const KEY_STORE_PATH = path.join(app.getPath('userData'), 'keystore.json');

// In-memory key storage (purged on lock)
let masterFileKey = null;
let autoLockTimeout = null;

function resetAutoLock() {
  if (autoLockTimeout) clearTimeout(autoLockTimeout);
  // Auto lock after specified minutes of inactivity
  autoLockTimeout = setTimeout(() => {
    masterFileKey = null;
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('locked-state'));
  }, (typeof autoLockMinutes !== 'undefined' ? autoLockMinutes : 5) * 60 * 1000);
}

const http = require('http');
const fsSync = require('fs');

let server;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1e1e',
      symbolColor: '#ffffff'
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Serve over http://localhost to enable WebAuthn Secure Context
  server = http.createServer((req, res) => {
    try {
      let filePath = req.url === '/' ? '/index.html' : req.url;
      let ext = path.extname(filePath);
      let contentType = 'text/html';
      if (ext === '.css') contentType = 'text/css';
      if (ext === '.js') contentType = 'application/javascript';
      
      const content = fsSync.readFileSync(path.join(__dirname, filePath));
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (e) {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(0, 'localhost', () => {
    const port = server.address().port;
    mainWindow.loadURL(`http://localhost:${port}/`);
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId(process.execPath);
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers for Cryptography and Data Storage
ipcMain.handle('authenticate', async () => {
  return new Promise(async (resolve) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("OS-level encryption is not available on this machine.");
      }

      // 1. Try to load an existing encrypted Master File Key from local keychain
      let keyData = null;
      try {
        const fileStr = await fs.readFile(KEY_STORE_PATH, 'utf8');
        keyData = JSON.parse(fileStr).encryptedMFK;
      } catch (e) {} // File doesn't exist yet

      if (keyData) {
        // 2. Decrypt it using OS-level Secure Enclave / DPAPI
        const encryptedBuffer = Buffer.from(keyData, 'base64');
        masterFileKey = safeStorage.decryptString(encryptedBuffer);
        // ensure masterFileKey is a Buffer for crypto functions
        masterFileKey = Buffer.from(masterFileKey, 'base64');
      } else {
        // 3. First time setup: Generate a new 256-bit MFK and securely store it
        const newKeyBuf = crypto.randomBytes(32);
        masterFileKey = newKeyBuf;
        
        const newKeyBase64 = newKeyBuf.toString('base64');
        const encryptedMFK = safeStorage.encryptString(newKeyBase64).toString('base64');
        
        await fs.writeFile(KEY_STORE_PATH, JSON.stringify({ encryptedMFK }), 'utf8');
      }

      resetAutoLock();
      resolve({ success: true });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

ipcMain.handle('export-device-key', () => {
  if (!masterFileKey) throw new Error("App is locked.");
  resetAutoLock();
  return masterFileKey.toString('base64'); // The raw base64 MFK
});

ipcMain.handle('import-device-key', async (event, importedKeyBase64) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS Encryption not available.");
  
  const window = BrowserWindow.fromWebContents(event.sender);
  
  // 1. Prompt user to select their exported .enc file
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Select Encrypted Vault File',
    filters: [{ name: 'Encrypted Vault', extensions: ['enc'] }],
    properties: ['openFile']
  });

  if (canceled || filePaths.length === 0) {
    throw new Error("Vault file selection canceled.");
  }

  // 2. Try to decrypt the selected file with the imported key to verify it works!
  try {
    const fileContent = await fs.readFile(filePaths[0], 'utf8');
    const payload = JSON.parse(fileContent);

    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const tempKey = Buffer.from(importedKeyBase64, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', tempKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(payload.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    // If we reach here, the key is correct and decryption succeeded!
    // 3. Copy the file into the local AppData directory
    await fs.writeFile(DB_PATH, fileContent, 'utf8');
  } catch (err) {
    throw new Error("The selected file could not be decrypted with this Device Link Key. Are you sure they match?");
  }
  
  // 4. Encrypt the imported key using the local OS enclave and save it
  const encryptedMFK = safeStorage.encryptString(importedKeyBase64).toString('base64');
  await fs.writeFile(KEY_STORE_PATH, JSON.stringify({ encryptedMFK }), 'utf8');
  
  // 5. Update volatile memory
  masterFileKey = Buffer.from(importedKeyBase64, 'base64');
  resetAutoLock();
  return true;
});

ipcMain.handle('lock', () => {
  masterFileKey = null;
  if (autoLockTimeout) clearTimeout(autoLockTimeout);
  return true;
});

ipcMain.handle('save-data', async (event, dataStr) => {
  if (!masterFileKey) throw new Error("App is locked.");
  resetAutoLock();
  
  // Encrypt with AES-256-GCM
  const iv = crypto.randomBytes(12);
  const salt = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv('aes-256-gcm', masterFileKey, iv);
  let ciphertext = cipher.update(dataStr, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');

  const payload = {
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    authTag: authTag,
    ciphertext: ciphertext
  };

  await fs.writeFile(DB_PATH, JSON.stringify(payload), 'utf8');
  return true;
});

ipcMain.handle('load-data', async () => {
  if (!masterFileKey) throw new Error("App is locked.");
  resetAutoLock();

  try {
    const fileContent = await fs.readFile(DB_PATH, 'utf8');
    const payload = JSON.parse(fileContent);

    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterFileKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(payload.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return "{}"; // New DB
    }
    throw error;
  }
});

// Clipboard Sanitizer
ipcMain.handle('copy-to-clipboard', (event, text) => {
  clipboard.writeText(text);
  setTimeout(() => {
    if (clipboard.readText() === text) {
      clipboard.clear();
    }
  }, 30 * 1000); // 30 seconds
  return true;
});

// Settings Handlers
let autoLockMinutes = 5;

ipcMain.handle('get-file-paths', () => {
  return {
    dbPath: DB_PATH,
    keyPath: KEY_STORE_PATH
  };
});

ipcMain.handle('get-settings', () => {
  return {
    autoLockMinutes: autoLockMinutes
  };
});

ipcMain.handle('set-settings', (event, newSettings) => {
  if (newSettings.autoLockMinutes) {
    autoLockMinutes = newSettings.autoLockMinutes;
    resetAutoLock();
  }
  return true;
});

ipcMain.handle('export-vault', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: 'Export Encrypted Vault',
    defaultPath: 'biometricpass.enc',
    filters: [{ name: 'Encrypted Vault', extensions: ['enc'] }]
  });

  if (canceled || !filePath) return false;

  try {
    const fileContent = await fs.readFile(DB_PATH);
    await fs.writeFile(filePath, fileContent);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error("Your vault is completely empty and hasn't been saved to disk yet.");
    }
    throw err;
  }
});
