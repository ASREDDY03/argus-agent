import React from 'react';

export default function ConfigModal({
    jenkinsConfig, loading,
    onClose, onConfigChange, onSave,
}) {
    return (
        <div
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.50)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{ background: '#ffffff', borderRadius: 14, width: 520, maxWidth: '95vw', boxShadow: '0 24px 64px rgba(0,0,0,0.22)', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #e2e8f0' }}>
                    <div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>Jenkins Configuration</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Connect Argus Agent to your Jenkins server</div>
                    </div>
                    <button onClick={onClose} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, width: 32, height: 32, fontSize: 18, cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </div>
                <div style={{ padding: '24px 24px 8px' }}>
                    <div style={{ marginBottom: 18 }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>Jenkins URL</label>
                        <input type="text" value={jenkinsConfig.url} onChange={e => onConfigChange('url', e.target.value)} placeholder="http://localhost:8080" style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>Username</label>
                            <input type="text" value={jenkinsConfig.user} onChange={e => onConfigChange('user', e.target.value)} placeholder="admin" style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>API Token</label>
                            <input type="password" value={jenkinsConfig.token} onChange={e => onConfigChange('token', e.target.value)} placeholder="Your Jenkins API token" style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
                        </div>
                    </div>

                    {/* Slack Webhook */}
                    <div style={{ marginBottom: 18 }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
                            Slack Webhook URL
                            <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>optional</span>
                        </label>
                        <input
                            type="password"
                            value={jenkinsConfig.slackWebhookUrl}
                            onChange={e => onConfigChange('slackWebhookUrl', e.target.value)}
                            placeholder="https://hooks.slack.com/services/..."
                            style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }}
                        />
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                            Alerts for failures, anomalies, and recoveries go to your channel. Leave blank to disable.
                        </div>
                    </div>

                    {/* SLA threshold */}
                    <div style={{ marginBottom: 18 }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
                            Build Time SLA
                            <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>seconds · optional</span>
                        </label>
                        <input
                            type="number"
                            min="0"
                            value={jenkinsConfig.slaDurationSeconds}
                            onChange={e => onConfigChange('slaDurationSeconds', e.target.value)}
                            placeholder="e.g. 300"
                            style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }}
                        />
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                            Any build exceeding this duration triggers a purple SLA Breach badge and Slack alert.
                        </div>
                    </div>

                    <div style={{ fontSize: 12, color: '#64748b', background: '#f8faff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '10px 14px', marginBottom: 24 }}>
                        💡 Get your API token: Jenkins → click your username → Configure → API Token → Generate New Token
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', background: '#f8faff', borderTop: '1px solid #e2e8f0' }}>
                    <button onClick={onClose} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, color: '#475569', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}>Cancel</button>
                    <button
                        onClick={onSave}
                        disabled={loading || !jenkinsConfig.user || !jenkinsConfig.token}
                        style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, color: '#fff', background: loading || !jenkinsConfig.user || !jenkinsConfig.token ? '#94a3b8' : '#4361ee', border: 'none', borderRadius: 7, cursor: loading || !jenkinsConfig.user || !jenkinsConfig.token ? 'not-allowed' : 'pointer', fontFamily: 'system-ui, sans-serif' }}
                    >
                        {loading ? 'Saving…' : 'Save & Connect'}
                    </button>
                </div>
            </div>
        </div>
    );
}
