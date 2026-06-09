"use client";

/**
 * app/page.js
 * 
 * Main Entry Point for the Telegram Affiliate Bot Admin Dashboard.
 * Implements a modern single-page App layout with:
 *  - Authentication & Logout
 *  - Real-time status widgets and connection indicators
 *  - Interactive WhatsApp login (QR Code and Phone pairing)
 *  - Interactive Telegram StringSession Generator Wizard
 *  - Environment variable editor (.env file manager)
 *  - Live, searchable log terminal
 *  - Manual deal conversion sandbox (webhook test tool)
 */

import { useState, useEffect, useRef } from 'react';
import styles from './page.module.css';

export default function AdminDashboard() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [token, setToken] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [authChecking, setAuthChecking] = useState(true);

  // App settings & navigation
  const [activeTab, setActiveTab] = useState('overview');
  const [apiUrl, setApiUrl] = useState('');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [apiInput, setApiInput] = useState('');

  // Status and logs state
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsFilter, setLogsFilter] = useState('');
  const [logsAutoRefresh, setLogsAutoRefresh] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);

  // Config editor state
  const [configData, setConfigData] = useState({});
  const [configLoading, setConfigLoading] = useState(false);
  const [configMessage, setConfigMessage] = useState({ text: '', type: '' });

  // Webhook sandbox state
  const [webhookMessage, setWebhookMessage] = useState('');
  const [webhookChatTitle, setWebhookChatTitle] = useState('Admin Sandbox');
  const [webhookChatId, setWebhookChatId] = useState('admin_sandbox');
  const [webhookSending, setWebhookSending] = useState(false);
  const [webhookResult, setWebhookResult] = useState(null);

  // WhatsApp manual linking state
  const [waPhone, setWaPhone] = useState('');
  const [waPairingLoading, setWaPairingLoading] = useState(false);
  const [waLinkMessage, setWaLinkMessage] = useState('');

  // Telegram session wizard state
  const [tgStep, setTgStep] = useState(1); // 1: phone, 2: code, 3: password
  const [tgPhone, setTgPhone] = useState('');
  const [tgCode, setTgCode] = useState('');
  const [tgPassword, setTgPassword] = useState('');
  const [tgCodeHash, setTgCodeHash] = useState('');
  const [tgWizardLoading, setTgWizardLoading] = useState(false);
  const [tgWizardError, setTgWizardError] = useState('');
  const [tgWizardSuccess, setTgWizardSuccess] = useState('');

  // Global messages
  const [globalMessage, setGlobalMessage] = useState({ text: '', type: '' });

  // Log container ref for auto-scrolling
  const logTerminalRef = useRef(null);

  // ─── Initialize Configuration & Session ──────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedToken = localStorage.getItem('admin_token');
      const savedApiUrl = localStorage.getItem('admin_api_url') || `${window.location.protocol}//${window.location.hostname}:3000`;
      
      setToken(savedToken);
      setApiUrl(savedApiUrl);
      setApiInput(savedApiUrl);
      
      if (savedToken) {
        setIsAuthenticated(true);
      }
      setAuthChecking(false);
    }
  }, []);

  // Poll status & logs
  useEffect(() => {
    if (!isAuthenticated || !token || !apiUrl) return;

    fetchStatus();
    fetchLogs();

    // Set up intervals
    const statusInterval = setInterval(fetchStatus, 8000);
    let logsInterval;
    if (logsAutoRefresh) {
      logsInterval = setInterval(fetchLogs, 5000);
    }

    return () => {
      clearInterval(statusInterval);
      if (logsInterval) clearInterval(logsInterval);
    };
  }, [isAuthenticated, token, apiUrl, logsAutoRefresh]);

  // Scroll to bottom of logs on update
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [logs]);

  // Helper to trigger timed status notification
  const showToast = (text, type = 'success') => {
    setGlobalMessage({ text, type });
    setTimeout(() => setGlobalMessage({ text: '', type: '' }), 5000);
  };

  // ─── HTTP API Requests ────────────────────────────────────────────────────
  const fetchStatus = async () => {
    if (!token || !apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}/api/admin/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      if (data.success) {
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const fetchLogs = async () => {
    if (!token || !apiUrl) return;
    setLogsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/logs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  const fetchConfig = async () => {
    if (!token || !apiUrl) return;
    setConfigLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/config`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setConfigData(data.config);
      } else {
        showToast(data.message || 'Failed to load config', 'danger');
      }
    } catch (err) {
      showToast('Error connecting to backend API', 'danger');
    } finally {
      setConfigLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('admin_token', data.token);
        setToken(data.token);
        setIsAuthenticated(true);
        setPasswordInput('');
      } else {
        setLoginError(data.message || 'Invalid admin credentials');
      }
    } catch (err) {
      setLoginError('Could not connect to backend server. Make sure it is running.');
    }
  };

  const handleLogout = async () => {
    try {
      if (apiUrl && token) {
        await fetch(`${apiUrl}/api/admin/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch (e) {}
    localStorage.removeItem('admin_token');
    setToken(null);
    setIsAuthenticated(false);
    setStatus(null);
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setConfigMessage({ text: '', type: '' });
    setConfigLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/config/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(configData)
      });
      const data = await res.json();
      if (data.success) {
        setConfigMessage({ text: data.message, type: 'success' });
        showToast('Configuration updated! Remember to restart the bot.', 'success');
      } else {
        setConfigMessage({ text: data.message || 'Failed to update configuration', type: 'danger' });
      }
    } catch (err) {
      setConfigMessage({ text: 'Error connecting to API', type: 'danger' });
    } finally {
      setConfigLoading(false);
    }
  };

  const handleRestartBot = async () => {
    if (!window.confirm('Are you sure you want to restart the bot? This will disconnect services momentarily.')) return;
    try {
      const res = await fetch(`${apiUrl}/api/admin/bot/restart`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Bot restart signal sent. Connection will restore shortly.', 'warning');
        setStatus(null);
      }
    } catch (err) {
      showToast('Restart request failed. Bot might be starting up.', 'danger');
    }
  };

  const handleWebhookSubmit = async (e) => {
    e.preventDefault();
    setWebhookSending(true);
    setWebhookResult(null);
    try {
      const res = await fetch(`${apiUrl}/api/webhook/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: webhookMessage,
          chatTitle: webhookChatTitle,
          chatId: webhookChatId,
        })
      });
      const data = await res.json();
      setWebhookResult(data);
      if (data.success) {
        showToast('Manual webhook deal enqueued successfully!', 'success');
        setWebhookMessage('');
      } else {
        showToast('Webhook submission failed', 'danger');
      }
    } catch (err) {
      showToast('Error processing webhook sandbox request', 'danger');
    } finally {
      setWebhookSending(false);
    }
  };

  // ─── WhatsApp Pairing Code Flow ─────────────────────────────────────────
  const handleRequestWaPairing = async (e) => {
    e.preventDefault();
    if (!waPhone.trim()) return;
    setWaPairingLoading(true);
    setWaLinkMessage('');
    try {
      // We must save the new phone number to .env first, then trigger restart,
      // because Baileys reads phoneNumber from config on connection.update
      const saveRes = await fetch(`${apiUrl}/api/admin/config/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ WHATSAPP_PHONE_NUMBER: waPhone.trim() })
      });
      const saveData = await saveRes.json();
      
      if (saveData.success) {
        setWaLinkMessage('Phone number saved. Restarting bot to initialize pairing code flow...');
        // Trigger bot restart so WhatsApp service boots up with the phone number
        await fetch(`${apiUrl}/api/admin/bot/restart`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        setTimeout(() => {
          setWaLinkMessage('Bot is restarting. Please wait 10-15 seconds, then refresh status to view pairing code.');
          setWaPairingLoading(false);
        }, 8000);
      } else {
        setWaLinkMessage('Failed to save phone number configuration.');
        setWaPairingLoading(false);
      }
    } catch (err) {
      setWaLinkMessage('Error requesting pairing code: ' + err.message);
      setWaPairingLoading(false);
    }
  };

  // ─── Telegram Web Login Wizard ──────────────────────────────────────────
  const handleTgSendCode = async (e) => {
    e.preventDefault();
    if (!tgPhone.trim()) return;
    setTgWizardLoading(true);
    setTgWizardError('');
    setTgWizardSuccess('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/telegram/login/send-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ phoneNumber: tgPhone.trim() })
      });
      const data = await res.json();
      if (data.success && data.phoneCodeHash) {
        setTgCodeHash(data.phoneCodeHash);
        setTgStep(2);
        setTgWizardSuccess('Verification code sent to Telegram. Please check your Telegram app.');
      } else {
        setTgWizardError(data.message || 'Failed to request login code');
      }
    } catch (err) {
      setTgWizardError('Error: ' + err.message);
    } finally {
      setTgWizardLoading(false);
    }
  };

  const handleTgVerifyCode = async (e) => {
    e.preventDefault();
    if (!tgCode.trim()) return;
    setTgWizardLoading(true);
    setTgWizardError('');
    setTgWizardSuccess('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/telegram/login/verify-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          phoneCode: tgCode.trim(),
          phoneCodeHash: tgCodeHash,
          password: tgPassword || null
        })
      });
      const data = await res.json();
      if (data.success) {
        setTgStep(4);
        setTgWizardSuccess('Success! GramJS StringSession generated and saved to environment variables.');
        showToast('Telegram linked successfully!', 'success');
      } else if (data.needsPassword) {
        setTgStep(3);
        setTgWizardSuccess('2FA password required.');
      } else {
        setTgWizardError(data.message || 'Code verification failed');
      }
    } catch (err) {
      setTgWizardError('Error: ' + err.message);
    } finally {
      setTgWizardLoading(false);
    }
  };

  const handleTgResetWizard = () => {
    setTgStep(1);
    setTgPhone('');
    setTgCode('');
    setTgPassword('');
    setTgCodeHash('');
    setTgWizardError('');
    setTgWizardSuccess('');
  };

  // Safe masks representation for lists
  const handleConfigChange = (key, value) => {
    setConfigData(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const saveApiSettings = (e) => {
    e.preventDefault();
    localStorage.setItem('admin_api_url', apiInput);
    setApiUrl(apiInput);
    setShowSettingsModal(false);
    showToast('API Endpoint saved successfully', 'info');
  };

  // Uptime Formatter
  const formatUptime = (seconds) => {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  };

  // Loading Screen during auth hydrate
  if (authChecking) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading Admin Dashboard...</p>
      </div>
    );
  }

  // ─── LOGIN SCREEN ────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className={styles.loginPage}>
        <div className={styles.settingsGear} onClick={() => { setApiInput(apiUrl); setShowSettingsModal(true); }}>
          ⚙️ Backend Settings
        </div>

        <div className={`${styles.loginCard} glass-panel animate-fade-in`}>
          <div className={styles.logoHeader}>
            <span className={styles.botIcon}>🤖</span>
            <h1>Telegram Bot Admin</h1>
            <p>Control center for EarnKaro & WhatsApp automation</p>
          </div>

          <form onSubmit={handleLogin} className={styles.loginForm}>
            <div className={styles.inputGroup}>
              <label htmlFor="admin-password">Admin Password</label>
              <input
                id="admin-password"
                type="password"
                placeholder="Enter password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                required
              />
            </div>

            {loginError && <div className={styles.loginError}>{loginError}</div>}

            <button type="submit" className="btn btn-primary">
              Authenticate
            </button>
          </form>

          <div className={styles.footerNote}>
            API Endpoint: <code>{apiUrl}</code>
          </div>
        </div>

        {/* API Settings Modal */}
        {showSettingsModal && (
          <div className={styles.modalOverlay}>
            <div className={`${styles.modalContent} glass-panel animate-fade-in`}>
              <h2>Backend API Configuration</h2>
              <p>Configure the URL address of your running Express affiliate bot server.</p>
              
              <form onSubmit={saveApiSettings}>
                <div className={styles.inputGroup}>
                  <label htmlFor="api-url-config">Express Server URL</label>
                  <input
                    id="api-url-config"
                    type="text"
                    value={apiInput}
                    onChange={(e) => setApiInput(e.target.value)}
                    placeholder="http://localhost:3000"
                    required
                  />
                </div>
                <div className={styles.modalButtons}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowSettingsModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save API URL</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── MAIN DASHBOARD INTERFACE ──────────────────────────────────────────
  return (
    <div className={styles.dashboardContainer}>
      
      {/* Toast Notification */}
      {globalMessage.text && (
        <div className={`${styles.toast} ${styles[`toast-${globalMessage.type}`]} animate-fade-in`}>
          <span>{globalMessage.type === 'success' ? '✅' : globalMessage.type === 'danger' ? '❌' : '⚠️'}</span>
          <p>{globalMessage.text}</p>
        </div>
      )}

      {/* HEADER */}
      <header className={`${styles.dashboardHeader} glass-panel`}>
        <div className={styles.headerTitle}>
          <span className={styles.logoBadge}>🤖</span>
          <div>
            <h1>Telegram Affiliate Bot</h1>
            <p className={styles.apiLabel}>Backend: <code>{apiUrl}</code></p>
          </div>
        </div>

        <div className={styles.headerMeta}>
          {/* Telegram Status Badge */}
          <div className={styles.statusBadgeRow}>
            <span>Telegram:</span>
            {status?.telegram?.connected ? (
              <span className="badge badge-success">Connected</span>
            ) : (
              <span className="badge badge-danger">Disconnected</span>
            )}
          </div>

          {/* WhatsApp Status Badge */}
          <div className={styles.statusBadgeRow}>
            <span>WhatsApp:</span>
            {status?.whatsapp?.connected ? (
              <span className="badge badge-success">Ready</span>
            ) : (
              <span className="badge badge-danger">Offline</span>
            )}
          </div>

          {/* Control Panel Settings */}
          <button className="btn btn-secondary" onClick={() => { setApiInput(apiUrl); setShowSettingsModal(true); }}>
            ⚙️ Server URL
          </button>
          
          <button className="btn btn-danger" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* CORE CONTENT LAYOUT */}
      <div className={styles.dashboardMain}>
        
        {/* SIDEBAR NAVIGATION */}
        <aside className={`${styles.sidebar} glass-panel`}>
          <nav className={styles.sidebarNav}>
            <button
              className={`${styles.navItem} ${activeTab === 'overview' ? styles.navItemActive : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              📊 System Overview
            </button>
            <button
              className={`${styles.navItem} ${activeTab === 'whatsapp' ? styles.navItemActive : ''}`}
              onClick={() => setActiveTab('whatsapp')}
            >
              💬 WhatsApp Connector
            </button>
            <button
              className={`${styles.navItem} ${activeTab === 'telegram' ? styles.navItemActive : ''}`}
              onClick={() => setActiveTab('telegram')}
            >
              ✈️ Telegram Session
            </button>
            <button
              className={`${styles.navItem} ${activeTab === 'config' ? styles.navItemActive : ''}`}
              onClick={() => { setActiveTab('config'); fetchConfig(); }}
            >
              🔧 Configuration Editor
            </button>
            <button
              className={`${styles.navItem} ${activeTab === 'logs' ? styles.navItemActive : ''}`}
              onClick={() => { setActiveTab('logs'); fetchLogs(); }}
            >
              💻 Live Log Viewer
            </button>
            <button
              className={`${styles.navItem} ${activeTab === 'webhook' ? styles.navItemActive : ''}`}
              onClick={() => setActiveTab('webhook')}
            >
              🏜️ Deal Sandbox
            </button>
          </nav>

          {status && (
            <div className={styles.sidebarFooter}>
              <p>Uptime: <strong>{formatUptime(status.process?.uptime)}</strong></p>
              <p>Memory: <strong>{status.process?.memory?.heapUsedMb} MB</strong> / {status.process?.memory?.heapTotalMb} MB</p>
              <p>Node: <strong>{status.process?.nodeVersion}</strong></p>
            </div>
          )}
        </aside>

        {/* VIEWS PANE */}
        <main className={styles.mainContent}>
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className={`${styles.viewPanel} animate-fade-in`}>
              <h2>System Health & Metrics</h2>
              <p className={styles.subtitle}>Overview of processing queues, resource usage, and background client tasks.</p>

              <div className={styles.cardGrid}>
                {/* Telegram Widget */}
                <div className={`${styles.statCard} glass-panel`}>
                  <div className={styles.cardHeader}>
                    <h3>Telegram TelegramClient</h3>
                    <span className={status?.telegram?.connected ? styles.greenDot : styles.redDot}></span>
                  </div>
                  <div className={styles.cardBody}>
                    <p>Status: <strong>{status?.telegram?.connected ? 'Active (Connected)' : 'Disconnected'}</strong></p>
                    {status?.telegram?.connected && status?.telegram?.user && (
                      <>
                        <p>User: <strong>@{status.telegram.user.username}</strong></p>
                        <p>ID: <code>{status.telegram.user.id}</code></p>
                        <p>Name: <strong>{status.telegram.user.firstName} {status.telegram.user.lastName}</strong></p>
                      </>
                    )}
                    <p>Allowed Chats: <strong>{status?.telegram?.allowedChats?.length || 0} chats whitelisted</strong></p>
                  </div>
                </div>

                {/* WhatsApp Widget */}
                <div className={`${styles.statCard} glass-panel`}>
                  <div className={styles.cardHeader}>
                    <h3>WhatsApp Native Client</h3>
                    <span className={status?.whatsapp?.connected ? styles.greenDot : styles.redDot}></span>
                  </div>
                  <div className={styles.cardBody}>
                    <p>Status: <strong>{status?.whatsapp?.connected ? 'Online (Ready)' : 'Offline'}</strong></p>
                    <p>Quiet Hours: <strong>{status?.whatsapp?.isSleepTime ? 'Sleeping (12AM - 9AM)' : 'Active (No Sleep)'}</strong></p>
                    <p>Session Folder: <strong>{status?.whatsapp?.sessionExists ? 'Exists' : 'Empty / Missing'}</strong></p>
                    <p>Target Group ID: <code>{status?.whatsapp?.targetGroup || 'Not Configured'}</code></p>
                  </div>
                </div>

                {/* Queue Lengths Widget */}
                <div className={`${styles.statCard} glass-panel`}>
                  <div className={styles.cardHeader}>
                    <h3>Active Queues (BullMQ/p-queue)</h3>
                    <span>🔄</span>
                  </div>
                  <div className={styles.cardBody}>
                    <p>Processor Concurrency: <strong>1 (Strict pacing)</strong></p>
                    <p>Primary Queue size: <strong>{status?.queues?.size ?? 0} jobs</strong></p>
                    <p>Primary Queue pending: <strong>{status?.queues?.pending ?? 0} active</strong></p>
                    <p>New Pipeline Queue size: <strong>{status?.queues?.newPipeline?.size ?? 0} jobs</strong></p>
                    <p>New Pipeline Queue pending: <strong>{status?.queues?.newPipeline?.pending ?? 0} active</strong></p>
                  </div>
                </div>
              </div>

              {/* Bot Control Panel */}
              <div className={`${styles.dashboardSection} glass-panel`}>
                <h3>Bot Process Controls</h3>
                <p className={styles.sectionDesc}>Trigger process commands to handle server refreshes, session resets, or container reloads.</p>
                <div className={styles.buttonRow}>
                  <button className="btn btn-secondary" onClick={fetchStatus} disabled={statusLoading}>
                    🔄 Refresh Status
                  </button>
                  <button className="btn btn-danger" onClick={handleRestartBot}>
                    ⚡ Restart Bot Process
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: WHATSAPP CONNECTOR */}
          {activeTab === 'whatsapp' && (
            <div className={`${styles.viewPanel} animate-fade-in`}>
              <h2>WhatsApp (Baileys) Connector</h2>
              <p className={styles.subtitle}>Link your WhatsApp account to forward affiliate deals to group chats.</p>

              {status?.whatsapp?.connected ? (
                <div className={`${styles.successBanner} glass-panel`}>
                  <span className={styles.hugeIcon}>✅</span>
                  <h3>WhatsApp Client Connected!</h3>
                  <p>Your WhatsApp application has been linked successfully. Deals will automatically be forwarded to the configured target group.</p>
                  <p>Target JID: <code>{status.whatsapp.targetGroup}</code></p>
                </div>
              ) : (
                <div className={styles.setupContainer}>
                  {/* Option 1: QR Code Scanner */}
                  <div className={`${styles.setupBox} glass-panel`}>
                    <h3>Scan QR Code</h3>
                    <p>Select this mode to link your device by scanning a QR Code with WhatsApp &rarr; Linked Devices.</p>
                    
                    {status?.whatsapp?.qr ? (
                      <div className={styles.qrCodeContainer}>
                        {/* We use standard public QR api rendering the QR text string */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(status.whatsapp.qr)}`}
                          alt="WhatsApp Linking QR Code"
                          className={styles.qrImage}
                        />
                        <p className={styles.qrInstructions}>Open WhatsApp on your phone, go to Settings &gt; Linked Devices, and scan this QR code.</p>
                      </div>
                    ) : (
                      <div className={styles.noQrPlaceholder}>
                        <p>No active QR code generated. Wait 10-15 seconds for Baileys to output the QR, or verify you don't have a phone number configured.</p>
                      </div>
                    )}
                  </div>

                  {/* Option 2: Pairing Code Linker */}
                  <div className={`${styles.setupBox} glass-panel`}>
                    <h3>Link with Phone Number</h3>
                    <p>Enter your phone number (with country code, numbers only) to generate a 2FA pairing code.</p>

                    <form onSubmit={handleRequestWaPairing} className={styles.setupForm}>
                      <div className={styles.inputGroup}>
                        <label htmlFor="wa-phone-number">WhatsApp Phone Number</label>
                        <input
                          id="wa-phone-number"
                          type="text"
                          placeholder="e.g. 919999999999"
                          value={waPhone}
                          onChange={(e) => setWaPhone(e.target.value)}
                          disabled={waPairingLoading}
                          required
                        />
                      </div>
                      <button type="submit" className="btn btn-primary" disabled={waPairingLoading}>
                        {waPairingLoading ? 'Saving & Requesting...' : 'Request Pairing Code'}
                      </button>
                    </form>

                    {status?.whatsapp?.pairingCode ? (
                      <div className={styles.pairingCodeBox}>
                        <p>Your WhatsApp Pairing Code is:</p>
                        <div className={styles.codeText}>{status.whatsapp.pairingCode}</div>
                        <p className={styles.pairingInstructions}>
                          Go to WhatsApp on your phone &gt; Linked Devices &gt; Link with Phone Number, select your region and enter this code.
                        </p>
                      </div>
                    ) : (
                      waLinkMessage && <div className={styles.linkMessage}>{waLinkMessage}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TELEGRAM SESSION WIZARD */}
          {activeTab === 'telegram' && (
            <div className={`${styles.viewPanel} animate-fade-in`}>
              <h2>Telegram Session Wizard</h2>
              <p className={styles.subtitle}>Interactive helper to generate the <code>TELEGRAM_STRING_SESSION</code> variable, eliminating terminal execution.</p>

              {status?.telegram?.connected ? (
                <div className={`${styles.successBanner} glass-panel`}>
                  <span className={styles.hugeIcon}>✈️</span>
                  <h3>Telegram Service Connected!</h3>
                  <p>You have an active Telegram connection, listening on configured chats in real-time.</p>
                  {status.telegram.user && (
                    <p>Logged in as: <strong>@{status.telegram.user.username}</strong> ({status.telegram.user.id})</p>
                  )}
                  <button className="btn btn-secondary" onClick={handleTgResetWizard} style={{ marginTop: '16px' }}>
                    Generate New Session String
                  </button>
                </div>
              ) : (
                <div className={`${styles.wizardBox} glass-panel`}>
                  <div className={styles.wizardSteps}>
                    <span className={`${styles.stepIndicator} ${tgStep >= 1 ? styles.stepActive : ''}`}>1. Phone</span>
                    <span className={styles.stepConnector}></span>
                    <span className={`${styles.stepIndicator} ${tgStep >= 2 ? styles.stepActive : ''}`}>2. OTP Code</span>
                    <span className={styles.stepConnector}></span>
                    <span className={`${styles.stepIndicator} ${tgStep >= 3 ? styles.stepActive : ''}`}>3. 2FA (Optional)</span>
                    <span className={styles.stepConnector}></span>
                    <span className={`${styles.stepIndicator} ${tgStep >= 4 ? styles.stepActive : ''}`}>4. Success</span>
                  </div>

                  {tgWizardError && <div className={styles.wizardError}>{tgWizardError}</div>}
                  {tgWizardSuccess && <div className={styles.wizardSuccess}>{tgWizardSuccess}</div>}

                  {/* STEP 1: Enter Phone Number */}
                  {tgStep === 1 && (
                    <form onSubmit={handleTgSendCode} className={styles.wizardForm}>
                      <div className={styles.inputGroup}>
                        <label htmlFor="tg-phone-number">Phone Number (with international format)</label>
                        <input
                          id="tg-phone-number"
                          type="text"
                          placeholder="e.g. +919999999999"
                          value={tgPhone}
                          onChange={(e) => setTgPhone(e.target.value)}
                          required
                        />
                      </div>
                      <button type="submit" className="btn btn-primary" disabled={tgWizardLoading}>
                        {tgWizardLoading ? 'Sending OTP...' : 'Send Verification Code'}
                      </button>
                    </form>
                  )}

                  {/* STEP 2: Enter Verification Code */}
                  {tgStep === 2 && (
                    <form onSubmit={handleTgVerifyCode} className={styles.wizardForm}>
                      <div className={styles.inputGroup}>
                        <label htmlFor="tg-otp-code">Verification Code (received in Telegram App)</label>
                        <input
                          id="tg-otp-code"
                          type="text"
                          placeholder="e.g. 12345"
                          value={tgCode}
                          onChange={(e) => setTgCode(e.target.value)}
                          required
                        />
                      </div>
                      <div className={styles.wizardButtons}>
                        <button type="button" className="btn btn-secondary" onClick={handleTgResetWizard} disabled={tgWizardLoading}>Back</button>
                        <button type="submit" className="btn btn-primary" disabled={tgWizardLoading}>
                          {tgWizardLoading ? 'Verifying...' : 'Verify Code'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* STEP 3: Enter 2FA Password */}
                  {tgStep === 3 && (
                    <form onSubmit={handleTgVerifyCode} className={styles.wizardForm}>
                      <div className={styles.inputGroup}>
                        <label htmlFor="tg-2fa-password">2FA Password (Cloud Password)</label>
                        <input
                          id="tg-2fa-password"
                          type="password"
                          placeholder="Enter your 2FA password"
                          value={tgPassword}
                          onChange={(e) => setTgPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className={styles.wizardButtons}>
                        <button type="button" className="btn btn-secondary" onClick={() => setTgStep(2)} disabled={tgWizardLoading}>Back</button>
                        <button type="submit" className="btn btn-primary" disabled={tgWizardLoading}>
                          {tgWizardLoading ? 'Verifying Password...' : 'Verify Password'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* STEP 4: Success Screen */}
                  {tgStep === 4 && (
                    <div className={styles.wizardSuccessScreen}>
                      <span className={styles.hugeIcon}>🎉</span>
                      <h3>Session Saved Successfully!</h3>
                      <p>Your Telegram credential <code>TELEGRAM_STRING_SESSION</code> has been generated and written directly to your environment configuration file.</p>
                      <button className="btn btn-primary" onClick={handleRestartBot} style={{ marginTop: '20px' }}>
                        ⚡ Restart Bot to Connect
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CONFIGURATION EDITOR */}
          {activeTab === 'config' && (
            <div className={`${styles.viewPanel} animate-fade-in`}>
              <h2>Environment Variables Editor</h2>
              <p className={styles.subtitle}>Manage options in your local <code>.env</code> file. Changes require a restart to apply.</p>

              {configLoading ? (
                <div className={styles.viewLoader}>
                  <div className={styles.spinner}></div>
                  <p>Fetching configuration settings...</p>
                </div>
              ) : (
                <form onSubmit={handleSaveConfig} className={`${styles.configForm} glass-panel`}>
                  {configMessage.text && (
                    <div className={configMessage.type === 'success' ? styles.wizardSuccess : styles.wizardError}>
                      {configMessage.text}
                    </div>
                  )}

                  <div className={styles.configSectionsGrid}>
                    {/* Section: Server config */}
                    <div className={styles.configCardSection}>
                      <h3>🖥️ Server Details</h3>
                      
                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-port">PORT</label>
                        <input
                          id="cfg-port"
                          type="number"
                          value={configData.PORT || ''}
                          onChange={(e) => handleConfigChange('PORT', parseInt(e.target.value) || '')}
                        />
                      </div>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-env">NODE_ENV</label>
                        <select
                          id="cfg-env"
                          value={configData.NODE_ENV || 'development'}
                          onChange={(e) => handleConfigChange('NODE_ENV', e.target.value)}
                        >
                          <option value="development">development</option>
                          <option value="production">production</option>
                        </select>
                      </div>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-admin-pwd">ADMIN_PASSWORD</label>
                        <input
                          id="cfg-admin-pwd"
                          type="text"
                          value={configData.ADMIN_PASSWORD || ''}
                          onChange={(e) => handleConfigChange('ADMIN_PASSWORD', e.target.value)}
                          placeholder="Masked (Type new value to change)"
                        />
                      </div>
                    </div>

                    {/* Section: Telegram Config */}
                    <div className={styles.configCardSection}>
                      <h3>✈️ Telegram Credentials</h3>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-tg-api">TELEGRAM_API_ID</label>
                        <input
                          id="cfg-tg-api"
                          type="number"
                          value={configData.TELEGRAM_API_ID || ''}
                          onChange={(e) => handleConfigChange('TELEGRAM_API_ID', parseInt(e.target.value) || '')}
                        />
                      </div>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-tg-hash">TELEGRAM_API_HASH</label>
                        <input
                          id="cfg-tg-hash"
                          type="text"
                          value={configData.TELEGRAM_API_HASH || ''}
                          onChange={(e) => handleConfigChange('TELEGRAM_API_HASH', e.target.value)}
                          placeholder="Masked (Type to update)"
                        />
                      </div>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-tg-chats">TELEGRAM_ALLOWED_CHATS</label>
                        <input
                          id="cfg-tg-chats"
                          type="text"
                          value={configData.TELEGRAM_ALLOWED_CHATS || ''}
                          onChange={(e) => handleConfigChange('TELEGRAM_ALLOWED_CHATS', e.target.value)}
                          placeholder="Comma-separated IDs e.g. -1001827364, -1002345"
                        />
                      </div>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-tg-bot">TELEGRAM_CONVERSION_BOT_USERNAME</label>
                        <input
                          id="cfg-tg-bot"
                          type="text"
                          value={configData.TELEGRAM_CONVERSION_BOT_USERNAME || ''}
                          onChange={(e) => handleConfigChange('TELEGRAM_CONVERSION_BOT_USERNAME', e.target.value)}
                          placeholder="e.g. EarnKaroBot"
                        />
                      </div>
                    </div>

                    {/* Section: EarnKaro Config */}
                    <div className={styles.configCardSection}>
                      <h3>💰 EarnKaro Affiliate Settings</h3>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-ek-token">EARNKARO_API_TOKEN</label>
                        <input
                          id="cfg-ek-token"
                          type="text"
                          value={configData.EARNKARO_API_TOKEN || ''}
                          onChange={(e) => handleConfigChange('EARNKARO_API_TOKEN', e.target.value)}
                          placeholder="Masked (Type to update)"
                        />
                      </div>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-ek-url">EARNKARO_API_URL</label>
                        <input
                          id="cfg-ek-url"
                          type="text"
                          value={configData.EARNKARO_API_URL || ''}
                          onChange={(e) => handleConfigChange('EARNKARO_API_URL', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Section: WhatsApp Config */}
                    <div className={styles.configCardSection}>
                      <h3>💬 WhatsApp Settings</h3>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-wa-group">WHATSAPP_TARGET_GROUP</label>
                        <input
                          id="cfg-wa-group"
                          type="text"
                          value={configData.WHATSAPP_TARGET_GROUP || ''}
                          onChange={(e) => handleConfigChange('WHATSAPP_TARGET_GROUP', e.target.value)}
                        />
                      </div>

                      <div className={styles.inputGroup}>
                        <label htmlFor="cfg-wa-phone">WHATSAPP_PHONE_NUMBER</label>
                        <input
                          id="cfg-wa-phone"
                          type="text"
                          value={configData.WHATSAPP_PHONE_NUMBER || ''}
                          onChange={(e) => handleConfigChange('WHATSAPP_PHONE_NUMBER', e.target.value)}
                          placeholder="Numbers only, with country code (e.g. 919876543210)"
                        />
                      </div>
                    </div>
                  </div>

                  <div className={styles.configFooterRow}>
                    <button type="submit" className="btn btn-success" disabled={configLoading}>
                      Save Configuration
                    </button>
                    <button type="button" className="btn btn-danger" onClick={handleRestartBot}>
                      ⚡ Restart Bot to Apply
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 5: LIVE LOG VIEWER */}
          {activeTab === 'logs' && (
            <div className={`${styles.viewPanel} animate-fade-in`}>
              <div className={styles.logHeaderRow}>
                <div>
                  <h2>Live Winston Console Logs</h2>
                  <p className={styles.subtitle}>Real-time rotating execution logs of core pipeline stages.</p>
                </div>
                <div className={styles.logControls}>
                  <input
                    type="text"
                    placeholder="🔍 Filter logs..."
                    value={logsFilter}
                    onChange={(e) => setLogsFilter(e.target.value)}
                    className={styles.logSearch}
                  />
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={logsAutoRefresh}
                      onChange={(e) => setLogsAutoRefresh(e.target.checked)}
                    />
                    Auto Refresh (5s)
                  </label>
                  <button className="btn btn-secondary" onClick={fetchLogs} disabled={logsLoading}>
                    Refresh Now
                  </button>
                </div>
              </div>

              {/* TERMINAL SCROLLER */}
              <div className={styles.terminalContainer} ref={logTerminalRef}>
                {logs.length === 0 ? (
                  <p className={styles.logEmpty}>No active logs captured. Execute some transactions to populate logs.</p>
                ) : (
                  logs
                    .filter((line) => {
                      if (!logsFilter) return true;
                      return line.toLowerCase().includes(logsFilter.toLowerCase());
                    })
                    .map((line, idx) => {
                      // Basic terminal log highlighting
                      let logClass = styles.logInfo;
                      if (line.toLowerCase().includes('error')) logClass = styles.logError;
                      else if (line.toLowerCase().includes('warn')) logClass = styles.logWarn;
                      else if (line.toLowerCase().includes('success') || line.includes('✅')) logClass = styles.logSuccess;

                      return (
                        <div key={idx} className={`${styles.terminalLine} ${logClass}`}>
                          {line}
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}

          {/* TAB 6: WEBHOK SANDBOX */}
          {activeTab === 'webhook' && (
            <div className={`${styles.viewPanel} animate-fade-in`}>
              <h2>Deal Sandbox</h2>
              <p className={styles.subtitle}>Directly push sample Flipkart, Myntra, or Amazon deal links to test the converter pipeline without going via Telegram.</p>

              <div className={styles.sandboxSplit}>
                <form onSubmit={handleWebhookSubmit} className={`${styles.sandboxForm} glass-panel`}>
                  <h3>Simulate Deal Webhook</h3>
                  
                  <div className={styles.inputGroup}>
                    <label htmlFor="sandbox-message">Deal Message Text (contain some retail URLs)</label>
                    <textarea
                      id="sandbox-message"
                      rows={5}
                      placeholder="🔥 Flipkart Deal of the day! Shop here: https://flipkart.com/some-product-id"
                      value={webhookMessage}
                      onChange={(e) => setWebhookMessage(e.target.value)}
                      required
                    ></textarea>
                  </div>

                  <div className={styles.sandboxInputsRow}>
                    <div className={styles.inputGroup}>
                      <label htmlFor="sandbox-title">Chat Title (for log context)</label>
                      <input
                        id="sandbox-title"
                        type="text"
                        value={webhookChatTitle}
                        onChange={(e) => setWebhookChatTitle(e.target.value)}
                      />
                    </div>

                    <div className={styles.inputGroup}>
                      <label htmlFor="sandbox-id">Chat ID</label>
                      <input
                        id="sandbox-id"
                        type="text"
                        value={webhookChatId}
                        onChange={(e) => setWebhookChatId(e.target.value)}
                      />
                    </div>
                  </div>

                  <button type="submit" className="btn btn-primary" disabled={webhookSending}>
                    {webhookSending ? 'Processing deal...' : 'Convert & Broadcast Deal'}
                  </button>
                </form>

                {/* Sandbox output results */}
                <div className={`${styles.sandboxOutputBox} glass-panel`}>
                  <h3>Sandbox Pipeline Output</h3>
                  {webhookSending ? (
                    <div className={styles.sandboxLoader}>
                      <div className={styles.spinner}></div>
                      <p>Running message through URL extract, filter, EarnKaro convert, and WhatsApp dispatch stages...</p>
                    </div>
                  ) : webhookResult ? (
                    <div className={styles.resultDetails}>
                      <p>Status: <span className={webhookResult.success ? styles.successText : styles.dangerText}>
                        <strong>{webhookResult.success ? 'ACCEPTED' : 'FAILED'}</strong>
                      </span></p>
                      <p>Message: <strong>{webhookResult.message}</strong></p>
                      {webhookResult.messageId && (
                        <p>Assigned ID: <code>{webhookResult.messageId}</code></p>
                      )}
                      <p className={styles.sandboxAdvice}>
                        Check the <strong>Live Log Viewer</strong> to trace how this webhook message was extracted and if it completed successfully.
                      </p>
                    </div>
                  ) : (
                    <div className={styles.resultPlaceholder}>
                      Submit a deal message to verify pipeline execution.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      <footer className={styles.dashboardFooterInfo}>
        <p>Telegram Affiliate Bot Admin Dashboard © 2026. Made with modern Next.js App router and Vanilla CSS.</p>
      </footer>
    </div>
  );
}
