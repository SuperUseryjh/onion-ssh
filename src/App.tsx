import React, { useState, useEffect, useRef, createRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css'; // Import xterm.css
import { Layout, Menu, Button, Input, Form, List, Typography, Space, Tabs, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons';
import 'antd/dist/reset.css'; // Import Ant Design styles

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

// 定义连接的结构
interface Connection {
  id?: string;
  name: string;
  host: string;
  username: string;
  password?: string; // 如果以后使用密钥认证，密码可以是可选的
  port: number;
  privateKeyPath?: string; // 私钥文件路径
}

// 定义标签页的结构
interface Tab {
  id: string;
  name: string;
  connectionId: string;
  terminalRef: React.RefObject<HTMLDivElement>;
  termInstance: Terminal | null;
  fitAddonInstance: FitAddon | null;
  status: string;
}

declare global {
  interface Window {
    electron: {
      send: (channel: string, data: any) => void;
      receive: (channel: string, func: (...args: any[]) => void) => () => void; // receive现在返回一个清理函数
      invoke: (channel: string, ...args: any[]) => Promise<any>; // 添加invoke方法
    };
  }
}

const App: React.FC = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [isEditing, setIsEditing] = useState(false);
  const [status, setStatus] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(300); // 侧边栏初始宽度
  const [isResizing, setIsResizing] = useState(false); // 是否正在调整大小

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // IPC 监听器清理函数数组
  const ipcCleanupFunctions = useRef<(() => void)[]>([]);

  // 挂载时加载连接
  useEffect(() => {
    loadConnections();
  }, []);

  // 侧边栏调整大小逻辑
  const startResizing = (e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  useEffect(() => {
    const stopResizing = () => {
      setIsResizing(false);
    };

    const resizeSidebar = (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = e.clientX;
        if (newWidth > 100 && newWidth < window.innerWidth - 200) { // 限制最小和最大宽度
          setSidebarWidth(newWidth);
          // 调整当前活动终端的大小
          const activeTab = tabs.find(tab => tab.id === activeTabId);
          activeTab?.fitAddonInstance?.fit();
        }
      }
    };

    if (isResizing) {
      window.addEventListener('mousemove', resizeSidebar);
      window.addEventListener('mouseup', stopResizing);
    }

    return () => {
      window.removeEventListener('mousemove', resizeSidebar);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, tabs, activeTabId]);

  // IPC 监听器管理
  useEffect(() => {
    // 清理旧的 IPC 监听器
    ipcCleanupFunctions.current.forEach(cleanup => cleanup());
    ipcCleanupFunctions.current = [];

    // 为当前活动标签页设置新的 IPC 监听器
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    if (activeTab && activeTab.termInstance) {
      const termInstance = activeTab.termInstance;

      const cleanupConnected = window.electron.receive('ssh-connected', (message: string) => {
        setTabs(prevTabs => prevTabs.map(tab => tab.id === activeTabId ? { ...tab, status: message } : tab));
        termInstance.write(`\r\n${message}\r\n`);
      });
      const cleanupDisconnected = window.electron.receive('ssh-disconnected', (message: string) => {
        setTabs(prevTabs => prevTabs.map(tab => tab.id === activeTabId ? { ...tab, status: message } : tab));
        termInstance.write(`\r\n${message}\r\n`);
      });
      const cleanupOutput = window.electron.receive('ssh-output', (data: string) => {
        termInstance.write(data);
      });
      const cleanupError = window.electron.receive('ssh-error', (error: string) => {
        setTabs(prevTabs => prevTabs.map(tab => tab.id === activeTabId ? { ...tab, status: `错误: ${error}` } : tab));
        termInstance.write(`\r\n错误: ${error}\r\n`);
      });

      ipcCleanupFunctions.current.push(cleanupConnected, cleanupDisconnected, cleanupOutput, cleanupError);
    }

    return () => {
      ipcCleanupFunctions.current.forEach(cleanup => cleanup());
      ipcCleanupFunctions.current = [];
    };
  }, [activeTabId, tabs]); // 依赖于 activeTabId 和 tabs

  const loadConnections = async () => {
    try {
      const loadedConnections: Connection[] = await window.electron.invoke('get-connections');
      setConnections(loadedConnections);
    } catch (error) {
      console.error('加载连接失败:', error);
      message.error('加载连接失败。');
    }
  };

  const handleSaveConnection = async (values: Connection) => {
    try {
      const updatedConnections: Connection[] = await window.electron.invoke('save-connection', { ...values, id: selectedConnectionId });
      setConnections(updatedConnections);
      resetForm();
      message.success('连接已保存!');
    } catch (error) {
      console.error('保存连接失败:', error);
      message.error('保存连接失败。');
    }
  };

  const handleEditConnection = (connection: Connection) => {
    form.setFieldsValue(connection);
    setSelectedConnectionId(connection.id || null);
    setIsEditing(true);
  };

  const handleDeleteConnection = async (id: string) => {
    try {
      const updatedConnections: Connection[] = await window.electron.invoke('delete-connection', id);
      setConnections(updatedConnections);
      message.success('连接已删除!');
      if (selectedConnectionId === id) {
        resetForm();
      }
      // 如果删除的是当前活动连接，则关闭所有相关标签页
      setTabs(prevTabs => prevTabs.filter(tab => tab.connectionId !== id));
      if (activeTabId && tabs.find(tab => tab.id === activeTabId)?.connectionId === id) {
        setActiveTabId(null);
      }
    } catch (error) {
      console.error('删除连接失败:', error);
      message.error('删除连接失败。');
    }
  };

  const handleSelectConnection = (connection: Connection) => {
    setSelectedConnectionId(connection.id || null);
    form.setFieldsValue(connection);
    setIsEditing(true);
  };

  const addTab = (connection: Connection) => {
    const newTabId = `tab-${Date.now()}`;
    const newTerminalRef = createRef<HTMLDivElement>();
    const newTermInstance = new Terminal();
    const newFitAddonInstance = new FitAddon();

    setTabs(prevTabs => [
      ...prevTabs,
      {
        id: newTabId,
        name: connection.name,
        connectionId: connection.id!,
        terminalRef: newTerminalRef,
        termInstance: newTermInstance,
        fitAddonInstance: newFitAddonInstance,
        status: '未连接',
      }
    ]);
    setActiveTabId(newTabId);

    // 确保终端在DOM中渲染后才打开
    setTimeout(() => {
      if (newTerminalRef.current) {
        newTermInstance.loadAddon(newFitAddonInstance);
        newTermInstance.open(newTerminalRef.current);
        newFitAddonInstance.fit();

        newTermInstance.onData((data) => {
          window.electron.send('ssh-input', data);
        });

        // 立即尝试连接
        message.loading('正在连接...', 0);
        newTermInstance.reset();
        window.electron.send('connect-ssh', {
          host: connection.host,
          username: connection.username,
          password: connection.password,
          port: connection.port,
          privateKeyPath: connection.privateKeyPath, // 传递私钥路径
        });
      }
    }, 0);
  };

  const removeTab = (tabId: string) => {
    setTabs(prevTabs => {
      const updatedTabs = prevTabs.filter(tab => tab.id !== tabId);
      const tabToRemove = prevTabs.find(tab => tab.id === tabId);
      tabToRemove?.termInstance?.dispose(); // 清理终端实例

      if (activeTabId === tabId) {
        // 如果关闭的是当前活动标签页，则激活下一个标签页或设置为null
        setActiveTabId(updatedTabs.length > 0 ? updatedTabs[0].id : null);
      }
      return updatedTabs;
    });
  };

  const activateTab = (tabId: string) => {
    setActiveTabId(tabId);
    // 确保终端在DOM中渲染后才调整大小
    setTimeout(() => {
      const activeTab = tabs.find(tab => tab.id === tabId);
      activeTab?.fitAddonInstance?.fit();
    }, 0);
  };

  const handleConnectToSelected = () => {
    if (!selectedConnectionId) {
      message.warning('请先选择一个连接。');
      return;
    }
    const connectionToConnect = connections.find(conn => conn.id === selectedConnectionId);
    if (!connectionToConnect) {
      message.error('未找到选定的连接。');
      return;
    }

    // 检查是否已经有连接到此服务器的标签页
    const existingTab = tabs.find(tab => tab.connectionId === connectionToConnect.id);
    if (existingTab) {
      activateTab(existingTab.id);
    } else {
      addTab(connectionToConnect);
    }
  };

  const resetForm = () => {
    form.resetFields();
    setSelectedConnectionId(null);
    setIsEditing(false);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={sidebarWidth}
        theme="light"
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          borderRight: '1px solid #f0f0f0',
        }}
      >
        <div style={{ padding: '20px' }}>
          <Title level={4}>连接管理</Title>
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSaveConnection}
            initialValues={{ port: 22 }}
          >
            <Form.Item
              name="name"
              label="连接名称"
              rules={[{ required: true, message: '请输入连接名称!' }]}
            >
              <Input placeholder="连接名称" />
            </Form.Item>
            <Form.Item
              name="host"
              label="主机"
              rules={[{ required: true, message: '请输入主机地址!' }]}
            >
              <Input placeholder="主机" />
            </Form.Item>
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名!' }]}
            >
              <Input placeholder="用户名" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
            >
              <Input.Password placeholder="密码 (如果使用密码认证)" />
            </Form.Item>
            <Form.Item
              name="privateKeyPath"
              label="私钥文件路径"
            >
              <Input placeholder="私钥文件路径 (如果使用证书认证)" />
            </Form.Item>
            <Form.Item
              name="port"
              label="端口"
              rules={[{ required: true, message: '请输入端口号!' }]}
            >
              <Input type="number" placeholder="端口" />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
                  {isEditing ? '更新连接' : '添加连接'}
                </Button>
                {isEditing && (
                  <Button onClick={resetForm}>
                    取消编辑
                  </Button>
                )}
              </Space>
            </Form.Item>
          </Form>

          <Title level={5} style={{ marginTop: '20px' }}>已保存连接</Title>
          {connections.length === 0 ? (
            <Text type="secondary">尚未保存任何连接。</Text>
          ) : (
            <List
              itemLayout="horizontal"
              dataSource={connections}
              renderItem={(conn) => (
                <List.Item
                  actions={[
                    <Button
                      type={selectedConnectionId === conn.id ? 'primary' : 'default'}
                      icon={<PlayCircleOutlined />}
                      onClick={() => handleSelectConnection(conn)}
                      size="small"
                    >
                      选择
                    </Button>,
                    <Button
                      icon={<EditOutlined />}
                      onClick={() => handleEditConnection(conn)}
                      size="small"
                    >
                      编辑
                    </Button>,
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteConnection(conn.id!)}
                      size="small"
                    >
                      删除
                    </Button>,
                  ]}
                  style={{
                    border: selectedConnectionId === conn.id ? '1px solid #1890ff' : '1px solid #f0f0f0',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    padding: '12px',
                  }}
                >
                  <List.Item.Meta
                    title={<Text strong>{conn.name}</Text>}
                    description={`${conn.host}:${conn.port}`}
                  />
                </List.Item>
              )}
            />
          )}
        </div>
      </Sider>

      {/* 调整大小手柄 */}
      <div
        style={{
          width: '5px',
          cursor: 'ew-resize',
          backgroundColor: '#eee',
          flexShrink: 0,
          position: 'fixed',
          left: sidebarWidth,
          top: 0,
          bottom: 0,
          zIndex: 1,
        }}
        onMouseDown={startResizing}
      ></div>

      <Layout style={{ marginLeft: sidebarWidth + 5 }}>
        <Content style={{ padding: '24px', margin: 0, minHeight: 280, display: 'flex', flexDirection: 'column' }}>
          <Tabs
            type="editable-card"
            onChange={activateTab}
            activeKey={activeTabId || undefined}
            onEdit={(targetKey, action) => {
              if (action === 'remove' && typeof targetKey === 'string') {
                removeTab(targetKey);
              }
            }}
            items={tabs.map(tab => ({
              key: tab.id,
              label: tab.name,
              children: (
                <div style={{ height: 'calc(100vh - 180px)', display: 'flex', flexDirection: 'column' }}>
                  <Text strong>状态:</Text>
                  <Text>{tab.status}</Text>
                  <div ref={tab.terminalRef} style={{ flexGrow: 1, backgroundColor: 'black', minHeight: '300px', marginTop: '10px' }}></div>
                </div>
              ),
            }))}
            tabBarExtraContent={
              <Button
                type="primary"
                onClick={handleConnectToSelected}
                disabled={!selectedConnectionId}
                icon={<PlayCircleOutlined />}
              >
                连接到选定服务器
              </Button>
            }
          />
          {tabs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px' }}>
              <Text type="secondary">请选择一个连接并点击“连接到选定服务器”来打开一个终端标签页。</Text>
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  );
};

export default App;