'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import DashboardLayout from '@/components/DashboardLayout';
import toast from 'react-hot-toast';
import { Sparkles, KeyRound, CheckCircle2, RefreshCw, Info } from 'lucide-react';

interface ModelOption {
  value: string;
  label: string;
}

interface UsageSnapshot {
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  rateLimits?: {
    limitRequests?: string | null;
    remainingRequests?: string | null;
    resetRequests?: string | null;
    limitTokens?: string | null;
    remainingTokens?: string | null;
    resetTokens?: string | null;
    retryAfter?: string | null;
  } | null;
  warning?: string | null;
  fetchedAt?: string;
}

function normalizeSignatureHtml(input: string) {
  if (!input) return '';

  return input.replace(/<img\b([^>]*)>/gi, (full, attrs: string) => {
    const srcMatch = attrs.match(/src\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
    const originalSrc = (srcMatch?.[2] || srcMatch?.[3] || '').trim();
    const normalizedSrc = originalSrc.startsWith('//') ? `https:${originalSrc}` : originalSrc;

    let proxiedSrc = normalizedSrc;
    if (normalizedSrc && !normalizedSrc.startsWith('data:') && !normalizedSrc.startsWith('cid:')) {
      proxiedSrc = `/api/signature-image?url=${encodeURIComponent(normalizedSrc)}`;
    }

    let nextAttrsRaw = attrs;
    if (srcMatch) {
      nextAttrsRaw = nextAttrsRaw.replace(srcMatch[0], `src="${proxiedSrc}"`);
    }

    const hasReferrer = /referrerpolicy\s*=\s*/i.test(attrs);
    const hasCrossOrigin = /crossorigin\s*=\s*/i.test(attrs);
    const hasStyle = /style\s*=\s*/i.test(attrs);

    const nextAttrs = [
      nextAttrsRaw.trim(),
      hasReferrer ? '' : 'referrerpolicy="no-referrer"',
      hasCrossOrigin ? '' : 'crossorigin="anonymous"',
      hasStyle ? '' : 'style="max-width:100%;height:auto;display:inline-block;"',
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    return `<img ${nextAttrs}>`;
  });
}

const DEFAULT_MODEL_OPTIONS: ModelOption[] = [
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (recommended)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
  { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
];

export default function SettingsPage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [deletingApiKey, setDeletingApiKey] = useState(false);
  const [groqApiKey, setGroqApiKey] = useState('');
  const [groqModel, setGroqModel] = useState('llama-3.1-8b-instant');
  const [keyValidated, setKeyValidated] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(DEFAULT_MODEL_OPTIONS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [showAiHelp, setShowAiHelp] = useState(false);

  const [emailSaving, setEmailSaving] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [emailSenderEnabled, setEmailSenderEnabled] = useState(false);
  const [emailSenderName, setEmailSenderName] = useState('');
  const [emailSenderAddress, setEmailSenderAddress] = useState('');
  const [emailSignatureHtml, setEmailSignatureHtml] = useState('');
  const [smtpHost, setSmtpHost] = useState('mail.octopi-digital.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpAllowSelfSigned, setSmtpAllowSelfSigned] = useState(true);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [hasSmtpPassword, setHasSmtpPassword] = useState(false);
  const [maskedSmtpPassword, setMaskedSmtpPassword] = useState<string | null>(null);
  const [editingSmtpPassword, setEditingSmtpPassword] = useState(false);
  const [deletingSmtpPassword, setDeletingSmtpPassword] = useState(false);

  const fetchGroqUsage = async (showToast = true) => {
    setUsageLoading(true);
    try {
      const res = await fetch('/api/settings/ai/usage');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load Groq usage');
      setUsageSnapshot(data);
      setUsageError(null);
    } catch (error) {
      setUsageSnapshot(null);
      const message = error instanceof Error ? error.message : 'Failed to load Groq usage';
      setUsageError(message);
      if (showToast) {
        toast.error(message);
      }
    }
    setUsageLoading(false);
  };

  const fetchGroqModels = async (apiKeyOverride?: string, selectedModel?: string) => {
    setModelsLoading(true);
    try {
      const res = await fetch('/api/settings/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiKeyOverride ? { apiKey: apiKeyOverride } : {}),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load models');

      const models: string[] = Array.isArray(data?.models) ? data.models : [];
      let nextOptions: ModelOption[] = models.map((model) => ({
        value: model,
        label: model,
      }));

      const selected = selectedModel || groqModel;
      if (selected && !nextOptions.some((opt) => opt.value === selected)) {
        nextOptions = [{ value: selected, label: `${selected} (saved)` }, ...nextOptions];
      }

      setModelOptions(nextOptions.length > 0 ? nextOptions : DEFAULT_MODEL_OPTIONS);
    } catch (error) {
      setModelOptions(DEFAULT_MODEL_OPTIONS);
      toast.error(error instanceof Error ? error.message : 'Failed to load models');
    }
    setModelsLoading(false);
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/ai');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load settings');

      setAiEnabled(Boolean(data?.aiEnabled));
      setHasApiKey(Boolean(data?.hasApiKey));
      setMaskedApiKey(data?.maskedApiKey || null);
      const savedModel = data?.groqModel || 'llama-3.1-8b-instant';
      setGroqModel(savedModel);
      setKeyValidated(Boolean(data?.aiEnabled && data?.hasApiKey));
      setEditingApiKey(false);

      if (data?.hasApiKey) {
        await fetchGroqModels(undefined, savedModel);
        await fetchGroqUsage(false);
      } else {
        setModelOptions(DEFAULT_MODEL_OPTIONS);
        setUsageSnapshot(null);
        setUsageError(null);
      }

      const emailRes = await fetch('/api/settings/email');
      const emailData = await emailRes.json().catch(() => null);
      if (emailRes.ok && emailData) {
        const sessionEmail = (session?.user?.email || '').trim();
        const savedSenderEmail = (emailData?.emailSenderAddress || '').trim();
        const savedSmtpUser = (emailData?.smtpUser || '').trim();
        const syncedEmail = savedSenderEmail || savedSmtpUser || sessionEmail;
        const syncedSmtpUser = savedSmtpUser || savedSenderEmail || sessionEmail;

        setEmailSenderEnabled(Boolean(emailData?.emailSenderEnabled));
        setEmailSenderName(emailData?.emailSenderName || '');
        setEmailSenderAddress(syncedEmail);
        setSmtpHost(emailData?.smtpHost || 'mail.octopi-digital.com');
        setSmtpPort(String(emailData?.smtpPort || 587));
        setSmtpSecure(typeof emailData?.smtpSecure === 'boolean' ? emailData.smtpSecure : true);
        setSmtpAllowSelfSigned(typeof emailData?.smtpAllowSelfSigned === 'boolean' ? emailData.smtpAllowSelfSigned : true);
        setSmtpUser(syncedSmtpUser);
        setSmtpPass('');
        setHasSmtpPassword(Boolean(emailData?.hasSmtpPassword));
        setMaskedSmtpPassword(emailData?.maskedSmtpPassword || null);
        setEditingSmtpPassword(false);
      } else if (session?.user?.email) {
        setEmailSenderAddress((prev) => prev || session.user.email || '');
        setSmtpUser((prev) => prev || session.user.email || '');
        setSmtpPass('');
      }

      const signatureRes = await fetch('/api/settings/email/signature');
      const signatureData = await signatureRes.json().catch(() => null);
      if (signatureRes.ok && signatureData) {
        setEmailSignatureHtml(signatureData?.emailSignatureHtml || '');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load settings');
    }
    setLoading(false);
  };

  const saveSignatureSettings = async () => {
    setSignatureSaving(true);
    try {
      const res = await fetch('/api/settings/email/signature', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailSignatureHtml }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save signature');

      setEmailSignatureHtml(data?.emailSignatureHtml || '');
      toast.success('Signature saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save signature');
    }
    setSignatureSaving(false);
  };

  const saveEmailSettings = async () => {
    setEmailSaving(true);
    try {
      const sessionEmail = session?.user?.email?.trim() || '';
      const finalSenderEmail = emailSenderAddress.trim() || smtpUser.trim() || sessionEmail;
      const finalSmtpUser = smtpUser.trim() || emailSenderAddress.trim() || sessionEmail;

      if (finalSenderEmail !== emailSenderAddress) {
        setEmailSenderAddress(finalSenderEmail);
      }
      if (finalSmtpUser !== smtpUser) {
        setSmtpUser(finalSmtpUser);
      }

      const res = await fetch('/api/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailSenderEnabled,
          emailSenderName,
          emailSenderAddress: finalSenderEmail,
          emailSignatureHtml,
          smtpHost,
          smtpPort: Number(smtpPort) || 587,
          smtpSecure,
          smtpAllowSelfSigned,
          smtpUser: finalSmtpUser,
          smtpPass,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save email settings');

      setEmailSenderEnabled(Boolean(data?.emailSenderEnabled));
      setEmailSenderName(data?.emailSenderName || '');
      setEmailSenderAddress(data?.emailSenderAddress || data?.smtpUser || session?.user?.email || '');
      setEmailSignatureHtml(data?.emailSignatureHtml || '');
      setSmtpHost(data?.smtpHost || 'mail.octopi-digital.com');
      setSmtpPort(String(data?.smtpPort || 587));
      setSmtpSecure(Boolean(data?.smtpSecure));
      setSmtpAllowSelfSigned(Boolean(data?.smtpAllowSelfSigned));
      setSmtpUser(data?.smtpUser || data?.emailSenderAddress || session?.user?.email || '');
      setHasSmtpPassword(Boolean(data?.hasSmtpPassword));
      setMaskedSmtpPassword(data?.maskedSmtpPassword || null);
      setSmtpPass('');
      setEditingSmtpPassword(false);
      toast.success('Email settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save email settings');
    }
    setEmailSaving(false);
  };

  const deleteSmtpPassword = async () => {
    setDeletingSmtpPassword(true);
    try {
      const res = await fetch('/api/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeSmtpPassword: true }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to delete SMTP password');

      setEmailSenderEnabled(false);
      setHasSmtpPassword(false);
      setMaskedSmtpPassword(null);
      setSmtpPass('');
      setEditingSmtpPassword(false);
      toast.success('SMTP password deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete SMTP password');
    }
    setDeletingSmtpPassword(false);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSmtpPass('');
    }, 250);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const userEmail = session?.user?.email?.trim();
    if (!userEmail) return;

    setEmailSenderAddress((prev) => prev || userEmail);
    setSmtpUser((prev) => prev || userEmail);
  }, [session?.user?.email]);

  const handleTestAndSave = async (enableAfterTest: boolean) => {
    setTesting(true);
    try {
      const payload = {
        aiEnabled: enableAfterTest,
        groqApiKey,
        groqModel,
      };

      const res = await fetch('/api/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Invalid API key');

      setHasApiKey(Boolean(data?.hasApiKey));
      setMaskedApiKey(data?.maskedApiKey || null);
      setAiEnabled(Boolean(data?.aiEnabled));
      setGroqModel(data?.groqModel || groqModel);
      setKeyValidated(Boolean(data?.hasApiKey));
      toast.success(enableAfterTest ? 'AI settings saved' : 'API key validated');
      if (data?.warning) {
        toast(data.warning);
      }
      if (groqApiKey) {
        setGroqApiKey('');
      }
      setEditingApiKey(false);

      if (data?.hasApiKey) {
        await fetchGroqModels(undefined, data?.groqModel || groqModel);
        await fetchGroqUsage(false);
      }
    } catch (error) {
      setKeyValidated(false);
      toast.error(error instanceof Error ? error.message : 'Failed to validate key');
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (aiEnabled && !keyValidated && !hasApiKey) {
        throw new Error('Validate and save a Groq API key first');
      }

      const res = await fetch('/api/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiEnabled,
          groqModel,
          groqApiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save settings');

      setHasApiKey(Boolean(data?.hasApiKey));
      setMaskedApiKey(data?.maskedApiKey || null);
      setKeyValidated(Boolean(data?.aiEnabled && data?.hasApiKey));
      setGroqModel(data?.groqModel || groqModel);
      setGroqApiKey('');
      setEditingApiKey(false);
      toast.success('Settings saved');
      if (data?.warning) {
        toast(data.warning);
      }

      if (data?.hasApiKey) {
        await fetchGroqModels(undefined, data?.groqModel || groqModel);
        await fetchGroqUsage(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save settings');
    }
    setSaving(false);
  };

  const handleDeleteApiKey = async () => {
    setDeletingApiKey(true);
    try {
      const res = await fetch('/api/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          removeApiKey: true,
          aiEnabled: false,
          groqModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to delete API key');

      setAiEnabled(false);
      setHasApiKey(false);
      setMaskedApiKey(null);
      setGroqApiKey('');
      setKeyValidated(false);
      setEditingApiKey(false);
      setModelOptions(DEFAULT_MODEL_OPTIONS);
      setUsageSnapshot(null);
      setUsageError(null);
      toast.success('API key deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete API key');
    }
    setDeletingApiKey(false);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 mt-1">Configure AI assistant for task writing.</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-5 flex flex-col h-full">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-gray-900">AI Writing Assistant (Groq)</h2>
              <p className="text-sm text-gray-500 mt-1">
                Enables “AI improve” for task title and description. Text is converted to natural US native English.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAiHelp((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700"
            >
              <Info size={14} />
              {showAiHelp ? 'Hide Help' : 'AI Help'}
            </button>
          </div>

          {showAiHelp && (
            <div className="border border-blue-100 bg-blue-50 rounded-lg p-4 text-sm text-blue-900 space-y-2">
              <p className="font-semibold">How to enable AI</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  Open
                  {' '}
                  <a
                    href="https://console.groq.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium"
                  >
                    Groq Console
                  </a>
                  {' '}
                  and sign in.
                </li>
                <li>
                  Go to
                  {' '}
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium"
                  >
                    API Keys
                  </a>
                  {' '}
                  and create a new API key.
                </li>
                <li>Paste the key in <span className="font-medium">Groq API Key</span> field.</li>
                <li>Click <span className="font-medium">Test Key</span> (or <span className="font-medium">Fetch from Groq</span> for models).</li>
                <li>Turn on <span className="font-medium">Enable AI</span> and click <span className="font-medium">Save Settings</span>.</li>
              </ol>
            </div>
          )}

          <div className="flex items-center justify-between border rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable AI</p>
              <p className="text-xs text-gray-500">When disabled, AI button is hidden in tasks.</p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="sr-only"
              />
              <span className={`w-11 h-6 rounded-full transition-colors ${aiEnabled ? 'bg-primary-600' : 'bg-gray-300'}`}>
                <span className={`block w-5 h-5 mt-0.5 bg-white rounded-full transition-transform ${aiEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Groq API Key</label>
              {hasApiKey && !editingApiKey ? (
                <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-sm text-gray-700 flex items-center gap-2">
                    <KeyRound size={16} className="text-gray-400" />
                    {maskedApiKey || 'Saved key'}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingApiKey(true)}
                      className="text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteApiKey}
                      disabled={deletingApiKey}
                      className="text-xs px-2 py-1 rounded-md border border-red-200 hover:bg-red-50 text-red-600 disabled:opacity-60"
                    >
                      {deletingApiKey ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    value={groqApiKey}
                    onChange={(e) => {
                      setGroqApiKey(e.target.value);
                      setKeyValidated(false);
                    }}
                    placeholder={hasApiKey ? 'Paste new key to replace current key' : 'gsk_...'}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                  />
                </div>
              )}
            </div>
            <div className="flex items-end">
              {(!hasApiKey || editingApiKey) && (
                <button
                  type="button"
                  onClick={() => handleTestAndSave(false)}
                  disabled={testing || !groqApiKey}
                  className="w-full px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-60 text-sm font-medium"
                >
                  {testing ? 'Testing...' : 'Test Key'}
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700">Model</label>
              <button
                type="button"
                onClick={() => fetchGroqModels(groqApiKey || undefined, groqModel)}
                disabled={modelsLoading || (!hasApiKey && !groqApiKey)}
                className="inline-flex items-center gap-1 text-xs text-primary-700 hover:text-primary-800 disabled:opacity-50"
              >
                <RefreshCw size={12} className={modelsLoading ? 'animate-spin' : ''} />
                {modelsLoading ? 'Loading...' : 'Fetch from Groq'}
              </button>
            </div>
            <select
              value={groqModel}
              onChange={(e) => setGroqModel(e.target.value)}
              disabled={!(keyValidated || hasApiKey)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm disabled:bg-gray-50 disabled:text-gray-400"
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Groq Usage Snapshot</p>
                <p className="text-xs text-gray-500">Live usage and rate limit data from Groq API.</p>
              </div>
              <button
                type="button"
                onClick={() => fetchGroqUsage(true)}
                disabled={usageLoading || !hasApiKey}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
              >
                <RefreshCw size={12} className={usageLoading ? 'animate-spin' : ''} />
                {usageLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {!hasApiKey ? (
              <p className="text-xs text-gray-500">Add API key first to view usage.</p>
            ) : usageError ? (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-2.5 py-2">
                {usageError}
              </p>
            ) : usageSnapshot ? (
              <div className="space-y-2 text-xs text-gray-600">
                <p>
                  Model: <span className="font-medium text-gray-800">{usageSnapshot.model}</span>
                </p>
                {usageSnapshot.warning && (
                  <p className="text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-2">
                    {usageSnapshot.warning}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="bg-gray-50 rounded-md p-2">
                    <p className="text-gray-500">Prompt Tokens</p>
                    <p className="text-sm font-semibold text-gray-900">{usageSnapshot.usage?.prompt_tokens ?? 0}</p>
                  </div>
                  <div className="bg-gray-50 rounded-md p-2">
                    <p className="text-gray-500">Completion Tokens</p>
                    <p className="text-sm font-semibold text-gray-900">{usageSnapshot.usage?.completion_tokens ?? 0}</p>
                  </div>
                  <div className="bg-gray-50 rounded-md p-2">
                    <p className="text-gray-500">Total Tokens</p>
                    <p className="text-sm font-semibold text-gray-900">{usageSnapshot.usage?.total_tokens ?? 0}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="border border-gray-100 rounded-md p-2">
                    <p className="text-gray-500">Requests Left</p>
                    <p className="font-medium text-gray-900">
                      {usageSnapshot.rateLimits?.remainingRequests ?? '-'} / {usageSnapshot.rateLimits?.limitRequests ?? '-'}
                    </p>
                    <p className="text-gray-500 mt-0.5">Reset: {usageSnapshot.rateLimits?.resetRequests ?? '-'}</p>
                  </div>
                  <div className="border border-gray-100 rounded-md p-2">
                    <p className="text-gray-500">Tokens Left</p>
                    <p className="font-medium text-gray-900">
                      {usageSnapshot.rateLimits?.remainingTokens ?? '-'} / {usageSnapshot.rateLimits?.limitTokens ?? '-'}
                    </p>
                    <p className="text-gray-500 mt-0.5">Reset: {usageSnapshot.rateLimits?.resetTokens ?? '-'}</p>
                  </div>
                </div>

                {usageSnapshot.fetchedAt && (
                  <p className="text-[11px] text-gray-400">
                    Updated: {new Date(usageSnapshot.fetchedAt).toLocaleString()}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500">Click refresh to load usage from Groq.</p>
            )}
          </div>

          <div className="flex items-center justify-between text-sm mt-auto pt-1">
            <p className="text-gray-500 flex items-center gap-2">
              <CheckCircle2 size={16} className={keyValidated || hasApiKey ? 'text-green-600' : 'text-gray-300'} />
              {keyValidated || hasApiKey ? 'API key configured' : 'API key not configured'}
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 text-sm font-medium"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col h-full">
          <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <KeyRound size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Email Sender (Task Mail)</h2>
              <p className="text-sm text-gray-500 mt-1">
                Configure your sender email and SMTP. Then you can send task-based email to any target address.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable Email Sender</p>
              <p className="text-xs text-gray-500">When enabled, task email button can send to target emails.</p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={emailSenderEnabled}
                onChange={(e) => setEmailSenderEnabled(e.target.checked)}
                className="sr-only"
              />
              <span className={`w-11 h-6 rounded-full transition-colors ${emailSenderEnabled ? 'bg-primary-600' : 'bg-gray-300'}`}>
                <span className={`block w-5 h-5 mt-0.5 bg-white rounded-full transition-transform ${emailSenderEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Sender Name</label>
              <input
                type="text"
                value={emailSenderName}
                onChange={(e) => setEmailSenderName(e.target.value)}
                placeholder="Your Name"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Sender Email</label>
              <input
                type="email"
                name="sender-email"
                autoComplete="off"
                value={emailSenderAddress}
                onChange={(e) => {
                  const value = e.target.value;
                  setEmailSenderAddress(value);
                  setSmtpUser(value);
                }}
                placeholder="you@company.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">SMTP Host</label>
              <input
                type="text"
                name="smtp-host"
                autoComplete="off"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">SMTP Port</label>
              <input
                type="number"
                name="smtp-port"
                autoComplete="off"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">SMTP Username</label>
              <input
                type="text"
                name="smtp-username"
                autoComplete="off"
                value={smtpUser}
                onChange={(e) => {
                  const value = e.target.value;
                  setSmtpUser(value);
                  setEmailSenderAddress(value);
                }}
                placeholder="SMTP username"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">SMTP Password</label>
              {hasSmtpPassword && !editingSmtpPassword ? (
                <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-sm text-gray-700">{maskedSmtpPassword || 'Saved password'}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingSmtpPassword(true)}
                      className="text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={deleteSmtpPassword}
                      disabled={deletingSmtpPassword}
                      className="text-xs px-2 py-1 rounded-md border border-red-200 hover:bg-red-50 text-red-600 disabled:opacity-60"
                    >
                      {deletingSmtpPassword ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="password"
                    name="smtp-password"
                    autoComplete="new-password"
                    data-lpignore="true"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder={hasSmtpPassword ? 'Enter new password to replace' : 'SMTP password / Email password'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                  />
                  {hasSmtpPassword && editingSmtpPassword && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSmtpPassword(false);
                          setSmtpPass('');
                        }}
                        className="text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-start">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={smtpSecure}
                onChange={(e) => setSmtpSecure(e.target.checked)}
              />
              Use secure SMTP (SSL/TLS)
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={smtpAllowSelfSigned}
              onChange={(e) => setSmtpAllowSelfSigned(e.target.checked)}
            />
            Allow self-signed TLS certificate (not recommended)
          </label>
          </div>

          <div className="pt-1 mt-auto flex justify-end">
            <button
              type="button"
              onClick={saveEmailSettings}
              disabled={emailSaving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 text-sm font-medium"
            >
              {emailSaving ? 'Saving...' : 'Save Email Settings'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-900">Email Signature</h2>
            <p className="text-sm text-gray-500 mt-1">Add your HTML signature separately. It will be used in task/report emails.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Signature HTML</label>
            <textarea
              value={emailSignatureHtml}
              onChange={(e) => setEmailSignatureHtml(e.target.value)}
              rows={6}
              placeholder="<p>Best regards,<br/><strong>Team</strong></p>"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Signature Preview</label>
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 text-sm text-gray-800 min-h-[80px]">
              {emailSignatureHtml.trim() ? (
                <div dangerouslySetInnerHTML={{ __html: normalizeSignatureHtml(emailSignatureHtml) }} />
              ) : (
                <span className="text-gray-400">No signature yet</span>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveSignatureSettings}
              disabled={signatureSaving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 text-sm font-medium"
            >
              {signatureSaving ? 'Saving...' : 'Save Signature'}
            </button>
          </div>
        </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
