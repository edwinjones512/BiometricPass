let vaultData = {};

const els = {
  lockScreen: document.getElementById('lock-screen'),
  vaultScreen: document.getElementById('vault-screen'),
  generateScreen: document.getElementById('generate-screen'),
  settingsScreen: document.getElementById('settings-screen'),
  btnUnlock: document.getElementById('btn-unlock'), 
  unlockStatus: document.getElementById('unlock-status'),
  navVault: document.getElementById('nav-vault'),
  navGenerate: document.querySelectorAll('.nav-item')[1],
  navSettings: document.querySelectorAll('.nav-item')[2],
  btnLock: document.getElementById('nav-lock'), 
  btnAdd: document.getElementById('btn-add'),
  modal: document.getElementById('add-modal'),
  btnSave: document.getElementById('btn-save'),
  btnCancel: document.getElementById('btn-cancel'),
  list: document.getElementById('credential-list'),
  inTitle: document.getElementById('input-title'),
  inUser: document.getElementById('input-username'),
  inPass: document.getElementById('input-password'),
  genDisplay: document.getElementById('generated-password-display'),
  genLength: document.getElementById('pwd-length'),
  genLengthLbl: document.getElementById('pwd-length-label'),
  btnGenNew: document.getElementById('btn-generate-new'),
  btnGenCopy: document.getElementById('btn-copy-generated'),
  pathDb: document.getElementById('path-db'),
  pathKey: document.getElementById('path-key'),
  selAutoLock: document.getElementById('auto-lock-select'),
  syncScreen: document.getElementById('sync-screen'),
  navSync: document.querySelectorAll('.nav-item')[3],
  exportDisplay: document.getElementById('export-key-display'),
  btnRevealKey: document.getElementById('btn-reveal-key'),
  btnCopyKey: document.getElementById('btn-copy-key'),
  importInput: document.getElementById('import-key-input'),
  btnImportKey: document.getElementById('btn-import-key'),
  importStatus: document.getElementById('import-status'),
  btnExportVault: document.getElementById('btn-export-vault'),
  exportVaultStatus: document.getElementById('export-vault-status')
};

els.btnUnlock.addEventListener('click', async () => {
  els.unlockStatus.innerText = "Prompting Windows Hello...";
  els.btnUnlock.classList.add('scanning');
  
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    
    // Attempt to verify via WebAuthn (triggers the OS biometric prompt)
    try {
      await navigator.credentials.create({
        publicKey: {
          challenge: challenge,
          rp: { name: "BiometricPass", id: "localhost" },
          user: {
            id: new Uint8Array(16),
            name: "user@biometricpass",
            displayName: "Local Vault User"
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { 
            authenticatorAttachment: "platform", 
            userVerification: "required" 
          },
          timeout: 60000,
          attestation: "none"
        }
      });
    } catch (e) {
      console.error(e);
      throw new Error(`WebAuthn Error: ${e.name} - ${e.message}`);
    }

    els.unlockStatus.innerText = "Decrypting Secure Enclave...";
    const res = await window.api.authenticate();
    if (res.success) {
      els.unlockStatus.innerText = "";
      await loadVault();
      showVault();
    } else {
      throw new Error(res.error || "Authentication failed.");
    }
  } catch (err) {
    els.unlockStatus.innerText = err.message || "Authentication failed.";
  } finally {
    els.btnUnlock.classList.remove('scanning');
    if (els.unlockStatus.innerText === "Decrypting Secure Enclave...") {
      els.unlockStatus.innerText = "Click fingerprint to verify...";
    }
  }
});

els.btnLock.addEventListener('click', async () => {
  await window.api.lock();
  vaultData = {};
  renderList();
  showLock();
});

window.api.onLocked(() => {
  vaultData = {};
  renderList();
  showLock();
});

els.btnAdd.addEventListener('click', () => {
  els.inTitle.value = '';
  els.inUser.value = '';
  els.inPass.value = '';
  els.modal.classList.remove('hidden');
});

els.btnCancel.addEventListener('click', () => {
  els.modal.classList.add('hidden');
});

els.btnSave.addEventListener('click', async () => {
  const id = Date.now().toString();
  vaultData[id] = {
    title: els.inTitle.value,
    username: els.inUser.value,
    password: els.inPass.value
  };
  
  await window.api.saveData(JSON.stringify(vaultData));
  els.modal.classList.add('hidden');
  renderList();
});

async function loadVault() {
  const dataStr = await window.api.loadData();
  vaultData = JSON.parse(dataStr);
  renderList();
}

function renderList() {
  els.list.innerHTML = '';
  for (const [id, cred] of Object.entries(vaultData)) {
    const li = document.createElement('li');
    li.className = 'list-item';
    
    const details = document.createElement('div');
    details.className = 'item-details';
    details.innerHTML = `<h4>${cred.title}</h4><p>${cred.username}</p>`;
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'secondary-btn';
    copyBtn.innerText = 'Copy';
    copyBtn.style.marginRight = '0.5rem';
    copyBtn.addEventListener('click', async () => {
      await window.api.copyToClipboard(cred.password);
      const originalText = copyBtn.innerText;
      copyBtn.innerText = 'Copied';
      setTimeout(() => copyBtn.innerText = originalText, 2000);
    });
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'secondary-btn';
    removeBtn.innerText = 'Remove';
    removeBtn.addEventListener('click', () => {
      openRemoveModal(id, cred.title);
    });
    
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.appendChild(copyBtn);
    actions.appendChild(removeBtn);
    
    li.appendChild(details);
    li.appendChild(actions);
    
    els.list.appendChild(li);
  }
}

let credentialToRemove = null;

function openRemoveModal(id, title) {
  credentialToRemove = id;
  const modalText = document.getElementById('remove-modal-text');
  modalText.innerText = `Are you sure you want to permanently delete the credential for "${title}"?`;
  document.getElementById('remove-modal').classList.remove('hidden');
}

document.getElementById('btn-remove-cancel').addEventListener('click', () => {
  credentialToRemove = null;
  document.getElementById('remove-modal').classList.add('hidden');
});

document.getElementById('btn-remove-confirm').addEventListener('click', async () => {
  if (credentialToRemove) {
    delete vaultData[credentialToRemove];
    await window.api.saveData(JSON.stringify(vaultData));
    credentialToRemove = null;
    document.getElementById('remove-modal').classList.add('hidden');
    renderList();
  }
});

function showVault() {
  els.lockScreen.classList.add('hidden');
  els.generateScreen.classList.add('hidden');
  els.settingsScreen.classList.add('hidden');
  els.syncScreen.classList.add('hidden');
  els.vaultScreen.classList.remove('hidden');
  els.navVault.classList.add('active');
  els.navGenerate.classList.remove('active');
  els.navSettings.classList.remove('active');
  els.navSync.classList.remove('active');
}

function showLock() {
  els.vaultScreen.classList.add('hidden');
  els.generateScreen.classList.add('hidden');
  els.settingsScreen.classList.add('hidden');
  els.syncScreen.classList.add('hidden');
  els.lockScreen.classList.remove('hidden');
}

function showGenerate() {
  els.lockScreen.classList.add('hidden');
  els.vaultScreen.classList.add('hidden');
  els.settingsScreen.classList.add('hidden');
  els.syncScreen.classList.add('hidden');
  els.generateScreen.classList.remove('hidden');
  els.navGenerate.classList.add('active');
  els.navVault.classList.remove('active');
  els.navSettings.classList.remove('active');
  els.navSync.classList.remove('active');
  generatePassword();
}

async function showSettings() {
  els.lockScreen.classList.add('hidden');
  els.vaultScreen.classList.add('hidden');
  els.generateScreen.classList.add('hidden');
  els.syncScreen.classList.add('hidden');
  els.settingsScreen.classList.remove('hidden');
  els.navSettings.classList.add('active');
  els.navVault.classList.remove('active');
  els.navGenerate.classList.remove('active');
  els.navSync.classList.remove('active');
  
  const paths = await window.api.getFilePaths();
  els.pathDb.innerText = paths.dbPath;
  els.pathKey.innerText = paths.keyPath;
  
  const settings = await window.api.getSettings();
  els.selAutoLock.value = settings.autoLockMinutes;
}

function showSync() {
  els.lockScreen.classList.add('hidden');
  els.vaultScreen.classList.add('hidden');
  els.generateScreen.classList.add('hidden');
  els.settingsScreen.classList.add('hidden');
  els.syncScreen.classList.remove('hidden');
  els.navSync.classList.add('active');
  els.navVault.classList.remove('active');
  els.navGenerate.classList.remove('active');
  els.navSettings.classList.remove('active');
  
  els.exportDisplay.type = 'password';
  els.exportDisplay.value = 'Click reveal to show key';
  els.btnRevealKey.innerText = 'Reveal';
  els.importInput.value = '';
  els.importStatus.innerText = '';
}

els.navVault.addEventListener('click', (e) => {
  if (!els.lockScreen.classList.contains('hidden')) return;
  showVault();
});

els.navGenerate.addEventListener('click', (e) => {
  if (!els.lockScreen.classList.contains('hidden')) return;
  showGenerate();
});

els.navSettings.addEventListener('click', (e) => {
  if (!els.lockScreen.classList.contains('hidden')) return;
  showSettings();
});

els.navSync.addEventListener('click', (e) => {
  if (!els.lockScreen.classList.contains('hidden')) return;
  showSync();
});

els.selAutoLock.addEventListener('change', async () => {
  await window.api.setSettings({ autoLockMinutes: parseInt(els.selAutoLock.value) });
});

// Backup/Sync Logic
els.btnRevealKey.addEventListener('click', async () => {
  if (els.exportDisplay.type === 'password') {
    try {
      const key = await window.api.exportDeviceKey();
      els.exportDisplay.value = key;
      els.exportDisplay.type = 'text';
      els.btnRevealKey.innerText = 'Hide';
    } catch (err) {
      alert("Error exporting key: " + err.message);
    }
  } else {
    els.exportDisplay.type = 'password';
    els.exportDisplay.value = 'Click reveal to show key';
    els.btnRevealKey.innerText = 'Reveal';
  }
});

els.btnCopyKey.addEventListener('click', async () => {
  try {
    let keyToCopy = els.exportDisplay.value;
    // If not revealed, silently fetch it to copy
    if (els.exportDisplay.type === 'password') {
      keyToCopy = await window.api.exportDeviceKey();
    }
    
    await window.api.copyToClipboard(keyToCopy);
    const orig = els.btnCopyKey.innerText;
    els.btnCopyKey.innerText = 'Copied!';
    setTimeout(() => els.btnCopyKey.innerText = orig, 2000);
  } catch (err) {
    alert("Error copying key: " + err.message);
  }
});

els.btnImportKey.addEventListener('click', async () => {
  const keyToImport = els.importInput.value.trim();
  if (!keyToImport) {
    els.importStatus.style.color = '#f44336';
    els.importStatus.innerText = "Please enter a key.";
    return;
  }
  
  try {
    await window.api.importDeviceKey(keyToImport);
    els.importStatus.style.color = '#4caf50';
    els.importStatus.innerText = "Device successfully linked! Your vault is now decrypted using this machine's hardware.";
    els.importInput.value = '';
    // Reload the vault data using the new key
    await loadVault();
  } catch (err) {
    els.importStatus.style.color = '#f44336';
    els.importStatus.innerText = "Error: " + err.message;
  }
});

els.btnExportVault.addEventListener('click', async () => {
  try {
    const success = await window.api.exportVault();
    if (success) {
      els.exportVaultStatus.style.color = '#4caf50';
      els.exportVaultStatus.innerText = "Vault exported successfully!";
      setTimeout(() => els.exportVaultStatus.innerText = "", 3000);
    }
  } catch (err) {
    els.exportVaultStatus.style.color = '#f44336';
    els.exportVaultStatus.innerText = "Error: " + err.message;
  }
});

// Generate Password Logic
function generatePassword() {
  const len = parseInt(els.genLength.value);
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  let pwd = "";
  const randomValues = new Uint32Array(len);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < len; i++) {
    pwd += charset[randomValues[i] % charset.length];
  }
  els.genDisplay.innerText = pwd;
}

els.genLength.addEventListener('input', () => {
  els.genLengthLbl.innerText = els.genLength.value;
  generatePassword();
});

els.btnGenNew.addEventListener('click', generatePassword);

els.btnGenCopy.addEventListener('click', async () => {
  const text = els.genDisplay.innerText;
  await window.api.copyToClipboard(text);
  const original = els.btnGenCopy.innerText;
  els.btnGenCopy.innerText = 'Copied!';
  setTimeout(() => els.btnGenCopy.innerText = original, 2000);
});
