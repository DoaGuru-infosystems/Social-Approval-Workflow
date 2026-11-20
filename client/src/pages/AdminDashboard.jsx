import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Button from '../components/Button';
import postService from '../services/postService';
import clientService from '../services/clientService';
import adminService from '../services/adminService';
import { SERVER_URL, GOOGLE_CLOUD_TEST_USER_URL } from '../utils/constants';
import { formatDate } from '../utils/helpers';
import { useToast } from '../context/ToastContext';
import {
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Clock,
  AlertTriangle,
  Building2,
  Share2,
  ArrowLeft,
  Trash2,
  ExternalLink,
  AlertOctagon,
  Phone,
  MapPin,
  Globe,
  Plus,
  X,
  Server,
  ChevronDown,
  ChevronUp,
  XCircle,
  RotateCcw,
  PlusCircle,
  Settings2,
  Tag,
  Image as ImageIcon,
  UploadCloud,
} from 'lucide-react';

const InstagramIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
  </svg>
);

const FacebookIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
  </svg>
);

const YouTubeIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const LinkedInIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76c-.95 0-1.72-.77-1.72-1.72s.77-1.72 1.72-1.72 1.72.77 1.72 1.72-.77 1.72-1.72 1.72m1.39 9.74v-8.37H5.07v8.37h2.78z"/>
  </svg>
);

const AdminDashboard = () => {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Navigation State derived directly from URL search params
  const activeTab = searchParams.get('tab') === 'clients' ? 'clients' : 'pipeline';

  // Pipeline State
  const [allPosts, setAllPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [activeActionId, setActiveActionId] = useState(null);
  const [adminComments, setAdminComments] = useState({});

  // Client Management State
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientSubTab, setClientSubTab] = useState('identity_guidelines'); // 'identity_guidelines' | 'social_accounts'
  const [loadingClientDetail, setLoadingClientDetail] = useState(false);

  // Add Client Form Modal
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newPrimaryPhone, setNewPrimaryPhone] = useState('');
  const [newAlternatePhone, setNewAlternatePhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newGmbUrl, setNewGmbUrl] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);

  // Client Official Identity State (for selectedClient)
  const [identityName, setIdentityName] = useState('');
  const [identityPrimaryPhone, setIdentityPrimaryPhone] = useState('');
  const [identityAlternatePhone, setIdentityAlternatePhone] = useState('');
  const [identityAddress, setIdentityAddress] = useState('');
  const [identityGmbUrl, setIdentityGmbUrl] = useState('');
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [syncingGmb, setSyncingGmb] = useState(false);
  const [gmbKeyError, setGmbKeyError] = useState(null);

  // Brand Guidelines State (Interactive Tag Badges)
  const [whitelistTags, setWhitelistTags] = useState([]);
  const [whitelistInputText, setWhitelistInputText] = useState('');
  const [bannedTags, setBannedTags] = useState([]);
  const [bannedInputText, setBannedInputText] = useState('');
  const [mandatoryInput, setMandatoryInput] = useState('');
  const [savingGuidelines, setSavingGuidelines] = useState(false);

  // Official Brand Logo State
  const [referenceLogoUrl, setReferenceLogoUrl] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const logoInputRef = useRef(null);

  // 4-Platform Social Connect System (Single Agency App)
  const [socialPlatforms, setSocialPlatforms] = useState([
    { platform: 'instagram', is_connected: false, profile_url: null },
    { platform: 'facebook', is_connected: false, profile_url: null },
    { platform: 'youtube', is_connected: false, profile_url: null },
    { platform: 'linkedin', is_connected: false, profile_url: null },
  ]);
  const [manualFormPlatform, setManualFormPlatform] = useState(null);
  const [manualFormData, setManualFormData] = useState({
    instagram: { profile_url: '', platform_id: '', access_token: '', refresh_token: '' },
    facebook: { profile_url: '', platform_id: '', access_token: '', refresh_token: '' },
    youtube: { profile_url: '', platform_id: '', access_token: '', refresh_token: '' },
    linkedin: { profile_url: '', platform_id: '', access_token: '', refresh_token: '' },
  });
  const [actionLoading, setActionLoading] = useState({});
  const [cardBanners, setCardBanners] = useState({});

  // System & API Health Monitor State
  const [systemHealth, setSystemHealth] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [showHealthPanel, setShowHealthPanel] = useState(false);

  // Client Management Filters & Deletion Modal
  const [clientStatusFilter, setClientStatusFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [clientToDelete, setClientToDelete] = useState(null);
  const [deletingClient, setDeletingClient] = useState(false);

  const fetchClientSocialPlatforms = useCallback(async (clientId) => {
    try {
      const res = await clientService.getSocialPlatforms(clientId);
      if (res.platforms) {
        setSocialPlatforms(res.platforms);
      }
    } catch (err) {
      console.warn('Failed to fetch social platforms:', err);
    }
  }, []);

  const handleSelectClient = useCallback(
    async (clientId, updateUrl = true) => {
      if (updateUrl) {
        setSearchParams({ tab: 'clients', client: String(clientId) });
      }
      setLoadingClientDetail(true);
      setGmbKeyError(null);
      setManualFormPlatform(null);
      setCardBanners({});
      try {
        const data = await clientService.getClientById(clientId);
        setSelectedClient(data);

        const c = data?.client || {};
        setIdentityName(c.name || '');
        setIdentityPrimaryPhone(c.primary_phone || '');
        setIdentityAlternatePhone(c.alternate_phone || '');
        setIdentityAddress(c.address || '');
        setIdentityGmbUrl(c.gmb_url || '');

        const g = data?.brand_guidelines || {};
        setWhitelistTags(Array.isArray(g.whitelist_words) ? g.whitelist_words : []);
        setBannedTags(Array.isArray(g.banned_words) ? g.banned_words : []);
        setMandatoryInput((g.mandatory_phrases || []).join(', '));
        setReferenceLogoUrl(g.reference_logo_url || data?.client?.reference_logo_url || '');

        if (data?.social_platforms && data.social_platforms.length > 0) {
          setSocialPlatforms(data.social_platforms);
        } else {
          fetchClientSocialPlatforms(clientId);
        }
      } catch {
        showToast('Unable to load client details.', 'error');
      } finally {
        setLoadingClientDetail(false);
      }
    },
    [fetchClientSocialPlatforms, setSearchParams, showToast]
  );

  const fetchAdminPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const data = await postService.getPosts({ all: 'true' });
      const list = Array.isArray(data) ? data : data?.posts || [];
      setAllPosts(list);
    } catch {
      showToast('Unable to load Admin post data.', 'error');
    } finally {
      setLoadingPosts(false);
    }
  }, [showToast]);

  const fetchClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const data = await clientService.getClients({ all: 'true' });
      setClients(data?.clients || []);
    } catch {
      showToast('Unable to load client list.', 'error');
    } finally {
      setLoadingClients(false);
    }
  }, [showToast]);

  const handlePermanentDeleteClient = async () => {
    if (!clientToDelete) return;
    setDeletingClient(true);
    try {
      await clientService.deleteClient(clientToDelete.id);
      showToast(`Client "${clientToDelete.name}" permanently deleted.`, 'success');
      const deletedId = clientToDelete.id;
      setClientToDelete(null);
      if (selectedClient?.client?.id === deletedId) {
        handleBackToClients();
      }
      fetchClients();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to permanently delete client.', 'error');
    } finally {
      setDeletingClient(false);
    }
  };

  const fetchSystemHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const data = await adminService.getSystemHealth();
      setSystemHealth(data);
      if (data?.summary?.critical_count > 0) {
        setShowHealthPanel(true);
      }
    } catch (err) {
      console.warn('Failed to load system health:', err);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  const filteredClients = useMemo(() => {
    if (clientStatusFilter === 'active') {
      return clients.filter((c) => Boolean(c.is_active));
    }
    if (clientStatusFilter === 'inactive') {
      return clients.filter((c) => !c.is_active);
    }
    return clients;
  }, [clients, clientStatusFilter]);

  const activeClientsCount = useMemo(() => clients.filter((c) => Boolean(c.is_active)).length, [clients]);
  const inactiveClientsCount = useMemo(() => clients.filter((c) => !c.is_active).length, [clients]);

  // Initial load
  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      if (!isMounted) return;
      await Promise.allSettled([
        fetchAdminPosts(),
        fetchClients(),
        fetchSystemHealth(),
      ]);
    };
    init();
    return () => {
      isMounted = false;
    };
  }, [fetchAdminPosts, fetchClients, fetchSystemHealth]);

  // Sync client details selection with URL search param (?client=ID)
  useEffect(() => {
    const clientParam = searchParams.get('client');
    const timer = setTimeout(() => {
      if (clientParam) {
        handleSelectClient(parseInt(clientParam, 10), false);
      } else {
        setSelectedClient(null);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams, handleSelectClient]);

  // Handle OAuth callback redirect notifications (?connected=facebook or ?error=...)
  useEffect(() => {
    const connected = searchParams.get('connected');
    const errorParam = searchParams.get('error');
    const warningParam = searchParams.get('warning');

    if (connected) {
      // If this window was opened as a target blank popup/tab by window.open
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(
            {
              type: 'OAUTH_SUCCESS',
              platform: connected,
              warning: warningParam ? decodeURIComponent(warningParam) : null,
              clientId: searchParams.get('client'),
            },
            '*'
          );
          window.close();
          return;
        } catch (e) {
          console.warn('Could not postMessage to opener:', e);
        }
      }

      const platformTitle = connected.charAt(0).toUpperCase() + connected.slice(1);
      showToast(`${platformTitle} successfully connected via OAuth!`, 'success');
      if (warningParam) {
        showToast(decodeURIComponent(warningParam), 'warning');
      }
      const clientParam = searchParams.get('client');
      if (clientParam) {
        fetchClientSocialPlatforms(parseInt(clientParam, 10));
      }
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('connected');
      newParams.delete('success');
      newParams.delete('warning');
      setSearchParams(newParams, { replace: true });
    } else if (errorParam) {
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(
            {
              type: 'OAUTH_ERROR',
              error: decodeURIComponent(errorParam),
              clientId: searchParams.get('client'),
            },
            '*'
          );
          window.close();
          return;
        } catch (e) {
          console.warn('Could not postMessage to opener:', e);
        }
      }

      showToast(`OAuth Connection Failed: ${decodeURIComponent(errorParam)}`, 'error');
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('error');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams, showToast, fetchClientSocialPlatforms]);

  // Listen for OAuth completion messages from target="_blank" window
  useEffect(() => {
    const handleOAuthMessage = (event) => {
      if (event.data?.type === 'OAUTH_SUCCESS') {
        const { platform, warning, clientId } = event.data;
        const platformTitle = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Account';
        showToast(`${platformTitle} successfully connected via OAuth!`, 'success');
        if (warning) {
          showToast(warning, 'warning');
        }
        if (clientId) {
          fetchClientSocialPlatforms(parseInt(clientId, 10));
        } else if (selectedClient?.client?.id) {
          fetchClientSocialPlatforms(selectedClient.client.id);
        }
      } else if (event.data?.type === 'OAUTH_ERROR') {
        showToast(`OAuth Connection Failed: ${event.data.error || 'Unknown error'}`, 'error');
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [showToast, fetchClientSocialPlatforms, selectedClient?.client?.id]);

  // Auto-refresh social accounts when window re-focuses (e.g. after returning from another tab)
  useEffect(() => {
    const handleWindowFocus = () => {
      if (selectedClient?.client?.id) {
        fetchClientSocialPlatforms(selectedClient.client.id);
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [selectedClient?.client?.id, fetchClientSocialPlatforms]);

  const handleBackToClients = () => {
    setSelectedClient(null);
    setSearchParams({ tab: 'clients' });
  };

  const handleOAuthConnect = async (platform) => {
    if (!selectedClient?.client?.id) return;
    const clientId = selectedClient.client.id;

    // Open target blank immediately on user click to prevent popup blockers
    const newTab = window.open('about:blank', '_blank');

    setActionLoading((prev) => ({ ...prev, [`oauth-${platform}`]: true }));
    try {
      const res = await clientService.getOAuthUrl(clientId, platform);
      if (!res.success) {
        if (newTab) newTab.close();
        if (res.code === 'OAUTH_KEY_NOT_FOUND' || res.error?.code === 'OAUTH_KEY_NOT_FOUND') {
          showToast(`OAuth Key Nahi Mili (${platform}) - Manual wala use karo`, 'warning');
          setManualFormPlatform(platform);
          return;
        }
        showToast(res.user_message || res.message || `Failed to initiate ${platform} connect.`, 'error');
        return;
      }
      const targetUrl = res.authUrl || res.auth_url;
      if (targetUrl) {
        if (newTab) {
          newTab.location.href = targetUrl;
        } else {
          window.open(targetUrl, '_blank');
        }
      } else {
        if (newTab) newTab.close();
        showToast(res.user_message || res.message || `No authorization URL received for ${platform}.`, 'error');
      }
    } catch (err) {
      if (newTab) newTab.close();
      showToast(err.response?.data?.message || `OAuth error for ${platform}.`, 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`oauth-${platform}`]: false }));
    }
  };

  const handleToggleManualForm = (platform) => {
    setManualFormPlatform((prev) => (prev === platform ? null : platform));
  };

  const handleManualFormChange = (platform, field, value) => {
    setManualFormData((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        [field]: value,
      },
    }));
  };

  const handleManualConnectSubmit = async (e, platform) => {
    e.preventDefault();
    if (!selectedClient?.client?.id) return;
    const clientId = selectedClient.client.id;
    const payload = manualFormData[platform] || {};

    if (!payload.access_token?.trim()) {
      showToast(`Access token is required for ${platform}.`, 'warning');
      return;
    }
    if (platform === 'youtube' && !payload.refresh_token?.trim()) {
      showToast('YouTube ke liye Refresh Token chahiye, sirf Access Token 1 ghante me khatam ho jayega.', 'error');
      return;
    }

    setActionLoading((prev) => ({ ...prev, [`manual-${platform}`]: true }));
    try {
      const res = await clientService.manualConnectSocial(clientId, platform, payload);
      if (res.success && res.is_connected) {
        showToast(`${platform.toUpperCase()} connected successfully!`, 'success');
        setManualFormPlatform(null);
        fetchClientSocialPlatforms(clientId);
      } else {
        showToast(res.user_message || res.message || 'Token verification failed. Please verify and try again.', 'error');
        fetchClientSocialPlatforms(clientId);
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Manual connect failed.', 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`manual-${platform}`]: false }));
    }
  };

  const handleTestPlatform = async (platform) => {
    if (!selectedClient?.client?.id) return;
    const clientId = selectedClient.client.id;
    setActionLoading((prev) => ({ ...prev, [`test-${platform}`]: true }));
    try {
      const res = await clientService.testSocialPlatform(clientId, platform);
      if (res.success && res.valid) {
        const nameStr = res.accountName ? ` [${res.accountName}]` : '';
        showToast(`Test passed: ${platform.toUpperCase()}${nameStr} connection is healthy!`, 'success');
        setCardBanners((prev) => ({ ...prev, [platform]: null }));
      } else {
        const errMsg = res.user_message || res.error || 'API Verification Failed';
        showToast(`Test failed: ${errMsg}`, 'error');
        setCardBanners((prev) => ({
          ...prev,
          [platform]: { type: 'error', message: errMsg },
        }));
      }
      fetchClientSocialPlatforms(clientId);
    } catch (err) {
      showToast(err.response?.data?.message || 'Connection test failed.', 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`test-${platform}`]: false }));
    }
  };

  const handleDisconnectPlatform = async (platform) => {
    if (!selectedClient?.client?.id) return;
    if (!window.confirm(`Disconnect ${platform.toUpperCase()}? Profile URL safe rahega, sirf token delete hoga.`)) {
      return;
    }
    const clientId = selectedClient.client.id;
    setActionLoading((prev) => ({ ...prev, [`disc-${platform}`]: true }));
    try {
      const res = await clientService.disconnectSocialPlatform(clientId, platform);
      if (res.success) {
        showToast(`${platform.toUpperCase()} disconnected. Profile URL preserved.`, 'info');
        setCardBanners((prev) => ({ ...prev, [platform]: null }));
        fetchClientSocialPlatforms(clientId);
      } else {
        showToast(res.message || 'Disconnect failed.', 'error');
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Disconnect failed.', 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`disc-${platform}`]: false }));
    }
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    if (!newClientName.trim()) {
      showToast('Client name cannot be empty.', 'warning');
      return;
    }
    if (!newPrimaryPhone.trim()) {
      showToast('Primary official phone number is required.', 'warning');
      return;
    }

    setCreatingClient(true);
    try {
      const data = await clientService.createClient({
        name: newClientName.trim(),
        primary_phone: newPrimaryPhone.trim(),
        alternate_phone: newAlternatePhone.trim(),
        address: newAddress.trim(),
        gmb_url: newGmbUrl.trim() || null,
      });
      showToast(`Client "${newClientName}" registered successfully!`, 'success');
      setShowAddClientModal(false);
      setNewClientName('');
      setNewPrimaryPhone('');
      setNewAlternatePhone('');
      setNewAddress('');
      setNewGmbUrl('');
      fetchClients();
      if (data?.client?.id) {
        handleSelectClient(data.client.id);
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to register client.';
      showToast(msg, 'error');
    } finally {
      setCreatingClient(false);
    }
  };

  const handleSaveClientIdentity = async (e) => {
    e.preventDefault();
    if (!selectedClient?.client?.id) return;

    if (!identityName.trim()) {
      showToast('Brand name cannot be empty.', 'warning');
      return;
    }
    if (!identityPrimaryPhone.trim()) {
      showToast('Primary phone number is required.', 'warning');
      return;
    }

    setSavingIdentity(true);
    try {
      await clientService.updateClient(selectedClient.client.id, {
        name: identityName.trim(),
        primary_phone: identityPrimaryPhone.trim(),
        alternate_phone: identityAlternatePhone.trim(),
        address: identityAddress.trim(),
        gmb_url: identityGmbUrl.trim() || null,
      });
      showToast('Client official identity saved.', 'success');
      handleSelectClient(selectedClient.client.id, false);
      fetchClients();
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to save identity.';
      showToast(msg, 'error');
    } finally {
      setSavingIdentity(false);
    }
  };

  const handleSyncGmb = async () => {
    if (!selectedClient?.client?.id) return;
    setSyncingGmb(true);
    setGmbKeyError(null);
    try {
      const res = await clientService.syncGmb(selectedClient.client.id);
      if (res?.skipped && res?.keyError) {
        setGmbKeyError(res.keyError);
        showToast(res.keyError.user_message || 'GMB API Key Not Found. Manual mode active.', 'warning');
      } else if (res?.keyError) {
        setGmbKeyError(res.keyError);
        showToast(res.keyError.user_message || 'GMB Sync failed. Check API Key.', 'error');
      } else if (res?.success) {
        showToast('Google Places data synced successfully!', 'success');
      } else {
        showToast(res?.message || 'Sync completed with notices.', 'info');
      }
      handleSelectClient(selectedClient.client.id, false);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to sync GMB profile.', 'error');
    } finally {
      setSyncingGmb(false);
    }
  };

  // Interactive Tag Handlers for Brand Guidelines
  const handleAddWhitelistTag = (text) => {
    const raw = text || whitelistInputText;
    if (!raw.trim()) return;
    const items = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    setWhitelistTags((prev) => Array.from(new Set([...prev, ...items])));
    setWhitelistInputText('');
  };

  const handleRemoveWhitelistTag = (tagToRemove) => {
    setWhitelistTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  const handleAddBannedTag = (text) => {
    const raw = text || bannedInputText;
    if (!raw.trim()) return;
    const items = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    setBannedTags((prev) => Array.from(new Set([...prev, ...items])));
    setBannedInputText('');
  };

  const handleRemoveBannedTag = (tagToRemove) => {
    setBannedTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  const handleSaveBrandGuidelines = async (e) => {
    e.preventDefault();
    if (!selectedClient?.client?.id) return;

    setSavingGuidelines(true);
    try {
      await clientService.updateBrandGuidelines(selectedClient.client.id, {
        whitelist_words: whitelistTags,
        banned_words: bannedTags,
        mandatory_phrases: mandatoryInput
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean),
      });
      showToast('Brand guidelines and AI linguistic rules saved.', 'success');
      handleSelectClient(selectedClient.client.id, false);
    } catch {
      showToast('Unable to save brand guidelines.', 'error');
    } finally {
      setSavingGuidelines(false);
    }
  };

  const handleLogoFileChange = async (file) => {
    if (!file) return;
    if (!selectedClient?.client?.id) return;
    const clientId = selectedClient.client.id;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      showToast('Kewal PNG ya JPG image upload karein.', 'warning');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showToast('Logo file size 2MB se kam honi chahiye.', 'warning');
      return;
    }

    setUploadingLogo(true);
    try {
      const res = await clientService.uploadLogo(clientId, file);
      if (res.success) {
        setReferenceLogoUrl(res.reference_logo_url);
        showToast('Official brand logo successfully upload ho gaya!', 'success');
        setSelectedClient((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            brand_guidelines: {
              ...(prev.brand_guidelines || {}),
              reference_logo_url: res.reference_logo_url,
            },
            client: {
              ...(prev.client || {}),
              reference_logo_url: res.reference_logo_url,
            },
          };
        });
      } else {
        showToast(res.message || 'Logo upload failed.', 'error');
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Logo upload error.', 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!selectedClient?.client?.id) return;
    const clientId = selectedClient.client.id;

    if (!window.confirm('Kya aap sach me official brand logo hatana chahte hain?')) return;

    setUploadingLogo(true);
    try {
      const res = await clientService.deleteLogo(clientId);
      if (res.success) {
        setReferenceLogoUrl('');
        showToast('Official brand logo hata diya gaya.', 'success');
        setSelectedClient((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            brand_guidelines: {
              ...(prev.brand_guidelines || {}),
              reference_logo_url: null,
            },
            client: {
              ...(prev.client || {}),
              reference_logo_url: null,
            },
          };
        });
      } else {
        showToast(res.message || 'Logo remove failed.', 'error');
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Logo remove error.', 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleToggleClientActive = async (client) => {
    try {
      const nextActive = !client.is_active;
      await clientService.updateClient(client.id, { is_active: nextActive });
      showToast(
        `Client "${client.name}" ${nextActive ? 'activated' : 'deactivated'}.`,
        'success'
      );
      fetchClients();
      if (selectedClient?.client?.id === client.id) {
        handleSelectClient(client.id, false);
      }
    } catch {
      showToast('Unable to update client status.', 'error');
    }
  };

  const handleAdminAction = async (postId, action) => {
    setActiveActionId(`${action}-${postId}`);
    try {
      const comment = (adminComments[postId] || '').trim();
      await postService.adminReview(postId, { action, comment });

      if (action === 'approve') {
        showToast(`Post #${postId} received final Admin approval. Platform selection is now available.`, 'success');
      } else if (action === 'reject') {
        showToast(`Post #${postId} was rejected and permanently closed.`, 'warning');
      } else {
        showToast(`The change request for post #${postId} was sent back to the SMO.`, 'success');
      }

      fetchAdminPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to process the Admin action.';
      showToast(msg, 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  const handleDeletePost = async (postId) => {
    if (!window.confirm(`Permanently delete Post #${postId}? This will remove its image and review records.`)) return;
    setActiveActionId(`delete-${postId}`);
    try {
      await postService.deletePost(postId);
      showToast(`Post #${postId} deleted successfully.`, 'success');
      setAllPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete post.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  const pendingAdminPosts = allPosts.filter((p) => p.status === 'pending_admin');

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#2B2A27] pb-24">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header with Navigation Pills */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[#2B2A27]">
                Admin Control &amp; Approval Hub
              </h1>
            </div>
            <p className="text-sm text-[#6B6A63] mt-1">
              Multi-Client Governance, Brand Guidelines, Connected Social Accounts, &amp; Final Post Approvals.
            </p>
          </div>

          {/* Navigation Pill Buttons */}
          <div className="flex items-center gap-2 bg-stone-100 p-1 rounded-xl border border-[#E5E2DA]">
            <button
              onClick={() => {
                setSelectedClient(null);
                setSearchParams({});
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'pipeline'
                  ? 'bg-white text-[#2B2A27] shadow-xs'
                  : 'text-[#6B6A63] hover:text-[#2B2A27]'
              }`}
            >
              Approval Pipeline ({pendingAdminPosts.length})
            </button>
            <button
              onClick={() => {
                setSelectedClient(null);
                setSearchParams({ tab: 'clients' });
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'clients'
                  ? 'bg-white text-[#2B2A27] shadow-xs'
                  : 'text-[#6B6A63] hover:text-[#2B2A27]'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Clients &amp; Guidelines ({clients.length})</span>
            </button>
          </div>
        </div>

        {/* SYSTEM & API HEALTH MONITOR ALERT BANNER */}
        <div className="mb-8">
          <div
            className={`p-4 sm:p-5 rounded-3xl border transition-all ${
              systemHealth?.summary?.critical_count > 0
                ? 'bg-rose-50/90 border-rose-300 text-rose-950 shadow-xs'
                : systemHealth?.summary?.warning_count > 0
                ? 'bg-amber-50/90 border-amber-300 text-amber-950 shadow-xs'
                : 'bg-emerald-50/80 border-emerald-200 text-emerald-950 shadow-xs'
            }`}
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                    systemHealth?.summary?.critical_count > 0
                      ? 'bg-rose-100 text-rose-700 border-rose-300'
                      : systemHealth?.summary?.warning_count > 0
                      ? 'bg-amber-100 text-amber-700 border-amber-300'
                      : 'bg-emerald-100 text-emerald-700 border-emerald-300'
                  }`}
                >
                  {systemHealth?.summary?.critical_count > 0 ? (
                    <AlertOctagon className="w-5 h-5" />
                  ) : systemHealth?.summary?.warning_count > 0 ? (
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold tracking-tight">
                      {systemHealth?.summary?.critical_count > 0
                        ? `🚨 Action Required: ${systemHealth.summary.critical_count} Service/Token Alert`
                        : systemHealth?.summary?.warning_count > 0
                        ? `⚠️ System Notice: ${systemHealth.summary.warning_count} Configurations in Notice / Fallback Mode`
                        : '🟢 All Systems, External APIs & Social Tokens Operational'}
                    </h3>
                    {systemHealth?.summary?.critical_count > 0 && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-200 text-rose-900 font-mono">
                        CRITICAL
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-600 mt-0.5 leading-relaxed">
                    {systemHealth?.summary?.critical_count > 0
                      ? 'Backend .env API key expire/missing hai ya client social account disconnected hai.'
                      : systemHealth?.summary?.warning_count > 0
                      ? 'Meta, LinkedIn, ya Gemini keys DUMMY / notice mode me hain.'
                      : 'Google Gemini, PaddleOCR, OAuth Apps aur Encryption keys 100% active hain.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchSystemHealth}
                  loading={loadingHealth}
                  leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />}
                  className="!rounded-xl text-xs font-semibold !bg-white !border-stone-300 shadow-2xs"
                >
                  Re-test APIs
                </Button>

                <button
                  type="button"
                  onClick={() => setShowHealthPanel(!showHealthPanel)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white/90 hover:bg-white border border-stone-300 text-stone-700 flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                >
                  <span>{showHealthPanel ? 'Hide Details' : 'View Breakdown'}</span>
                  {showHealthPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* EXPANDABLE DETAILED BREAKDOWN DRAWER */}
            {showHealthPanel && systemHealth && (
              <div className="mt-4 pt-4 border-t border-stone-200/90 space-y-4 animate-in fade-in-50 duration-150">
                {/* 1. Client Social Account Token Expiry Alerts (if any) */}
                {(systemHealth.client_tokens?.expired?.length > 0 ||
                  systemHealth.client_tokens?.expiring_soon?.length > 0 ||
                  systemHealth.client_tokens?.connection_errors?.length > 0) && (
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-rose-900 block flex items-center gap-1.5">
                      <AlertOctagon className="w-3.5 h-3.5 text-rose-600" />
                      Client Social Account Token Expiry &amp; Connection Alerts
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {systemHealth.client_tokens.expired.map((item, idx) => (
                        <div key={`exp-${idx}`} className="p-3 bg-white rounded-xl border border-rose-300 shadow-2xs text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-rose-900">{item.client_name}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-100 text-rose-800">
                              {item.platform} EXPIRED
                            </span>
                          </div>
                          <p className="text-stone-700">{item.message}</p>
                        </div>
                      ))}
                      {systemHealth.client_tokens.expiring_soon.map((item, idx) => (
                        <div key={`soon-${idx}`} className="p-3 bg-white rounded-xl border border-amber-300 shadow-2xs text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-amber-900">{item.client_name}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800">
                              {item.platform} EXPIRING SOON
                            </span>
                          </div>
                          <p className="text-stone-700">{item.message}</p>
                        </div>
                      ))}
                      {systemHealth.client_tokens.connection_errors.map((item, idx) => (
                        <div key={`err-${idx}`} className="p-3 bg-white rounded-xl border border-orange-300 shadow-2xs text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-orange-900">{item.client_name}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-orange-100 text-orange-800">
                              {item.platform} ERROR
                            </span>
                          </div>
                          <p className="text-stone-700">{item.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. Backend .env Services Grid */}
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-stone-700 block mb-2 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-stone-600" />
                    Backend .env API Keys &amp; Service Status
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {systemHealth.services?.map((svc) => {
                      const badgeStyle = {
                        ok: 'bg-emerald-100 text-emerald-800 border-emerald-300',
                        warning: 'bg-amber-100 text-amber-800 border-amber-300',
                        critical: 'bg-rose-100 text-rose-800 border-rose-300',
                        info: 'bg-sky-100 text-sky-800 border-sky-300',
                      }[svc.severity] || 'bg-stone-100 text-stone-800 border-stone-200';

                      return (
                        <div
                          key={svc.id}
                          className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-2xs flex flex-col justify-between space-y-2"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-xs font-bold text-[#2B2A27]">{svc.label}</h4>
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase border shrink-0 ${badgeStyle}`}>
                                {svc.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-stone-600 mt-1 leading-relaxed">
                              {svc.message}
                            </p>
                            {svc.impact && (
                              <p className="text-[10px] text-stone-500 mt-1 italic">
                                ℹ️ {svc.impact}
                              </p>
                            )}
                          </div>

                          {svc.action && (
                            <div className="pt-2 border-t border-stone-100 text-[10px] text-amber-800 font-medium leading-snug">
                              💡 <strong>Action:</strong> {svc.action}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* TAB 1: APPROVAL PIPELINE */}
        {activeTab === 'pipeline' && (
          <div>
            {/* System Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#E5E2DA] shadow-xs">
                <span className="text-xs text-[#6B6A63] font-medium">Total Posts Created</span>
                <h3 className="text-xl font-bold text-[#2B2A27] mt-1">{allPosts.length}</h3>
              </div>
              <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#E5E2DA] shadow-xs">
                <span className="text-xs text-amber-800 font-medium">Pending Manager Review</span>
                <h3 className="text-xl font-bold text-[#2B2A27] mt-1">
                  {allPosts.filter((p) => p.status === 'pending_manager').length}
                </h3>
              </div>
              <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#E5E2DA] shadow-xs">
                <span className="text-xs text-purple-800 font-medium">Pending Admin Sign-off</span>
                <h3 className="text-xl font-bold text-[#2B2A27] mt-1">{pendingAdminPosts.length}</h3>
              </div>
              <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#E5E2DA] shadow-xs">
                <span className="text-xs text-emerald-800 font-medium">Approved / Scheduled / Live</span>
                <h3 className="text-xl font-bold text-[#2B2A27] mt-1">
                  {
                    allPosts.filter((p) =>
                      ['admin_approved', 'ready_to_publish', 'scheduled', 'posted', 'completed'].includes(p.status)
                    ).length
                  }
                </h3>
              </div>
            </div>

            {/* Post Approvals Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[#2B2A27]">Awaiting Admin Sign-off</h2>
                  <p className="text-xs text-[#6B6A63]">
                    Posts that have been verified by the Manager and are awaiting your final decision.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchAdminPosts}
                  loading={loadingPosts}
                  leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loadingPosts ? 'animate-spin' : ''}`} />}
                >
                  Refresh
                </Button>
              </div>

              {loadingPosts ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {[1, 2].map((n) => (
                    <div
                      key={n}
                      className="bg-stone-100 rounded-3xl p-6 border border-[#E5E2DA] animate-pulse space-y-4"
                    >
                      <div className="h-4 bg-stone-200 rounded w-28"></div>
                      <div className="h-40 bg-stone-200 rounded-2xl"></div>
                      <div className="h-4 bg-stone-200 rounded w-3/4"></div>
                    </div>
                  ))}
                </div>
              ) : pendingAdminPosts.length === 0 ? (
                <div className="bg-[#FFFFFF] rounded-2xl p-10 border border-[#E5E2DA] text-center max-w-lg mx-auto shadow-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-[#2B2A27]">
                    No posts are currently pending Admin sign-off
                  </p>
                  <p className="text-xs text-[#6B6A63] mt-1">
                    Posts approved by the Manager will appear here for final review.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {pendingAdminPosts.map((post) => {
                    const rawImg = post.image_path || post.latest_revision?.image_path;
                    const imgSrc = rawImg ? `${SERVER_URL}/${rawImg}` : null;
                    const isActionActive = activeActionId !== null;

                    return (
                      <div
                        key={post.id}
                        className="bg-[#FFFFFF] rounded-3xl border border-[#E5E2DA] overflow-hidden shadow-xs flex flex-col justify-between"
                      >
                        <div>
                          {/* Card Header with Client and Title */}
                          <div className="p-4 border-b border-[#E5E2DA] space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-[#2B2A27] bg-stone-100 border border-[#E5E2DA] px-2.5 py-0.5 rounded-md font-mono">
                                #{post.id}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-[#6B6A63] flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-[#A8A29E]" />
                                  {formatDate(post.created_at)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePost(post.id)}
                                  disabled={activeActionId !== null}
                                  title={`Delete Post #${post.id}`}
                                  className="p-1 rounded-lg hover:bg-rose-50 text-stone-400 hover:text-rose-600 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg flex items-center gap-1">
                                <Building2 className="w-3 h-3" />
                                {post.client_name || 'Client'}
                              </span>
                              <h3 className="text-sm font-bold text-[#2B2A27] line-clamp-1">
                                {post.title || 'Untitled Campaign'}
                              </h3>
                            </div>
                          </div>

                          {/* Image */}
                          {imgSrc && (
                            <div className="bg-stone-50 border-b border-[#E5E2DA] max-h-56 overflow-hidden flex items-center justify-center p-1">
                              <img
                                src={imgSrc}
                                alt="Post visual"
                                className="w-full h-full max-h-56 object-contain rounded-xl"
                              />
                            </div>
                          )}

                          {/* Content */}
                          <div className="p-5 space-y-4">
                            <div>
                              <span className="text-[11px] text-[#6B6A63] uppercase tracking-wider font-semibold block mb-1">
                                Post Caption:
                              </span>
                              <p className="text-sm text-[#2B2A27] leading-relaxed whitespace-pre-wrap">
                                {post.caption || <span className="italic text-[#A8A29E]">No caption</span>}
                              </p>
                            </div>

                            {/* Manager Endorsement Note */}
                            <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-2xl flex items-start gap-2.5">
                              <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                              <div className="text-xs text-purple-950 space-y-0.5">
                                <p className="font-semibold text-purple-900">
                                  Manager Endorsement Complete
                                </p>
                                <p className="text-purple-800/80 leading-relaxed">
                                  The Manager verified spelling, Hindi/English rules, and brand voice. Final sign-off required to enable publishing.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Admin Action Bar */}
                        <div className="p-5 border-t border-[#E5E2DA] bg-[#FAF9F6] space-y-3">
                          <input
                            type="text"
                            placeholder="Optional Admin note or instructions..."
                            value={adminComments[post.id] || ''}
                            onChange={(e) =>
                              setAdminComments({
                                ...adminComments,
                                [post.id]: e.target.value,
                              })
                            }
                            className="w-full px-3.5 py-2 rounded-xl border border-[#E5E2DA] bg-[#FFFFFF] text-xs text-[#2B2A27] placeholder-[#A8A29E] focus:outline-none focus:border-emerald-600"
                          />

                          <div className="grid grid-cols-3 gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="!text-rose-700 hover:!bg-rose-50 !border-rose-200"
                              leftIcon={<XCircle className="w-3.5 h-3.5" />}
                              loading={activeActionId === `reject-${post.id}`}
                              disabled={isActionActive}
                              onClick={() => handleAdminAction(post.id, 'reject')}
                            >
                              Reject
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="!text-amber-800 hover:!bg-amber-50 !border-amber-200"
                              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                              loading={activeActionId === `changes_requested-${post.id}`}
                              disabled={isActionActive}
                              onClick={() => handleAdminAction(post.id, 'changes_requested')}
                            >
                              Revise
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                              loading={activeActionId === `approve-${post.id}`}
                              disabled={isActionActive}
                              onClick={() => handleAdminAction(post.id, 'approve')}
                            >
                              Approve
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: CLIENT GOVERNANCE & BRAND GUIDELINES */}
        {activeTab === 'clients' && (
          <div>
            {loadingClientDetail ? (
              <div className="p-12 text-center bg-white rounded-3xl border border-[#E5E2DA] shadow-xs">
                <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-2" />
                <p className="text-sm font-semibold text-[#2B2A27]">Loading client profile &amp; guidelines...</p>
              </div>
            ) : !selectedClient ? (
              /* Client Master List View */
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-[#2B2A27]">Managed Clients</h2>
                    <p className="text-xs text-[#6B6A63]">
                      Configure official brand guidelines, allowed terms, banned words, and linked social accounts.
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<PlusCircle className="w-4 h-4" />}
                    onClick={() => setShowAddClientModal(true)}
                  >
                    Add New Client
                  </Button>
                </div>

                {/* Filter Pills: All | Active | Deactivated */}
                <div className="flex items-center gap-2 border-b border-[#E5E2DA] pb-3">
                  <button
                    type="button"
                    onClick={() => setClientStatusFilter('all')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      clientStatusFilter === 'all'
                        ? 'bg-[#2B2A27] text-white shadow-xs'
                        : 'bg-white text-[#6B6A63] border border-[#E5E2DA] hover:bg-[#FAF9F6]'
                    }`}
                  >
                    <span>All Clients</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${clientStatusFilter === 'all' ? 'bg-white/20 text-white' : 'bg-stone-100 text-[#6B6A63]'}`}>
                      {clients.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setClientStatusFilter('active')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      clientStatusFilter === 'active'
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-50'
                    }`}
                  >
                    <span>Active</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${clientStatusFilter === 'active' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                      {activeClientsCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setClientStatusFilter('inactive')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      clientStatusFilter === 'inactive'
                        ? 'bg-stone-700 text-white shadow-xs'
                        : 'bg-white text-stone-600 border border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    <span>Deactivated</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${clientStatusFilter === 'inactive' ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'}`}>
                      {inactiveClientsCount}
                    </span>
                  </button>
                </div>

                <div className="bg-[#FFFFFF] rounded-3xl border border-[#E5E2DA] overflow-hidden shadow-xs">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#FAF9F6] border-b border-[#E5E2DA] text-[#6B6A63] text-xs uppercase tracking-wider font-mono">
                      <tr>
                        <th className="py-3.5 px-6">Client Name</th>
                        <th className="py-3.5 px-6">Status</th>
                        <th className="py-3.5 px-6">Official Phone</th>
                        <th className="py-3.5 px-6">Registered On</th>
                        <th className="py-3.5 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E2DA]">
                      {loadingClients ? (
                        <tr>
                          <td colSpan="5" className="py-8 text-center text-xs text-[#6B6A63]">
                            Loading clients...
                          </td>
                        </tr>
                      ) : filteredClients.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="py-8 text-center text-xs text-[#6B6A63]">
                            {clientStatusFilter === 'inactive'
                              ? 'No deactivated clients found.'
                              : clientStatusFilter === 'active'
                              ? 'No active clients found.'
                              : 'No clients registered. Click "Add New Client" to create one.'}
                          </td>
                        </tr>
                      ) : (
                        filteredClients.map((c) => (
                          <tr key={c.id} className="hover:bg-[#FAF9F6] transition-colors">
                            <td className="py-4 px-6 font-bold text-[#2B2A27]">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 text-xs">
                                  <Building2 className="w-3.5 h-3.5" />
                                </div>
                                <span
                                  className="cursor-pointer hover:text-emerald-700"
                                  onClick={() => handleSelectClient(c.id)}
                                >
                                  {c.name}
                                </span>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                  c.is_active
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : 'bg-stone-100 text-stone-600 border border-stone-200'
                                }`}
                              >
                                {c.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-xs text-[#6B6A63] font-mono">
                              {c.primary_phone || <span className="italic text-stone-400">None</span>}
                            </td>
                            <td className="py-4 px-6 text-xs text-[#6B6A63]">
                              {formatDate(c.created_at)}
                            </td>
                            <td className="py-4 px-6 text-right space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                leftIcon={<Settings2 className="w-3.5 h-3.5" />}
                                onClick={() => handleSelectClient(c.id)}
                              >
                                Manage Details
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className={c.is_active ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'}
                                onClick={() => handleToggleClientActive(c)}
                              >
                                {c.is_active ? 'Deactivate' : 'Activate'}
                              </Button>
                              {!c.is_active && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                                  onClick={() => setClientToDelete(c)}
                                >
                                  Delete
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* REDESIGNED CLIENT DETAILS VIEW WITH TABBED ARCHITECTURE */
              <div className="space-y-6">
                {/* Back button & Client Header */}
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-[#FFFFFF] p-6 rounded-3xl border border-[#E5E2DA] shadow-xs">
                  <div>
                    <button
                      onClick={handleBackToClients}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B6A63] hover:text-[#2B2A27] mb-2 cursor-pointer transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back to All Clients
                    </button>
                    <div className="flex items-center gap-3.5">
                      {/* Brand Logo in Client Heading */}
                      {referenceLogoUrl ? (
                        <div
                          onClick={() => logoInputRef.current?.click()}
                          className="w-16 h-16 rounded-2xl border border-[#D5D2CA] bg-stone-100 p-1.5 flex items-center justify-center shrink-0 shadow-2xs overflow-hidden relative group cursor-pointer bg-[radial-gradient(#cbd5e1_1.2px,transparent_1.2px)] [background-size:8px_8px]"
                          title="Click to Change Logo"
                        >
                          <img
                            src={
                              referenceLogoUrl.startsWith('http')
                                ? referenceLogoUrl
                                : `${SERVER_URL}${referenceLogoUrl.startsWith('/') ? '' : '/'}${referenceLogoUrl}?t=${Date.now()}`
                            }
                            alt={selectedClient.client?.name || 'Brand Logo'}
                            className="max-h-full max-w-full object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.dataset.fallback && !referenceLogoUrl.startsWith('http')) {
                                target.dataset.fallback = 'true';
                                target.src = `http://localhost:5001${referenceLogoUrl.startsWith('/') ? '' : '/'}${referenceLogoUrl}`;
                              }
                            }}
                          />
                          <div className="absolute inset-0 bg-stone-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                            <RotateCcw className="w-4 h-4 drop-shadow" />
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => logoInputRef.current?.click()}
                          className="w-16 h-16 rounded-2xl border-2 border-dashed border-[#D5D2CA] hover:border-emerald-500 bg-[#FAF9F6] hover:bg-emerald-50/40 flex flex-col items-center justify-center text-emerald-600 shrink-0 cursor-pointer transition-all shadow-2xs group"
                          title="Click to Upload Logo"
                        >
                          <UploadCloud className="w-5 h-5 group-hover:scale-110 transition-transform" />
                          <span className="text-[9px] font-bold text-emerald-700 mt-0.5">Upload</span>
                        </div>
                      )}

                      <div>
                        <h2 className="text-xl font-bold text-[#2B2A27] flex items-center gap-2">
                          <span>{selectedClient.client?.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-md font-mono bg-stone-100 text-[#6B6A63] border border-[#E5E2DA]">
                            ID #{selectedClient.client?.id}
                          </span>
                        </h2>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-xs text-[#6B6A63]">
                            Registered on {formatDate(selectedClient.client?.created_at)}
                          </span>
                          {referenceLogoUrl ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Logo Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              <AlertTriangle className="w-3 h-3 text-amber-600" /> No Logo
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Actions: Logo Upload / Change / Remove & Client Active Status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="file"
                      ref={logoInputRef}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleLogoFileChange(e.target.files[0]);
                        }
                        e.target.value = '';
                      }}
                      accept="image/png,image/jpeg,image/jpg"
                      className="hidden"
                    />

                    {/* Logo Buttons */}
                    {referenceLogoUrl ? (
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          loading={uploadingLogo}
                          onClick={() => logoInputRef.current?.click()}
                          leftIcon={<RotateCcw className="w-3 h-3" />}
                          className="!rounded-xl text-xs font-semibold !py-1.5"
                        >
                          Change Logo
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          loading={uploadingLogo}
                          onClick={handleRemoveLogo}
                          leftIcon={<Trash2 className="w-3 h-3" />}
                          className="!rounded-xl text-xs font-semibold !py-1.5"
                        >
                          Remove Logo
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={uploadingLogo}
                        onClick={() => logoInputRef.current?.click()}
                        leftIcon={<UploadCloud className="w-3.5 h-3.5" />}
                        className="!rounded-xl text-xs font-semibold !py-1.5 !bg-emerald-600 hover:!bg-emerald-700"
                      >
                        Upload Logo
                      </Button>
                    )}

                    <div className="h-6 w-[1px] bg-[#E5E2DA] hidden lg:block mx-1" />

                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        selectedClient.client?.is_active
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-stone-100 text-stone-600 border border-stone-200'
                      }`}
                    >
                      {selectedClient.client?.is_active ? 'Active Client' : 'Inactive Client'}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className={selectedClient.client?.is_active ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'}
                      onClick={() => handleToggleClientActive(selectedClient.client)}
                    >
                      {selectedClient.client?.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                    {!selectedClient.client?.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                        onClick={() => setClientToDelete(selectedClient.client)}
                      >
                        Delete Permanently
                      </Button>
                    )}
                  </div>
                </div>

                {/* Sub-Tabs: [1. Identity & Brand Guidelines] vs [2. Connected Accounts] */}
                <div className="flex items-center gap-3 border-b border-[#E5E2DA] pb-3">
                  <button
                    type="button"
                    onClick={() => setClientSubTab('identity_guidelines')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                      clientSubTab === 'identity_guidelines'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white text-[#6B6A63] hover:text-[#2B2A27] border border-[#E5E2DA]'
                    }`}
                  >
                    <Building2 className="w-4 h-4" />
                    <span>Official Identity &amp; Brand Guidelines</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setClientSubTab('social_accounts')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                      clientSubTab === 'social_accounts'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white text-[#6B6A63] hover:text-[#2B2A27] border border-[#E5E2DA]'
                    }`}
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Connected Social Accounts ({socialPlatforms.filter((p) => p.is_connected).length}/4)</span>
                  </button>
                </div>

                {/* SUB-TAB 1: IDENTITY & GUIDELINES (SIDE BY SIDE 2-COLUMN LAYOUT) */}
                {clientSubTab === 'identity_guidelines' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start animate-in fade-in-50 duration-150">
                    {/* LEFT COLUMN: OFFICIAL CLIENT IDENTITY & GMB */}
                    <div className="bg-[#FFFFFF] p-6 rounded-3xl border border-[#E5E2DA] shadow-xs space-y-5">
                      <div className="flex items-center gap-2.5 pb-3 border-b border-[#E5E2DA]">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-[#2B2A27]">Official Client Identity</h3>
                          <p className="text-xs text-[#6B6A63]">
                            Ground-truth identity used by AI to verify brand names, phone numbers, and addresses.
                          </p>
                        </div>
                      </div>

                      <form onSubmit={handleSaveClientIdentity} className="space-y-4">
                        {/* GMB Profile Link & Sync Card */}
                        <div className="p-4 bg-sky-50/60 rounded-2xl border border-sky-200/70 space-y-3">
                          <div>
                            <label className="block text-xs font-semibold text-sky-950 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                              <Globe className="w-4 h-4 text-sky-600" />
                              <span>GMB Profile Link (Optional)</span>
                            </label>
                            <input
                              type="url"
                              value={identityGmbUrl}
                              onChange={(e) => setIdentityGmbUrl(e.target.value)}
                              placeholder="e.g. https://maps.app.goo.gl/... or https://google.com/maps/place/..."
                              className="w-full px-3.5 py-2.5 rounded-xl border border-sky-200 bg-white text-xs text-[#2B2A27] focus:outline-none focus:border-sky-600 font-mono shadow-2xs"
                            />
                            <p className="text-[11px] text-sky-800/80 mt-1 leading-relaxed">
                              GMB link dalne par har hafte 1 baar Google se official naam, address, phone auto-sync hoga. Tumhara manual likha hua kuch bhi overwrite nahi hoga.
                            </p>
                          </div>

                          {/* Sync Status Row */}
                          <div className="pt-2 border-t border-sky-200/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs">
                            <div className="text-sky-900 leading-snug">
                              <div className="font-medium">
                                <span className="text-sky-700">Last Synced: </span>
                                {selectedClient.client?.gmb_last_synced_at
                                  ? new Date(selectedClient.client.gmb_last_synced_at).toLocaleString()
                                  : 'Not synced yet'}
                              </div>
                              {selectedClient.client?.gmb_snapshot?.officialName && (
                                <div className="text-[11px] text-sky-800 mt-0.5">
                                  Google Verified: <span className="font-semibold">{selectedClient.client.gmb_snapshot.officialName}</span>
                                </div>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              loading={syncingGmb}
                              onClick={handleSyncGmb}
                              className="!rounded-xl !bg-white hover:!bg-sky-100/70 !text-sky-700 !border-sky-300 text-xs shadow-none shrink-0 font-semibold"
                            >
                              Sync from Google
                            </Button>
                          </div>

                          {/* Free Mode Notice */}
                          {(!selectedClient.client?.gmb_last_synced_at || gmbKeyError?.code === 'GMB_KEY_NOT_FOUND') && (
                            <div className="p-2.5 bg-amber-50 border border-amber-200/80 rounded-xl flex items-center gap-2 text-xs text-amber-900 font-medium">
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                              <span>GMB Auto-Sync OFF — API Key Not Found. Manual data se kaam chal raha hai. (Free Mode)</span>
                            </div>
                          )}

                          {gmbKeyError?.code === 'GMB_KEY_INVALID' && (
                            <div className="p-2.5 bg-rose-50 border border-rose-200/80 rounded-xl flex items-center gap-2 text-xs text-rose-900 font-medium">
                              <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
                              <span>GMB API Key Invalid — Check key in .env or billing status. Manual data active.</span>
                            </div>
                          )}
                        </div>

                        {/* Brand Name Input */}
                        <div>
                          <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                            Official Organization / Brand Name <span className="text-emerald-600 font-bold">*</span>
                          </label>
                          <input
                            type="text"
                            value={identityName}
                            onChange={(e) => setIdentityName(e.target.value)}
                            placeholder="e.g. Apex Health Clinic"
                            required
                            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white"
                          />
                        </div>

                        {/* Phones Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                              <Phone className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Primary Phone (Required) <span className="text-emerald-600 font-bold">*</span></span>
                            </label>
                            <input
                              type="text"
                              value={identityPrimaryPhone}
                              onChange={(e) => setIdentityPrimaryPhone(e.target.value)}
                              placeholder="e.g. 9876543210"
                              required
                              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                              <Phone className="w-3.5 h-3.5 text-[#6B6A63]" />
                              <span>Alternate Phone (Optional)</span>
                            </label>
                            <input
                              type="text"
                              value={identityAlternatePhone}
                              onChange={(e) => setIdentityAlternatePhone(e.target.value)}
                              placeholder="e.g. 9123456780"
                              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                            />
                          </div>
                        </div>

                        {/* Address Textarea */}
                        <div>
                          <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Registered Official Address</span>
                          </label>
                          <textarea
                            rows={3}
                            value={identityAddress}
                            onChange={(e) => setIdentityAddress(e.target.value)}
                            placeholder="e.g. 1063, near Jan Jyoti Hospital, Gole Bazar, Wright Town, Jabalpur, Madhya Pradesh"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white resize-y"
                          />
                        </div>

                        <Button
                          type="submit"
                          variant="primary"
                          size="md"
                          loading={savingIdentity}
                          className="w-full !rounded-xl font-semibold"
                        >
                          Save Client Identity
                        </Button>
                      </form>
                    </div>

                    {/* RIGHT COLUMN: CLIENT BRAND GUIDELINES (INTERACTIVE TAG CHIPS) */}
                    <div className="bg-[#FFFFFF] p-6 rounded-3xl border border-[#E5E2DA] shadow-xs space-y-5">
                      <div className="flex items-center gap-2.5 pb-3 border-b border-[#E5E2DA]">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                          <Tag className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-[#2B2A27]">Client Brand Guidelines</h3>
                          <p className="text-xs text-[#6B6A63]">
                            AI linguistic check engine in rules ko Hindi/English poster validation ke waqt dynamically apply karega.
                          </p>
                        </div>
                      </div>

                      <form onSubmit={handleSaveBrandGuidelines} className="space-y-5">
                        {/* Allowed / Whitelist Words Interactive Tags */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider">
                              Allowed / Whitelist Words
                            </label>
                            <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-bold">
                              {whitelistTags.length} Words
                            </span>
                          </div>
                          <p className="text-xs text-[#6B6A63]">
                            Brand names or doctor names that should be accepted by the spell checker.
                          </p>

                          {/* Existing Tags Box */}
                          <div className="min-h-[48px] p-2.5 bg-[#FAF9F6] border border-[#E5E2DA] rounded-2xl flex flex-wrap gap-1.5 items-center">
                            {whitelistTags.length === 0 ? (
                              <span className="text-xs text-stone-400 italic px-1">
                                No whitelist words added yet. Type below and press Enter.
                              </span>
                            ) : (
                              whitelistTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs group"
                                >
                                  <span>{tag}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveWhitelistTag(tag)}
                                    className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-emerald-200 text-emerald-700 cursor-pointer transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>

                          {/* Input to add tag */}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={whitelistInputText}
                              onChange={(e) => setWhitelistInputText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ',') {
                                  e.preventDefault();
                                  handleAddWhitelistTag();
                                }
                              }}
                              placeholder="Type word & press Enter or comma (e.g. Apex, Keswani, नमस्ते)..."
                              className="flex-1 px-3.5 py-2 rounded-xl border border-[#E5E2DA] bg-white text-xs text-[#2B2A27] focus:outline-none focus:border-emerald-600 font-mono shadow-2xs"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddWhitelistTag()}
                              disabled={!whitelistInputText.trim()}
                              leftIcon={<Plus className="w-3.5 h-3.5" />}
                            >
                              Add
                            </Button>
                          </div>

                          {/* GMB Auto Whitelist Derived Terms */}
                          {Array.isArray(selectedClient?.client?.gmb_auto_whitelist) && selectedClient.client.gmb_auto_whitelist.length > 0 && (
                            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                                  <Globe className="w-3.5 h-3.5 text-blue-600" />
                                  <span>Derived from GMB Profile ({selectedClient.client.gmb_auto_whitelist.length} terms)</span>
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pt-0.5">
                                {selectedClient.client.gmb_auto_whitelist.map((w, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-white text-slate-700 border border-slate-200"
                                  >
                                    {w}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Banned Words Interactive Tags */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="block text-xs font-semibold text-rose-800 uppercase tracking-wider flex items-center gap-1">
                              <AlertOctagon className="w-3.5 h-3.5 text-rose-600" />
                              <span>Banned Words (Immediate Red Flag)</span>
                            </label>
                            <span className="text-[11px] font-mono text-rose-800 bg-rose-50 px-2 py-0.5 rounded-md font-bold">
                              {bannedTags.length} Words
                            </span>
                          </div>
                          <p className="text-xs text-[#6B6A63]">
                            If these words appear in a post caption or poster image, AI check will immediately flag them.
                          </p>

                          {/* Existing Banned Tags Box */}
                          <div className="min-h-[44px] p-2.5 bg-rose-50/30 border border-rose-200 rounded-2xl flex flex-wrap gap-1.5 items-center">
                            {bannedTags.length === 0 ? (
                              <span className="text-xs text-rose-400 italic px-1">
                                No banned words configured. Type below to add.
                              </span>
                            ) : (
                              bannedTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-rose-100 text-rose-900 border border-rose-300 shadow-2xs group"
                                >
                                  <span>{tag}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveBannedTag(tag)}
                                    className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-rose-200 text-rose-800 cursor-pointer transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>

                          {/* Input to add banned tag */}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={bannedInputText}
                              onChange={(e) => setBannedInputText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ',') {
                                  e.preventDefault();
                                  handleAddBannedTag();
                                }
                              }}
                              placeholder="e.g. scam, fraud, guaranteed, 100% cure, जाली..."
                              className="flex-1 px-3.5 py-2 rounded-xl border border-rose-200 bg-white text-xs text-rose-900 focus:outline-none focus:border-rose-600 font-mono shadow-2xs"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddBannedTag()}
                              disabled={!bannedInputText.trim()}
                              leftIcon={<Plus className="w-3.5 h-3.5 text-rose-600" />}
                            >
                              Add
                            </Button>
                          </div>
                        </div>

                        {/* Mandatory Phrases */}
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-amber-800 uppercase tracking-wider flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            <span>Mandatory Phrases / Required Disclaimers</span>
                          </label>
                          <p className="text-xs text-[#6B6A63]">
                            A warning will appear if the post does not contain these required phrases or hashtags (comma-separated).
                          </p>
                          <textarea
                            rows={2}
                            value={mandatoryInput}
                            onChange={(e) => setMandatoryInput(e.target.value)}
                            placeholder="e.g. #ApexHealth, Consult physician before use"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-amber-200 bg-amber-50/30 text-xs text-amber-950 focus:outline-none focus:border-amber-600 focus:bg-white resize-y font-mono shadow-2xs"
                          />
                        </div>

                        <Button
                          type="submit"
                          variant="primary"
                          size="md"
                          loading={savingGuidelines}
                          className="w-full !rounded-xl font-semibold"
                        >
                          Save Brand Guidelines
                        </Button>
                      </form>
                    </div>
                  </div>
                )}

                {/* SUB-TAB 2: CONNECTED ACCOUNTS (INDIVIDUAL CARDS PER PLATFORM) */}
                {clientSubTab === 'social_accounts' && (
                  <div className="space-y-6 animate-in fade-in-50 duration-150">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-5 rounded-3xl border border-[#E5E2DA] shadow-xs">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                          <Share2 className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-[#2B2A27]">Connected Social Accounts</h3>
                          <p className="text-xs text-[#6B6A63]">
                            Single Agency App Architecture — Connect &amp; publish across all 4 major platforms.
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold px-3 py-1 rounded-xl bg-stone-100 border border-[#E5E2DA] text-stone-700">
                        {socialPlatforms.filter((p) => p.is_connected).length} of 4 Connected
                      </span>
                    </div>

                    {/* 4 INDIVIDUAL CARDS (2 Columns on large screen) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                      {['instagram', 'facebook', 'youtube', 'linkedin'].map((platformKey) => {
                        const p = socialPlatforms.find((item) => item.platform === platformKey) || {
                          platform: platformKey,
                          is_connected: false,
                          profile_url: null,
                        };

                        const isExpanded = manualFormPlatform === platformKey;
                        const banner = cardBanners[platformKey] || (!p.is_connected && p.last_error ? { type: 'error', message: p.last_error } : null);

                        const brandConfig = {
                          instagram: {
                            bg: 'bg-rose-50 border-rose-200',
                            btn: '!bg-rose-600 hover:!bg-rose-700',
                            icon: <InstagramIcon className="w-5 h-5 text-rose-600" />,
                          },
                          facebook: {
                            bg: 'bg-sky-50 border-sky-200',
                            btn: '!bg-sky-600 hover:!bg-sky-700',
                            icon: <FacebookIcon className="w-5 h-5 text-sky-600" />,
                          },
                          youtube: {
                            bg: 'bg-red-50 border-red-200',
                            btn: '!bg-red-600 hover:!bg-red-700',
                            icon: <YouTubeIcon className="w-5 h-5 text-red-600" />,
                          },
                          linkedin: {
                            bg: 'bg-blue-50 border-blue-200',
                            btn: '!bg-blue-600 hover:!bg-blue-700',
                            icon: <LinkedInIcon className="w-5 h-5 text-blue-600" />,
                          },
                        }[platformKey];

                        return (
                          <div
                            key={platformKey}
                            className={`p-6 rounded-3xl border transition-all ${
                              p.is_connected
                                ? 'bg-white border-emerald-300 shadow-xs ring-1 ring-emerald-500/10'
                                : 'bg-white border-[#E5E2DA] shadow-xs'
                            } space-y-4`}
                          >
                            {/* Card Header: Brand Icon + Title + Status Badges */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border shrink-0 ${brandConfig.bg}`}>
                                  {brandConfig.icon}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="text-base font-bold text-[#2B2A27] capitalize">
                                      {platformKey}
                                    </h4>
                                    <span
                                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                        p.is_connected
                                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                          : 'bg-stone-100 text-stone-600 border border-stone-200'
                                      }`}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${p.is_connected ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'}`} />
                                      {p.is_connected ? 'Connected' : 'Not Connected'}
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                                      Auto-Refresh: ON
                                    </span>
                                  </div>

                                  {/* Profile URL */}
                                  <div className="mt-1">
                                    {p.profile_url ? (
                                      <a
                                        href={p.profile_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1 font-mono truncate max-w-xs"
                                        title={p.profile_url}
                                      >
                                        <span className="truncate">{p.profile_url}</span>
                                        <ExternalLink className="w-3 h-3 shrink-0" />
                                      </a>
                                    ) : (
                                      <span className="text-xs text-stone-400 italic">No profile URL configured</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Connected Metadata Row */}
                            {p.is_connected && (
                              <div className="p-3 rounded-xl bg-stone-50 border border-[#E5E2DA] flex items-center gap-4 text-xs font-mono text-stone-600 flex-wrap">
                                <div><span className="text-stone-400">Method: </span><span className="font-semibold uppercase text-stone-800">{p.connection_method || 'oauth'}</span></div>
                                {p.platform_username && <div><span className="text-stone-400">Username: </span><span className="font-semibold text-stone-800">@{p.platform_username}</span></div>}
                                {p.platform_id && <div><span className="text-stone-400">Account ID: </span><span className="text-stone-800">{p.platform_id}</span></div>}
                                {p.masked_access_token && <div><span className="text-stone-400">Token: </span><span className="text-stone-800">{p.masked_access_token}</span></div>}
                                {p.token_expires_at && <div><span className="text-stone-400">Expires: </span><span className="text-stone-800">{formatDate(p.token_expires_at)}</span></div>}
                              </div>
                            )}

                            {/* Token Expired / Error Banner */}
                            {banner && (
                              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
                                <span>⚠️ {banner.message}</span>
                              </div>
                            )}

                            {/* YOUTUBE ONLY: "Naya YouTube Client? Pehle Test User Add Karo" BOX */}
                            {platformKey === 'youtube' && (
                              <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-200 text-stone-800 space-y-2.5 text-left shadow-2xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                                    <span>Naya YouTube Client? Pehle Test User Add Karo</span>
                                  </span>
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-bold">
                                    socel-workflow
                                  </span>
                                </div>

                                <ol className="text-[11px] text-stone-700 space-y-0.5 list-decimal list-inside leading-relaxed font-sans">
                                  <li>Neeche wala link copy karo</li>
                                  <li>Uss browser me jao jisme Owner wala Gmail login hai</li>
                                  <li>Wahan paste karke [ Add Users ] me is client ka Gmail daal do</li>
                                  <li>[ Add ] &rarr; [ Save ] dabao, fir yahan aake [ Connect YouTube ] dabao</li>
                                </ol>

                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(GOOGLE_CLOUD_TEST_USER_URL);
                                      showToast('Link copy ho gaya! Ab Owner wale Gmail wale browser me paste karo', 'success');
                                    }}
                                    className="flex-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-stone-50 border border-amber-300 text-stone-800 shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                                  >
                                    <span>📋</span>
                                    <span>1. Link Copy Karo</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => window.open(GOOGLE_CLOUD_TEST_USER_URL, '_blank')}
                                    className="flex-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                                  >
                                    <span>🔗</span>
                                    <span>2. Google Cloud Kholo</span>
                                  </button>
                                </div>

                                <p className="text-[10px] text-amber-800 font-medium leading-tight">
                                  ⚠️ Ye link sirf Owner wale Gmail se khulega. Agar Access Denied aaye to Owner wale Gmail se login karke kholo.
                                </p>
                              </div>
                            )}

                            {/* Action Buttons Row */}
                            <div className="pt-2 border-t border-[#E5E2DA] flex items-center gap-2 flex-wrap sm:flex-nowrap">
                              <button
                                type="button"
                                onClick={() => handleOAuthConnect(platformKey)}
                                disabled={actionLoading[`oauth-${platformKey}`]}
                                className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold text-white shadow-xs cursor-pointer transition-colors ${brandConfig.btn}`}
                              >
                                {actionLoading[`oauth-${platformKey}`]
                                  ? 'Connecting...'
                                  : platformKey === 'youtube'
                                  ? 'Connect YouTube'
                                  : 'Connect'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleManualForm(platformKey)}
                                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                                  isExpanded
                                    ? 'bg-stone-200 border-stone-300 text-stone-900'
                                    : 'bg-[#FAF9F6] hover:bg-stone-100 border-[#E5E2DA] text-[#2B2A27]'
                                }`}
                              >
                                {isExpanded ? 'Hide Form' : 'Manual se Jodo'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleTestPlatform(platformKey)}
                                disabled={actionLoading[`test-${platformKey}`]}
                                className="px-3 py-2 rounded-xl text-xs font-semibold bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 cursor-pointer transition-colors"
                              >
                                {actionLoading[`test-${platformKey}`] ? 'Testing...' : 'Test'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDisconnectPlatform(platformKey)}
                                disabled={actionLoading[`disc-${platformKey}`] || !p.is_connected}
                                className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                Disconnect
                              </button>
                            </div>

                            {/* Accordion Manual Form */}
                            {isExpanded && (
                              <form
                                onSubmit={(e) => handleManualConnectSubmit(e, platformKey)}
                                className="mt-2 p-4 rounded-2xl bg-[#FAF9F6] border border-[#E5E2DA] space-y-3 animate-in slide-in-from-top-2 duration-150"
                              >
                                <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-2">
                                  <span className="text-xs font-bold text-[#2B2A27] uppercase tracking-wider">
                                    Manual Connect: {platformKey.toUpperCase()}
                                  </span>
                                  <span className="text-[10px] text-stone-500 font-mono">
                                    AES-256 Encrypted
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-stone-600 uppercase mb-1">
                                      Profile / Page URL
                                    </label>
                                    <input
                                      type="url"
                                      value={manualFormData[platformKey]?.profile_url || ''}
                                      onChange={(e) =>
                                        handleManualFormChange(platformKey, 'profile_url', e.target.value)
                                      }
                                      placeholder={`e.g. https://${platformKey}.com/...`}
                                      className="w-full px-3 py-2 rounded-xl border border-[#E5E2DA] bg-white text-xs font-mono shadow-2xs"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-semibold text-stone-600 uppercase mb-1">
                                      Platform Page / Channel ID
                                    </label>
                                    <input
                                      type="text"
                                      value={manualFormData[platformKey]?.platform_id || ''}
                                      onChange={(e) =>
                                        handleManualFormChange(platformKey, 'platform_id', e.target.value)
                                      }
                                      placeholder="e.g. 17841400000000000"
                                      className="w-full px-3 py-2 rounded-xl border border-[#E5E2DA] bg-white text-xs font-mono shadow-2xs"
                                    />
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-stone-600 uppercase mb-1">
                                    Access Token <span className="text-rose-500">*</span>
                                  </label>
                                  <input
                                    type="password"
                                    value={manualFormData[platformKey]?.access_token || ''}
                                    onChange={(e) =>
                                      handleManualFormChange(platformKey, 'access_token', e.target.value)
                                    }
                                    placeholder="Enter long-lived Access Token"
                                    required
                                    className="w-full px-3 py-2 rounded-xl border border-[#E5E2DA] bg-white text-xs font-mono shadow-2xs"
                                  />
                                </div>

                                {platformKey === 'youtube' && (
                                  <div>
                                    <label className="block text-[11px] font-semibold text-red-800 uppercase mb-1">
                                      Refresh Token (Mandatory for YouTube) <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                      type="password"
                                      value={manualFormData.youtube?.refresh_token || ''}
                                      onChange={(e) =>
                                        handleManualFormChange('youtube', 'refresh_token', e.target.value)
                                      }
                                      placeholder="Enter YouTube Refresh Token (1//04...)"
                                      required
                                      className="w-full px-3 py-2 rounded-xl border border-red-200 bg-white text-xs font-mono shadow-2xs"
                                    />
                                  </div>
                                )}

                                <div className="flex items-center justify-end gap-2 pt-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleToggleManualForm(platformKey)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    type="submit"
                                    variant="primary"
                                    size="sm"
                                    loading={actionLoading[`manual-${platformKey}`]}
                                  >
                                    Save &amp; Connect {platformKey}
                                  </Button>
                                </div>
                              </form>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* MODAL: ADD CLIENT */}
        {showAddClientModal && (
          <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFFFF] border border-[#E5E2DA] rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-3">
                <h3 className="font-bold text-[#2B2A27] text-base">Register New Client</h3>
                <button
                  onClick={() => setShowAddClientModal(false)}
                  className="text-[#6B6A63] hover:text-[#2B2A27] text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateClient} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                    Client / Organization Name <span className="text-emerald-600 font-bold">*</span>
                  </label>
                  <input
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="e.g. Apex Health Clinic"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                      Primary Phone <span className="text-emerald-600 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      value={newPrimaryPhone}
                      onChange={(e) => setNewPrimaryPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                      Alternate Phone
                    </label>
                    <input
                      type="text"
                      value={newAlternatePhone}
                      onChange={(e) => setNewAlternatePhone(e.target.value)}
                      placeholder="e.g. 9123456780"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                    Official Registered Address
                  </label>
                  <textarea
                    rows={2}
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="Official address used by AI verification..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white resize-y"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sky-950 uppercase tracking-wider mb-1">
                    GMB Profile Link (Optional)
                  </label>
                  <input
                    type="url"
                    value={newGmbUrl}
                    onChange={(e) => setNewGmbUrl(e.target.value)}
                    placeholder="https://maps.app.goo.gl/... or https://google.com/maps/place/..."
                    className="w-full px-3.5 py-2 rounded-xl border border-sky-200 bg-white text-xs text-[#2B2A27] font-mono"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddClientModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={creatingClient}
                  >
                    Create Client
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* PERMANENT DELETE WARNING CONFIRMATION MODAL (DEACTIVATED CLIENTS ONLY) */}
        {clientToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-red-200">
              <div className="flex items-center gap-3 text-red-600 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#2B2A27]">Permanently Delete Client?</h3>
                  <p className="text-xs text-red-600 font-semibold">Critical Warning: Action cannot be undone</p>
                </div>
              </div>

              <div className="space-y-3 bg-red-50/50 border border-red-100 rounded-2xl p-4 mb-5 text-xs text-[#2B2A27]">
                <p>
                  You are about to permanently delete <strong className="font-bold text-red-700">{clientToDelete.name}</strong>.
                </p>
                <p className="text-[#6B6A63]">
                  Because this client is deactivated, this will permanently wipe from the database:
                </p>
                <ul className="list-disc list-inside space-y-1 text-[#6B6A63] pl-1 font-medium">
                  <li>Official brand guidelines &amp; whitelist terms</li>
                  <li>All posts, revisions &amp; AI quality inspection records</li>
                  <li>All connected social accounts &amp; tokens</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deletingClient}
                  onClick={() => setClientToDelete(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white border border-red-700"
                  loading={deletingClient}
                  leftIcon={<Trash2 className="w-4 h-4" />}
                  onClick={handlePermanentDeleteClient}
                >
                  Yes, Permanently Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;
