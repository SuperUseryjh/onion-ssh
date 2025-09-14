const { app, BrowserWindow, ipcMain, Menu } = require('electron'); // Import Menu
const { exec, spawn } = require('child_process'); // Import child_process for executing shell commands
const path = require('path');
const url = require('url'); // Import url module
const fs = require('fs').promises; // Import fs.promises for async file operations
const { NodeSSH } = require('node-ssh');
const iconv = require('iconv-lite'); // Import iconv-lite
const Store = require('electron-store').default; // Import electron-store
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs for connections
const { SocksProxyAgent } = require('socks-proxy-agent'); // Import SocksProxyAgent
const { HttpsProxyAgent } = require('https-proxy-agent'); // Import HttpsProxyAgent

const store = new Store({ name: 'ssh-connections' }); // Create a store instance

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // 禁用 nodeIntegration，通过 preload 脚本安全地暴露 API
      contextIsolation: true, // 启用 contextIsolation
    },
  });

  // Load index.html from the dist directory using a file:// URL
  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'dist/index.html'),
    protocol: 'file:',
    slashes: true
  }));

  // Remove default menu
  Menu.setApplicationMenu(null);

  let currentSSH = null; // To store the active SSH connection
  let currentShell = null; // To store the active SSH shell
  let currentPowershellProcess = null; // To store the active PowerShell process
  let currentCmdProcess = null; // To store the active CMD process

  // IPC handlers for connection management
  ipcMain.handle('get-connections', () => {
    return store.get('connections', []);
  });

  ipcMain.handle('save-connection', (event, connection) => {
    let connections = store.get('connections', []);
    if (connection.id) {
      // Update existing connection
      connections = connections.map(conn => conn.id === connection.id ? connection : conn);
    } else {
      // Add new connection
      connection.id = uuidv4();
      connections.push(connection);
    }
    store.set('connections', connections);
    return connections;
  });

  ipcMain.handle('delete-connection', (event, id) => {
    let connections = store.get('connections', []);
    connections = connections.filter(conn => conn.id !== id);
    store.set('connections', connections);
    return connections;
  });

  // IPC handler to read file content (for private keys)
  ipcMain.handle('read-file', async (event, filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      console.error('Failed to read file:', filePath, error);
      throw new Error(`Failed to read file: ${error.message}`);
    }
  });

  // IPC handlers for clipboard operations
  ipcMain.handle('clipboard-read-text', () => {
    const { clipboard } = require('electron');
    return clipboard.readText();
  });

  ipcMain.handle('clipboard-write-text', (event, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
  });

  ipcMain.on('connect-ssh', async (event, config) => {
    const ssh = new NodeSSH();
    try {
      console.log('Attempting to connect to PowerShell');

      if (currentPowershellProcess) {
        currentPowershellProcess.kill();
        currentPowershellProcess = null;
      }

      const powershellProcess = spawn('powershell.exe', []);
      currentPowershellProcess = powershellProcess;

      powershellProcess.stdout.on('data', (data) => {
        event.sender.send('ssh-output', iconv.decode(data, 'gbk'));
      });

      powershellProcess.stderr.on('data', (data) => {
        event.sender.send('ssh-error', iconv.decode(data, 'gbk'));
      });

      powershellProcess.on('close', (code) => {
        console.log(`PowerShell process exited with code ${code}`);
        event.sender.send('ssh-disconnected', `PowerShell connection closed with code ${code}.`);
        currentPowershellProcess = null;
      });

      powershellProcess.on('error', (err) => {
        console.error('Failed to start PowerShell process:', err);
        event.sender.send('ssh-error', `Failed to start PowerShell: ${err.message}`);
        currentPowershellProcess = null;
      });

      event.sender.send('ssh-connected', 'Connected to PowerShell');

    } catch (error) {
      console.error('PowerShell Connection Error:', error);
      event.sender.send('ssh-error', error.message);
      if (currentPowershellProcess) {
        currentPowershellProcess.kill();
        currentPowershellProcess = null;
      }
    }
  });

  // IPC handler to connect to CMD
  ipcMain.on('connect-cmd', async (event) => {
    try {
      console.log('Attempting to connect to CMD');

      if (currentCmdProcess) {
        currentCmdProcess.kill();
        currentCmdProcess = null;
      }

      const cmdProcess = spawn('cmd.exe', []);
      currentCmdProcess = cmdProcess;

      cmdProcess.stdout.on('data', (data) => {
        event.sender.send('ssh-output', iconv.decode(data, 'gbk'));
      });

      cmdProcess.stderr.on('data', (data) => {
        event.sender.send('ssh-error', iconv.decode(data, 'gbk'));
      });

      cmdProcess.on('close', (code) => {
        console.log(`CMD process exited with code ${code}`);
        event.sender.send('ssh-disconnected', `CMD connection closed with code ${code}.`);
        currentCmdProcess = null;
      });

      cmdProcess.on('error', (err) => {
        console.error('Failed to start CMD process:', err);
        event.sender.send('ssh-error', `Failed to start CMD: ${err.message}`);
        currentCmdProcess = null;
      });

      event.sender.send('ssh-connected', 'Connected to CMD');

    } catch (error) {
      console.error('CMD Connection Error:', error);
      event.sender.send('ssh-error', error.message);
      if (currentCmdProcess) {
        currentCmdProcess.kill();
        currentCmdProcess = null;
      }
    }
  });

  // Register ssh-input listener once outside the connect-ssh handler
  ipcMain.on('ssh-input', (event, data) => {
    let processedData = data;

    // Check if the input is the xterm.js backspace character (DEL)
    // and if the target is CMD or PowerShell, convert it to BS.
    if (data === '\x7F') { // DEL character
      if (currentPowershellProcess || currentCmdProcess) {
        processedData = '\x08'; // BS character
      }
    }

    if (currentShell && currentShell.writable) {
      currentShell.write(processedData);
    } else if (currentWslProcess && currentWslProcess.stdin.writable) {
      currentWslProcess.stdin.write(processedData);
    } else if (currentPowershellProcess && currentPowershellProcess.stdin.writable) {
      currentPowershellProcess.stdin.write(processedData);
    } else if (currentCmdProcess && currentCmdProcess.stdin.writable) {
      currentCmdProcess.stdin.write(processedData);
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});