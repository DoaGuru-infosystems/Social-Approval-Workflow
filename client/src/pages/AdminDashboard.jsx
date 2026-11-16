import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import Button from '../components/Button';
import postService from '../services/postService';
import clientService from '../services/clientService';
import { SERVER_URL } from '../utils/constants';
import { formatDate, getStatusBadgeStyle } from '../utils/helpers';
import { useToast } from '../context/ToastContext';
import {
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  XCircle,
  RotateCcw,
  Sparkles,
  Clock,
  AlertTriangle,
  Building2,
  PlusCircle,
  Settings2,
  Share2,
  ArrowLeft,
  Trash2,
  ExternalLink,
  Tag,
  AlertOctagon,
  FileText,
  Phone,
  MapPin,
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

const AdminDashboard = () => {
  const { showToast } = useToast();

  // Navigation Tabs: 'pipeline' | 'clients'
  const [activeTab, setActiveTab] = useState('pipeline');

  // Approval Pipeline State
  const [allPosts, setAllPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [activeActionId, setActiveActionId] = useState(null);
  const [comments, setComments] = useState({});

  // Client Management State
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [loadingClientDetail, setLoadingClientDetail] = useState(false);

  // New Client Modal
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newPrimaryPhone, setNewPrimaryPhone] = useState('');
  const [newAlternatePhone, setNewAlternatePhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);

  // Client Official Identity State (for selectedClient)
  const [identityName, setIdentityName] = useState('');
  const [identityPrimaryPhone, setIdentityPrimaryPhone] = useState('');
  const [identityAlternatePhone, setIdentityAlternatePhone] = useState('');
  const [identityAddress, setIdentityAddress] = useState('');
  const [savingIdentity, setSavingIdentity] = useState(false);

  // Brand Guidelines State
  const [whitelistInput, setWhitelistInput] = useState('');
  const [bannedInput, setBannedInput] = useState('');
  const [mandatoryInput, setMandatoryInput] = useState('');
  const [savingGuidelines, setSavingGuidelines] = useState(false);

  // Social Connect Modal
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState('instagram');
  const [connectAccountName, setConnectAccountName] = useState('');
  const [connectingSocial, setConnectingSocial] = useState(false);

  useEffect(() => {
    fetchAdminPosts();
    fetchClients();
  }, []);

  const fetchAdminPosts = async () => {
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
  };

  const fetchClients = async () => {
    setLoadingClients(true);
    try {
      const data = await clientService.getClients({ all: 'true' });
      setClients(data?.clients || []);
    } catch {
      showToast('Unable to load the client list.', 'error');
    } finally {
      setLoadingClients(false);
    }
  };

  const handleSelectClient = async (clientId) => {
    setLoadingClientDetail(true);
    try {
      const data = await clientService.getClientById(clientId);
      setSelectedClient(data);

      const c = data?.client || {};
      setIdentityName(c.name || '');
      setIdentityPrimaryPhone(c.primary_phone || '');
      setIdentityAlternatePhone(c.alternate_phone || '');
      setIdentityAddress(c.address || '');

      const g = data?.brand_guidelines || {};
      setWhitelistInput((g.whitelist_words || []).join(', '));
      setBannedInput((g.banned_words || []).join(', '));
      setMandatoryInput((g.mandatory_phrases || []).join(', '));
    } catch {
      showToast('Unable to load client details.', 'error');
    } finally {
      setLoadingClientDetail(false);
    }
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    if (!newClientName.trim()) {
      showToast('Enter a client name.', 'warning');
      return;
    }
    const cleanPhone = newPrimaryPhone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      showToast('Enter a valid 10-digit primary phone number.', 'warning');
      return;
    }

    setCreatingClient(true);
    try {
      const data = await clientService.createClient({
        name: newClientName.trim(),
        primary_phone: newPrimaryPhone.trim(),
        alternate_phone: newAlternatePhone.trim() || null,
        address: newAddress.trim() || null,
      });
      showToast(`Client '${data.client.name}' was created.`, 'success');
      setNewClientName('');
      setNewPrimaryPhone('');
      setNewAlternatePhone('');
      setNewAddress('');
      setShowAddClientModal(false);
      fetchClients();
      handleSelectClient(data.client.id);
    } catch (err) {
      showToast(err.response?.data?.message || 'Unable to create the client.', 'error');
    } finally {
      setCreatingClient(false);
    }
  };

  const handleSaveClientIdentity = async (e) => {
    e.preventDefault();
    if (!selectedClient?.client?.id) return;
    if (!identityName.trim()) {
      showToast('Client name is required.', 'warning');
      return;
    }
    const cleanPhone = identityPrimaryPhone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      showToast('Enter a valid 10-digit primary phone number.', 'warning');
      return;
    }

    setSavingIdentity(true);
    try {
      await clientService.updateClient(selectedClient.client.id, {
        name: identityName.trim(),
        primary_phone: identityPrimaryPhone.trim() || null,
        alternate_phone: identityAlternatePhone.trim() || null,
        address: identityAddress.trim() || null,
      });
      showToast('Client official identity updated successfully.', 'success');
      fetchClients();
      handleSelectClient(selectedClient.client.id);
    } catch (err) {
      showToast(err.response?.data?.message || 'Unable to update client identity.', 'error');
    } finally {
      setSavingIdentity(false);
    }
  };

  const handleSaveBrandGuidelines = async (e) => {
    e.preventDefault();
    if (!selectedClient?.client?.id) return;

    setSavingGuidelines(true);
    try {
      await clientService.updateBrandGuidelines(selectedClient.client.id, {
        whitelist_words: whitelistInput,
        banned_words: bannedInput,
        mandatory_phrases: mandatoryInput,
      });
      showToast('Brand guidelines saved successfully.', 'success');
      handleSelectClient(selectedClient.client.id);
    } catch (err) {
      showToast(err.response?.data?.message || 'Unable to save the brand guidelines.', 'error');
    } finally {
      setSavingGuidelines(false);
    }
  };

  const handleConnectSocialSubmit = async (e) => {
    e.preventDefault();
    if (!selectedClient?.client?.id) return;
    if (!connectAccountName.trim()) {
      showToast('Enter the account handle or name.', 'warning');
      return;
    }

    setConnectingSocial(true);
    try {
      await clientService.connectSocialAccount(selectedClient.client.id, {
        platform: connectPlatform,
        account_name: connectAccountName.trim().startsWith('@')
          ? connectAccountName.trim()
          : `@${connectAccountName.trim()}`,
        platform_account_id: `${connectPlatform}_${Date.now()}`,
        access_token: `EAAB_live_token_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      });
      showToast(`${connectPlatform.toUpperCase()} account connected successfully.`, 'success');
      setConnectAccountName('');
      setShowConnectModal(false);
      handleSelectClient(selectedClient.client.id);
      fetchClients();
    } catch (err) {
      showToast(err.response?.data?.message || 'Unable to connect the social account.', 'error');
    } finally {
      setConnectingSocial(false);
    }
  };

  const handleDisconnectSocial = async (accountId) => {
    if (!selectedClient?.client?.id) return;
    if (!window.confirm('Are you sure you want to disconnect this social account?')) return;

    try {
      await clientService.disconnectSocialAccount(selectedClient.client.id, accountId);
      showToast('Social account disconnected.', 'success');
      handleSelectClient(selectedClient.client.id);
      fetchClients();
    } catch (err) {
      showToast(err.response?.data?.message || 'Unable to disconnect the social account.', 'error');
    }
  };

  const handleToggleClientActive = async (client) => {
    try {
      await clientService.updateClient(client.id, { is_active: !client.is_active });
      showToast(
        `Client '${client.name}' is now ${!client.is_active ? 'active' : 'inactive'}.`,
        'success'
      );
      fetchClients();
      if (selectedClient?.client?.id === client.id) {
        handleSelectClient(client.id);
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Unable to update the client status.', 'error');
    }
  };

  const pendingAdminPosts = allPosts.filter((p) => p.status === 'pending_admin');

  const handleAdminAction = async (postId, action) => {
    setActiveActionId(`${action}-${postId}`);
    try {
      const comment = (comments[postId] || '').trim();
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

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#2B2A27] pb-16">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header & Tabs */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[#2B2A27]">
                Admin Control & Approval Hub
              </h1>
            </div>
            <p className="text-sm text-[#6B6A63] mt-1">
              Multi-Client Governance, Brand Guidelines, Connected Social Accounts, & Final Post Approvals.
            </p>
          </div>

          {/* Navigation Pill Buttons */}
          <div className="flex items-center gap-2 bg-stone-100 p-1 rounded-xl border border-[#E5E2DA]">
            <button
              onClick={() => {
                setActiveTab('pipeline');
                setSelectedClient(null);
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
              onClick={() => setActiveTab('clients')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'clients'
                  ? 'bg-white text-[#2B2A27] shadow-xs'
                  : 'text-[#6B6A63] hover:text-[#2B2A27]'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Clients & Guidelines ({clients.length})</span>
            </button>
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
                <span className="text-xs text-emerald-800 font-medium">Active Clients</span>
                <h3 className="text-xl font-bold text-[#2B2A27] mt-1">
                  {clients.filter((c) => c.is_active).length}
                </h3>
              </div>
            </div>

            {/* SECTION 1: Pending Admin Approval Queue */}
            <div className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-[#2B2A27] flex items-center gap-2">
                  <span>Posts Awaiting Final Admin Approval</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200 font-mono">
                    {pendingAdminPosts.length}
                  </span>
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  loading={loadingPosts}
                  leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loadingPosts ? 'animate-spin' : ''}`} />}
                  onClick={fetchAdminPosts}
                >
                  Refresh Posts
                </Button>
              </div>

              {loadingPosts ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {[1, 2].map((n) => (
                    <div
                      key={n}
                      className="bg-stone-100 rounded-3xl p-6 border border-[#E5E2DA] animate-pulse space-y-4"
                    >
                      <div className="flex justify-between items-center">
                        <div className="h-4 bg-stone-200 rounded w-24"></div>
                        <div className="h-4 bg-stone-200 rounded w-28"></div>
                      </div>
                      <div className="h-48 bg-stone-200 rounded-2xl"></div>
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
                    const aiReport = post.latest_ai_check;
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
                              <span className="text-xs text-[#6B6A63] flex items-center gap-1">
                                <Clock className="w-3 h-3 text-[#A8A29E]" />
                                {formatDate(post.created_at)}
                              </span>
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
                                alt="Creative preview"
                                className="w-full h-full max-h-56 object-contain rounded-xl"
                              />
                            </div>
                          )}

                          {/* Content */}
                          <div className="p-5 space-y-3">
                            <div>
                              <span className="text-[11px] text-[#6B6A63] uppercase tracking-wider font-semibold block mb-1">
                                Post Caption:
                              </span>
                              <p className="text-sm text-[#2B2A27] leading-relaxed whitespace-pre-wrap">
                                {post.caption || <span className="italic text-[#A8A29E]">No caption</span>}
                              </p>
                            </div>

                            {/* AI Report Summary */}
                            {aiReport && (
                              <div className="text-xs p-3.5 rounded-2xl bg-[#FAF9F6] border border-[#E5E2DA] space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-emerald-800 flex items-center gap-1">
                                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                                    Hindi and English AI & Brand Rules Check
                                  </span>
                                  <span
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                      aiReport.passed
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-rose-100 text-rose-800'
                                    }`}
                                  >
                                    {aiReport.passed ? 'PASSED' : 'FLAGGED'}
                                  </span>
                                </div>

                                {/* Banned words alert */}
                                {aiReport.banned_words_found?.length > 0 && (
                                  <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-1.5">
                                    <AlertOctagon className="w-4 h-4 shrink-0 text-rose-600" />
                                    <span>
                                      <strong>Banned Brand Words:</strong>{' '}
                                      {aiReport.banned_words_found.join(', ')}
                                    </span>
                                  </div>
                                )}

                                {/* Missing Mandatory alert */}
                                {aiReport.missing_mandatory_phrases?.length > 0 && (
                                  <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-1.5">
                                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                                    <span>
                                      <strong>Missing Required Phrase:</strong>{' '}
                                      {aiReport.missing_mandatory_phrases.join(', ')}
                                    </span>
                                  </div>
                                )}

                                {/* Brand Identity: Possible Brand Name Error */}
                                {aiReport.brand_identity_check?.possible_brand_name_error && (
                                  <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-1.5">
                                    <AlertOctagon className="w-4 h-4 shrink-0 text-rose-600" />
                                    <span>
                                      <strong>Brand Identity Mismatch:</strong>{' '}
                                      {aiReport.brand_identity_check.possible_brand_name_error}
                                    </span>
                                  </div>
                                )}

                                {/* Brand Identity: Phone Verification Warnings */}
                                {aiReport.brand_identity_check?.phone_verification?.filter((p) => p.status !== 'clean').map((pv, idx) => (
                                  <div key={idx} className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-1.5">
                                    <Phone className="w-4 h-4 shrink-0 text-rose-600" />
                                    <span>
                                      <strong>Phone Check Alert:</strong> {pv.message}
                                    </span>
                                  </div>
                                ))}

                                {/* Brand Identity: Address Warning */}
                                {aiReport.brand_identity_check?.address_warning && (
                                  <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-1.5">
                                    <MapPin className="w-4 h-4 shrink-0 text-amber-600" />
                                    <span>
                                      <strong>Address Alert:</strong> {aiReport.brand_identity_check.address_warning}
                                    </span>
                                  </div>
                                )}

                                <p className="text-[#6B6A63] text-[11px]">
                                  Spelling Issues: {aiReport.spelling_issues?.length || 0} | OCR Text:{' '}
                                  {aiReport.ocr_extracted_text ? `"${aiReport.ocr_extracted_text.slice(0, 40)}..."` : 'None'}
                                </p>
                              </div>
                            )}

                            {Boolean(post.manual_review_required || post.recheck_count >= 3) && (
                              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                                <span>⚠️ Max 3 Rechecks Exceeded: Manually review brand clearance before approving.</span>
                              </div>
                            )}

                            <input
                              type="text"
                              value={comments[post.id] || ''}
                              onChange={(e) =>
                                setComments({ ...comments, [post.id]: e.target.value })
                              }
                              placeholder="Optional admin clearance note / revision remark..."
                              className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF9F6] border border-[#E5E2DA] text-xs text-[#2B2A27] placeholder-[#A8A29E] focus:outline-none focus:border-emerald-600 focus:bg-white"
                            />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="p-4 bg-stone-50 border-t border-[#E5E2DA] flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            className="flex-1"
                            leftIcon={<XCircle className="w-3.5 h-3.5" />}
                            loading={activeActionId === `reject-${post.id}`}
                            disabled={isActionActive}
                            onClick={() => handleAdminAction(post.id, 'reject')}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-amber-800 hover:text-amber-900 border-[#E5E2DA] hover:border-amber-300 bg-white"
                            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                            loading={activeActionId === `changes_requested-${post.id}`}
                            disabled={isActionActive}
                            onClick={() => handleAdminAction(post.id, 'changes_requested')}
                          >
                            Request Changes
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            className="flex-1 !bg-emerald-600 hover:!bg-emerald-700"
                            leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                            loading={activeActionId === `approve-${post.id}`}
                            disabled={isActionActive}
                            onClick={() => handleAdminAction(post.id, 'approve')}
                          >
                            Final Approve
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SECTION 2: Master Audit Trail Table */}
            <div className="bg-[#FFFFFF] rounded-3xl p-6 border border-[#E5E2DA] shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-[#2B2A27]">Master Post Audit & Status Log</h2>
                  <p className="text-xs text-[#6B6A63]">Real-time status of all client posts</p>
                </div>
                <span className="text-xs text-[#6B6A63] font-mono">{allPosts.length} items</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] uppercase bg-stone-50 text-[#6B6A63] font-semibold border-b border-[#E5E2DA]">
                    <tr>
                      <th className="py-3 px-4">Post ID</th>
                      <th className="py-3 px-4">Client</th>
                      <th className="py-3 px-4">Title</th>
                      <th className="py-3 px-4">SMO</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Platform</th>
                      <th className="py-3 px-4">Rechecks</th>
                      <th className="py-3 px-4">Live URL</th>
                      <th className="py-3 px-4 text-right">Created At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E2DA]">
                    {allPosts.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-xs text-[#6B6A63]">
                          No posts are available.
                        </td>
                      </tr>
                    ) : (
                      allPosts.map((post) => (
                        <tr key={post.id} className="hover:bg-stone-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-[#2B2A27]">#{post.id}</td>
                          <td className="py-3 px-4 font-medium text-emerald-800">{post.client_name || 'Client'}</td>
                          <td className="py-3 px-4 text-[#2B2A27] font-medium max-w-xs truncate">{post.title}</td>
                          <td className="py-3 px-4 text-[#2B2A27]">{post.smo_name || post.creator_name || 'SMO'}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase ${getStatusBadgeStyle(
                                post.status
                              )}`}
                            >
                              {post.status?.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[#2B2A27] capitalize">{post.platform || '—'}</td>
                          <td className="py-3 px-4 text-[#6B6A63] font-mono">{post.recheck_count}/3</td>
                          <td className="py-3 px-4 text-xs font-mono text-emerald-700 truncate max-w-xs">
                            {post.manual_publish_url ? (
                              <a
                                href={post.manual_publish_url}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline flex items-center gap-1"
                              >
                                <span>{post.manual_publish_url}</span>
                              </a>
                            ) : (
                              <span className="text-[#A8A29E]">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right text-xs text-[#6B6A63]">
                            {formatDate(post.created_at)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CLIENT DIRECTORY & BRAND GUIDELINES */}
        {activeTab === 'clients' && (
          <div>
            {!selectedClient ? (
              /* Client Directory List View */
              <div className="bg-[#FFFFFF] rounded-3xl p-6 border border-[#E5E2DA] shadow-xs">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-[#2B2A27]">Registered Clients Directory</h2>
                    <p className="text-xs text-[#6B6A63]">
                      Manage each client's brand rules (whitelist, banned words, and required phrases) and connected social accounts.
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

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[11px] uppercase bg-stone-50 text-[#6B6A63] font-semibold border-b border-[#E5E2DA]">
                      <tr>
                        <th className="py-3 px-4">Client ID</th>
                        <th className="py-3 px-4">Client Name</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Campaign Posts</th>
                        <th className="py-3 px-4">Connected Accounts</th>
                        <th className="py-3 px-4">Created By</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E2DA]">
                      {loadingClients ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-xs text-[#6B6A63]">
                            Loading clients...
                          </td>
                        </tr>
                      ) : clients.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-xs text-[#6B6A63]">
                            No clients are registered. Select "Add New Client" to create the first one.
                          </td>
                        </tr>
                      ) : (
                        clients.map((client) => (
                          <tr
                            key={client.id}
                            className="hover:bg-stone-50/70 transition-colors cursor-pointer"
                            onClick={() => handleSelectClient(client.id)}
                          >
                            <td className="py-3.5 px-4 font-mono font-bold text-[#2B2A27]">
                              #{client.id}
                            </td>
                            <td className="py-3.5 px-4 font-bold text-[#2B2A27] flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-emerald-600" />
                              <span>{client.name}</span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                  client.is_active
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : 'bg-stone-100 text-stone-600 border border-stone-200'
                                }`}
                              >
                                {client.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-[#2B2A27] font-mono">
                              {client.post_count || 0} posts
                            </td>
                            <td className="py-3.5 px-4 text-[#2B2A27] font-mono">
                              {client.social_account_count || 0} accounts
                            </td>
                            <td className="py-3.5 px-4 text-xs text-[#6B6A63]">
                              {client.created_by_name || 'Admin'}
                            </td>
                            <td
                              className="py-3.5 px-4 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  leftIcon={<Settings2 className="w-3.5 h-3.5" />}
                                  onClick={() => handleSelectClient(client.id)}
                                >
                                  Manage Details
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={client.is_active ? '!text-rose-600 hover:!bg-rose-50' : '!text-emerald-700 hover:!bg-emerald-50'}
                                  onClick={() => handleToggleClientActive(client)}
                                >
                                  {client.is_active ? 'Deactivate' : 'Activate'}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Client Detail View (Brand Guidelines + Connected Accounts) */
              <div className="space-y-6">
                {/* Back button & Client Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#FFFFFF] p-6 rounded-3xl border border-[#E5E2DA] shadow-xs">
                  <div>
                    <button
                      onClick={() => setSelectedClient(null)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B6A63] hover:text-[#2B2A27] mb-2 cursor-pointer transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back to All Clients
                    </button>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-[#2B2A27] flex items-center gap-2">
                          <span>{selectedClient.client?.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-md font-mono bg-stone-100 text-[#6B6A63] border border-[#E5E2DA]">
                            ID #{selectedClient.client?.id}
                          </span>
                        </h2>
                        <span className="text-xs text-[#6B6A63]">
                          Registered on {formatDate(selectedClient.client?.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
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
                      onClick={() => handleToggleClientActive(selectedClient.client)}
                    >
                      {selectedClient.client?.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </div>

                {/* Grid: Brand Guidelines & Connected Accounts */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* BRAND GUIDELINES & OFFICIAL IDENTITY (7 Cols) */}
                  <div className="lg:col-span-7 space-y-6">
                    {/* OFFICIAL CLIENT IDENTITY */}
                    <div className="bg-[#FFFFFF] p-6 rounded-3xl border border-[#E5E2DA] shadow-xs space-y-5">
                      <div className="flex items-center gap-2 pb-3 border-b border-[#E5E2DA]">
                        <Building2 className="w-5 h-5 text-emerald-600" />
                        <div>
                          <h3 className="text-base font-bold text-[#2B2A27]">Official Client Identity</h3>
                          <p className="text-xs text-[#6B6A63]">
                            Ground-truth identity used by AI to verify brand names, phone numbers, and addresses.
                          </p>
                        </div>
                      </div>

                      <form onSubmit={handleSaveClientIdentity} className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                            Official Organization / Brand Name
                          </label>
                          <input
                            type="text"
                            value={identityName}
                            onChange={(e) => setIdentityName(e.target.value)}
                            placeholder="e.g. Balgopal Children's Neuro Clinic"
                            required
                            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                              <Phone className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Primary Phone (Required)</span>
                            </label>
                            <input
                              type="text"
                              value={identityPrimaryPhone}
                              onChange={(e) => setIdentityPrimaryPhone(e.target.value)}
                              placeholder="e.g. 8989590477"
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
                              placeholder="e.g. 8447096306"
                              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                            />
                          </div>
                        </div>

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
                          className="w-full !rounded-xl"
                        >
                          Save Client Identity
                        </Button>
                      </form>
                    </div>

                    {/* BRAND GUIDELINES (Linguistic Rules) */}
                    <div className="bg-[#FFFFFF] p-6 rounded-3xl border border-[#E5E2DA] shadow-xs space-y-5">
                      <div className="flex items-center gap-2 pb-3 border-b border-[#E5E2DA]">
                        <Tag className="w-5 h-5 text-emerald-600" />
                        <div>
                          <h3 className="text-base font-bold text-[#2B2A27]">Client Brand Guidelines</h3>
                          <p className="text-xs text-[#6B6A63]">
                            AI check engine in rules ko post validation ke waqt dynamically apply karega.
                          </p>
                        </div>
                      </div>

                      <form onSubmit={handleSaveBrandGuidelines} className="space-y-4">
                        {/* Whitelist Words */}
                        <div>
                          <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                            Allowed / Whitelist Words (Comma-Separated)
                          </label>
                          <p className="text-xs text-[#6B6A63] mb-2">
                            Add brand names or terms that should be accepted by the spelling checker.
                          </p>
                          <textarea
                            rows={3}
                            value={whitelistInput}
                            onChange={(e) => setWhitelistInput(e.target.value)}
                            placeholder="e.g. Apex, ApexHealth, FitFam, Insta, नमस्ते"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white resize-y font-mono"
                          />
                        </div>

                        {/* Banned Words */}
                        <div>
                          <label className="block text-xs font-semibold text-rose-800 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                            <AlertOctagon className="w-3.5 h-3.5 text-rose-600" />
                            <span>Banned Words (Immediate Red Flag)</span>
                          </label>
                          <p className="text-xs text-[#6B6A63] mb-2">
                            If these words appear in a post's caption, title, or image text, the AI report will flag them.
                          </p>
                          <textarea
                            rows={3}
                            value={bannedInput}
                            onChange={(e) => setBannedInput(e.target.value)}
                            placeholder="e.g. scam, fraud, guaranteed, cure-all, fake, जाली"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50/40 text-sm text-rose-900 focus:outline-none focus:border-rose-600 focus:bg-white resize-y font-mono"
                          />
                        </div>

                        {/* Mandatory Phrases */}
                        <div>
                          <label className="block text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            <span>Mandatory Phrases / Required Disclaimers</span>
                          </label>
                          <p className="text-xs text-[#6B6A63] mb-2">
                            A warning will appear if the caption does not include these required hashtags or disclaimers.
                          </p>
                          <textarea
                            rows={2}
                            value={mandatoryInput}
                            onChange={(e) => setMandatoryInput(e.target.value)}
                            placeholder="e.g. #ApexHealth, Consult physician before use"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-amber-200 bg-amber-50/40 text-sm text-amber-900 focus:outline-none focus:border-amber-600 focus:bg-white resize-y font-mono"
                          />
                        </div>

                        <Button
                          type="submit"
                          variant="primary"
                          size="md"
                          loading={savingGuidelines}
                          className="w-full !rounded-xl"
                        >
                          Save Brand Guidelines
                        </Button>
                      </form>
                    </div>
                  </div>

                  {/* CONNECTED SOCIAL ACCOUNTS (5 Cols) */}
                  <div className="lg:col-span-5 space-y-4">
                    <div className="bg-[#FFFFFF] p-6 rounded-3xl border border-[#E5E2DA] shadow-xs space-y-5">
                      <div className="flex items-center justify-between pb-3 border-b border-[#E5E2DA]">
                        <div className="flex items-center gap-2">
                          <Share2 className="w-5 h-5 text-emerald-600" />
                          <h3 className="text-base font-bold text-[#2B2A27]">Connected Accounts</h3>
                        </div>
                        <Button
                          size="sm"
                          variant="primary"
                          leftIcon={<PlusCircle className="w-3.5 h-3.5" />}
                          onClick={() => setShowConnectModal(true)}
                        >
                          Connect
                        </Button>
                      </div>

                      <p className="text-xs text-[#6B6A63]">
                        The SMO can publish posts only to these connected accounts.
                      </p>

                      {selectedClient.social_accounts?.length === 0 ? (
                        <div className="p-6 rounded-2xl bg-[#FAF9F6] border border-[#E5E2DA] text-center space-y-2">
                          <Share2 className="w-8 h-8 text-[#A8A29E] mx-auto" />
                          <p className="text-xs font-semibold text-[#2B2A27]">
                            This client has no connected accounts.
                          </p>
                          <p className="text-[11px] text-[#6B6A63]">
                            Connect an Instagram or Facebook account to enable platform selection.
                          </p>
                          <div className="pt-2 flex justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setConnectPlatform('instagram');
                                setShowConnectModal(true);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium cursor-pointer hover:bg-rose-100"
                            >
                              + Instagram
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConnectPlatform('facebook');
                                setShowConnectModal(true);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 text-xs font-medium cursor-pointer hover:bg-sky-100"
                            >
                              + Facebook
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedClient.social_accounts?.map((acc) => (
                            <div
                              key={acc.id}
                              className="p-3.5 rounded-2xl bg-[#FAF9F6] border border-[#E5E2DA] flex items-center justify-between"
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                                    acc.platform === 'instagram'
                                      ? 'bg-rose-50 border-rose-200 text-rose-600'
                                      : 'bg-sky-50 border-sky-200 text-sky-600'
                                  }`}
                                >
                                  {acc.platform === 'instagram' ? (
                                    <InstagramIcon className="w-5 h-5" />
                                  ) : (
                                    <FacebookIcon className="w-5 h-5" />
                                  )}
                                </div>
                                <div>
                                  <span className="text-xs font-bold text-[#2B2A27] block">
                                    {acc.account_name}
                                  </span>
                                  <span className="text-[10px] text-emerald-700 font-medium">
                                    ● Token Encrypted & Active
                                  </span>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleDisconnectSocial(acc.id)}
                                className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 cursor-pointer transition-colors"
                                title="Disconnect Account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MODAL: ADD NEW CLIENT */}
        {showAddClientModal && (
          <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFFFF] border border-[#E5E2DA] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-xl">
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
                    Client / Company Name *
                  </label>
                  <input
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="e.g. Balgopal Children's Neuro Clinic"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Primary Phone *</span>
                    </label>
                    <input
                      type="text"
                      value={newPrimaryPhone}
                      onChange={(e) => setNewPrimaryPhone(e.target.value)}
                      placeholder="e.g. 8989590477"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-[#6B6A63]" />
                      <span>Alternate Phone</span>
                    </label>
                    <input
                      type="text"
                      value={newAlternatePhone}
                      onChange={(e) => setNewAlternatePhone(e.target.value)}
                      placeholder="e.g. 8447096306"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Registered Address</span>
                  </label>
                  <textarea
                    rows={2}
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="e.g. 1063, near Jan Jyoti Hospital, Gole Bazar, Wright Town, Jabalpur"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white resize-y"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
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

        {/* MODAL: CONNECT SOCIAL ACCOUNT */}
        {showConnectModal && selectedClient && (
          <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFFFF] border border-[#E5E2DA] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-3">
                <h3 className="font-bold text-[#2B2A27] text-base">
                  Connect Social Account for {selectedClient.client?.name}
                </h3>
                <button
                  onClick={() => setShowConnectModal(false)}
                  className="text-[#6B6A63] hover:text-[#2B2A27] text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleConnectSocialSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-2">
                    Platform
                  </label>
                  <select
                    value={connectPlatform}
                    onChange={(e) => setConnectPlatform(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white"
                  >
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-2">
                    Account Handle / Page Name
                  </label>
                  <input
                    type="text"
                    value={connectAccountName}
                    onChange={(e) => setConnectAccountName(e.target.value)}
                    placeholder="e.g. @apex_fitness_official"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                  <p className="text-[11px] text-[#6B6A63] mt-1.5">
                    The Meta Graph API access token will be encrypted with AES-256 before it is stored in the database.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowConnectModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={connectingSocial}
                  >
                    Link Account
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminDashboard;
