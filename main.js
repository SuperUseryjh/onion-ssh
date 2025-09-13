const { app, BrowserWindow, ipcMain, Menu } = require('electron'); // Import Menu
const path = require('path');
const url = require('url'); // Import url module
const fs = require('fs').promises; // Import fs.promises for async file operations
const { NodeSSH } = require('node-ssh');
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

  ipcMain.on('connect-ssh', async (event, config) => {
    const ssh = new NodeSSH();

    try {
      console.log('Attempting to connect SSH with config:', config);

      const sshConfig = {
        host: config.host,
        username: config.username,
        port: config.port || 22,
        strictHostKeyChecking: false,
      };

      // Handle proxy configuration
      if (config.proxyType && config.proxyType !== 'none' && config.proxyHost && config.proxyPort) {
        const proxyUrl = `${config.proxyType}://${config.proxyHost}:${config.proxyPort}`;
        console.log(`Using proxy: ${proxyUrl}`);
        if (config.proxyType === 'socks5') {
          sshConfig.agent = new SocksProxyAgent(proxyUrl);
        } else if (config.proxyType === 'http') {
          sshConfig.agent = new HttpsProxyAgent(proxyUrl);
        }
      }

      if (config.privateKeyPath) {
        try {
          sshConfig.privateKey = await fs.readFile(config.privateKeyPath, 'utf8');
          console.log('Using private key for authentication.');
        } catch (error) {
          console.error('Failed to read private key file:', error);
          throw new Error(`Failed to read private key file: ${error.message}`);
        }
      } else if (config.password) {
        sshConfig.password = config.password;
        sshConfig.authMethods = ['password', 'keyboard-interactive'];
        sshConfig.keyboardInteractive = (name, instructions, lang, prompts, finish) => {
          if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
            return finish([config.password]);
          }
          return finish([]);
        };
        console.log('Using password for authentication.');
      } else {
        throw new Error('No authentication method (password or private key) provided.');
      }

      await ssh.connect(sshConfig);
      console.log('SSH connection successful!');
      currentSSH = ssh; // Store the active SSH connection
      event.sender.send('ssh-connected', 'SSH connection established.');

      const shell = await ssh.requestShell();
      currentShell = shell; // Store the active shell

      shell.on('data', (data) => {
        event.sender.send('ssh-output', data.toString());
      });

      shell.on('close', () => {
        event.sender.send('ssh-disconnected', 'SSH connection closed.');
        currentSSH = null;
        currentShell = null; // Clear current shell
        if (ssh && ssh.isConnected()) {
          ssh.dispose();
        }
      });

      // Handle window close to dispose SSH connection
      mainWindow.on('closed', () => {
        if (currentSSH) {
          currentSSH.dispose();
          currentSSH = null;
        }
        currentShell = null; // Clear current shell
      });

    } catch (error) {
      console.error('SSH Connection Error in catch block:', error); // Log full error to main process console
      event.sender.send('ssh-error', error.message); // Send only message to renderer
      if (currentSSH) {
        currentSSH.dispose();
        currentSSH = null;
      }
      currentShell = null; // Clear current shell
    }
  });

  // Register ssh-input listener once outside the connect-ssh handler
  ipcMain.on('ssh-input', (event, data) => {
    if (currentShell && currentShell.writable) {
      currentShell.write(data);
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