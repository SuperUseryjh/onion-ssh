(function () {
  const { contextBridge, ipcRenderer } = require('electron');

  contextBridge.exposeInMainWorld(
    'electron',
    {
      send: (channel, data) => {
        let validChannels = ['connect-ssh', 'ssh-input']; // List of channels you want to allow from renderer to main
        if (validChannels.includes(channel)) {
          ipcRenderer.send(channel, data);
        }
      },
      receive: (channel, func) => {
        let validChannels = ['ssh-output', 'ssh-error', 'ssh-connected', 'ssh-disconnected']; // List of channels you want to allow from main to renderer
        if (validChannels.includes(channel)) {
          const subscription = (event, ...args) => func(...args);
          ipcRenderer.on(channel, subscription);
          return () => ipcRenderer.removeListener(channel, subscription);
        }
        return () => {}; // Return a no-op function if channel is not valid
      },
      invoke: (channel, ...args) => {
        let validChannels = ['get-connections', 'save-connection', 'delete-connection', 'read-file']; // List of channels you want to allow from renderer to main (invoke)
        if (validChannels.includes(channel)) {
          return ipcRenderer.invoke(channel, ...args);
        }
        return Promise.reject('Invalid IPC channel');
      }
    }
  );
})();