import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Button from '../components/Button';
import ImageUpload from '../components/ImageUpload';
import { PLATFORMS, SERVER_URL } from '../utils/constants';
import { formatDate, getStatusBadgeStyle } from '../utils/helpers';
import { useToast } from '../context/ToastContext';
import postService from '../services/postService';
import clientService from '../services/clientService';
import {
  PlusCircle,
  Sparkles,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  Edit3,
  ExternalLink,
  Share2,
  AlertTriangle,
  RotateCcw,
  XCircle,
  Building2,
  AlertOctagon,
  Phone,
  Search,
  Filter,
  X,
  Eye,
  Layers,
  Calendar,
  SlidersHorizontal,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import ImageCheckSkeleton from '../components/ImageCheckSkeleton';
import AnnotatedPosterOCR from '../components/AnnotatedPosterOCR';
import LogoCheckCard from '../components/LogoCheckCard';

const SMODashboard = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Multi-Client State
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  // UI Navigation & Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [inspectingPost, setInspectingPost] = useState(null);
  const [selectedTab, setSelectedTab] = useState('all'); // 'all' | 'action_needed' | 'in_review' | 'ready' | 'scheduled_live'
  const [selectedClientFilter, setSelectedClientFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Revision Modal/State
  const [editingPost, setEditingPost] = useState(null);
  const [reviseTitle, setReviseTitle] = useState('');
  const [reviseCaption, setReviseCaption] = useState('');
  const [reviseFile, setReviseFile] = useState(null);
  const [revisePreview, setRevisePreview] = useState(null);

  // Platform & Live URL inputs
  const [selectedPlatforms, setSelectedPlatforms] = useState({});
  const [liveUrls, setLiveUrls] = useState({});
  const [clientAccountsMap, setClientAccountsMap] = useState({});
  const [scheduleDateMap, setScheduleDateMap] = useState({});
  const [showScheduleMap, setShowScheduleMap] = useState({});

  // Loading States
  const [posts, setPosts] = useState([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [creatingPost, setCreatingPost] = useState(false);
  const [activeActionId, setActiveActionId] = useState(null);
  const [retryingPosts, setRetryingPosts] = useState(new Set());
  const [checkingImageSeconds, setCheckingImageSeconds] = useState(0);

  // Countdown timer for submit button "Checking Image... (X sec)" notice
  useEffect(() => {
    if (checkingImageSeconds <= 0) return;
    const timer = setTimeout(() => {
      setCheckingImageSeconds((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [checkingImageSeconds]);

  // Keep inspectingPost updated if posts state updates
  useEffect(() => {
    if (inspectingPost) {
      const updated = posts.find((p) => p.id === inspectingPost.id);
      if (updated) {
        setInspectingPost(updated);
      }
    }
  }, [posts]);

  // Polling hook: Poll GET /api/posts/:id/ai-status every 3 seconds for pending image checks
  useEffect(() => {
    const pendingPosts = posts.filter(
      (p) => p.latest_ai_check?.image_status === 'pending'
    );
    if (pendingPosts.length === 0) return;

    const intervalId = setInterval(async () => {
      for (const p of pendingPosts) {
        try {
          const res = await postService.getAiStatus(p.id);
          if (res && res.image_status && res.image_status !== 'pending') {
            setPosts((prevPosts) =>
              prevPosts.map((item) => {
                if (item.id === p.id) {
                  return {
                    ...item,
                    latest_ai_check: {
                      ...item.latest_ai_check,
                      ...res.combined_ai_check,
                      image_status: res.image_status,
                      image_error: res.image_error,
                      ocr_extracted_text: res.ocr_extracted_text,
                      ocr_confidence: res.ocr_confidence,
                      ocr_unreliable: res.ocr_unreliable,
                      spelling_issues: res.spelling_issues,
                      ocr_issues: res.ocr_issues || res.combined_ai_check?.ocr_issues || item.latest_ai_check?.ocr_issues || [],
                      ocr_doubts: res.ocr_doubts || res.combined_ai_check?.ocr_doubts || item.latest_ai_check?.ocr_doubts || [],
                      banned_words_found: res.banned_words_found,
                      missing_mandatory_phrases: res.missing_mandatory_phrases,
                      brand_identity_check: res.brand_identity_check,
                      logo_check: res.logo_check || res.combined_ai_check?.logo_check || null,
                      ai_provider: res.ai_provider || res.combined_ai_check?.ai_provider || 'gemini',
                      fallback_used: res.fallback_used ?? res.combined_ai_check?.fallback_used ?? false,
                      fallback_reason: res.fallback_reason || res.combined_ai_check?.fallback_reason || 'none',
                    },
                  };
                }
                return item;
              })
            );

            if (res.image_status === 'completed') {
              showToast(`Image check completed for "${p.title}"!`, 'success');
            } else if (res.image_status === 'failed') {
              showToast(`Image check failed for "${p.title}". You can retry.`, 'warning');
            }
          }
        } catch (err) {
          console.error(`Polling error for post ${p.id}:`, err);
        }
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [posts]);

  // Handler to retry image check only without re-running text check
  const handleRetryImageCheck = async (postId) => {
    setRetryingPosts((prev) => new Set(prev).add(postId));
    try {
      await postService.checkImage(postId);
      showToast('Retrying image check in background...', 'info');
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                latest_ai_check: {
                  ...p.latest_ai_check,
                  image_status: 'pending',
                  image_error: null,
                },
              }
            : p
        )
      );
    } catch (err) {
      showToast(err.response?.data?.message || 'Unable to retry image check.', 'error');
    } finally {
      setRetryingPosts((prev) => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
    }
  };

  useEffect(() => {
    fetchPosts();
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const data = await clientService.getClients();
      const list = data?.clients || [];
      setClients(list);
      if (list.length > 0 && !selectedClientId) {
        setSelectedClientId(String(list[0].id));
      }
    } catch {
      showToast('Unable to load the client list.', 'error');
    }
  };

  const fetchPosts = async () => {
    setIsLoadingPosts(true);
    try {
      const data = await postService.getPosts();
      const list = Array.isArray(data) ? data : data?.posts || [];
      setPosts(list);

      // Pre-load connected social accounts for any posts that are admin_approved
      const approvedPosts = list.filter((p) => p.status === 'admin_approved');
      for (const p of approvedPosts) {
        loadClientAccounts(p.client_id);
      }
    } catch {
      showToast('Unable to load posts. Please refresh the page.', 'error');
    } finally {
      setIsLoadingPosts(false);
    }
  };

  const loadClientAccounts = async (clientId) => {
    if (clientAccountsMap[clientId]) return;
    try {
      const data = await clientService.getClientSocialAccounts(clientId);
      setClientAccountsMap((prev) => ({
        ...prev,
        [clientId]: data?.social_accounts || [],
      }));
    } catch (err) {
      console.error(`Failed to fetch social accounts for client ${clientId}:`, err);
    }
  };

  const handleImageSelect = (file) => {
    setSelectedFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleRemoveImage = () => {
    setSelectedFile(null);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
  };

  // Submit New Post with strict validations
  const handleCreatePost = async (e) => {
    e.preventDefault();

    if (!selectedClientId) {
      showToast('Select a client for this post.', 'warning');
      return;
    }

    if (!title.trim()) {
      showToast('Enter a title for this post.', 'warning');
      return;
    }

    if (!caption.trim()) {
      showToast('Enter a caption for this post.', 'warning');
      return;
    }

    if (!selectedFile) {
      showToast('Upload an image for this post.', 'warning');
      return;
    }

    setCreatingPost(true);
    try {
      const formData = new FormData();
      formData.append('client_id', selectedClientId);
      formData.append('title', title.trim());
      formData.append('caption', caption.trim());
      formData.append('image', selectedFile);

      const response = await postService.createPost(formData);
      showToast('Text check passed! Poster ka text background mein scan ho raha hai...', 'success');

      // Prepend newly created post immediately into active list
      if (response?.post) {
        setPosts((prev) => [response.post, ...prev.filter((p) => p.id !== response.post.id)]);
      } else {
        fetchPosts();
      }

      // Clear form inputs keeping form interactive
      setTitle('');
      setCaption('');
      handleRemoveImage();

      // Trigger 15s indicator countdown on submit button
      setCheckingImageSeconds(15);
      setShowCreateModal(false);
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to create the post. Please try again.';
      showToast(msg, 'error');
    } finally {
      setCreatingPost(false);
    }
  };

  // Open Revision Modal
  const startRevising = (post) => {
    if (post.recheck_count >= 3 || post.manual_review_required) {
      showToast('You have used all 3 recheck attempts. The post will go directly to the Manager for review.', 'warning');
      return;
    }
    setEditingPost(post);
    setReviseTitle(post.title || '');
    setReviseCaption(post.caption || '');
    setReviseFile(null);
    setRevisePreview(null);
  };

  // Submit Revision
  const handleReviseSubmit = async (e) => {
    e.preventDefault();
    if (!editingPost) return;

    if (!reviseTitle.trim()) {
      showToast('The title cannot be empty.', 'warning');
      return;
    }

    if (!reviseCaption.trim()) {
      showToast('The caption cannot be empty.', 'warning');
      return;
    }

    setActiveActionId(`revise-${editingPost.id}`);
    try {
      const formData = new FormData();
      formData.append('title', reviseTitle.trim());
      formData.append('caption', reviseCaption.trim());
      if (reviseFile) {
        formData.append('image', reviseFile);
      }

      const response = await postService.revisePost(editingPost.id, formData);
      showToast('Revision submitted. Text check complete; image check in progress.', 'success');

      setEditingPost(null);
      setReviseTitle('');
      setReviseCaption('');
      setReviseFile(null);
      setRevisePreview(null);

      if (response?.post) {
        setPosts((prev) =>
          prev.map((p) => (p.id === response.post.id ? response.post : p))
        );
      } else {
        fetchPosts();
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to submit the revision.';
      showToast(msg, 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Submit to Manager for Review
  const handleSubmitForReview = async (postId) => {
    setActiveActionId(`submit-${postId}`);
    try {
      await postService.submitForReview(postId);
      showToast('Post sent to the Manager for review.', 'success');
      fetchPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to submit the post.';
      showToast(msg, 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Select Platform after Admin approval (Client-Scoped)
  const handleSelectPlatform = async (postId, clientId) => {
    const platform = selectedPlatforms[postId] || 'instagram';
    setActiveActionId(`platform-${postId}`);
    try {
      await postService.updatePlatform(postId, platform);
      showToast(`Platform "${platform}" selected. Paste the live post link.`, 'success');
      fetchPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to update the platform.';
      showToast(msg, 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Submit Live Published URL
  const handlePublishUrlSubmit = async (postId) => {
    const url = (liveUrls[postId] || '').trim();
    if (!url) {
      showToast('Enter the URL of the published post.', 'warning');
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      showToast('Enter a valid URL starting with http:// or https://.', 'warning');
      return;
    }

    setActiveActionId(`publish-${postId}`);
    try {
      await postService.updatePublishUrl(postId, url);
      showToast('Live link saved. The post workflow is complete.', 'success');
      fetchPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to save the live URL.';
      showToast(msg, 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  const handlePublishNow = async (postId) => {
    setActiveActionId(`publish-now-${postId}`);
    try {
      const res = await postService.publishNow(postId);
      if (res.success) {
        showToast('Post published successfully to connected platforms!', 'success');
      } else {
        const errorMsgs = (res.results || [])
          .filter((r) => !r.success)
          .map((r) => `${r.platform}: ${r.user_message || r.error}`)
          .join('; ');
        showToast(`Publish notice: ${errorMsgs || 'Some platforms failed or were skipped'}`, 'warning');
      }
      fetchPosts();
    } catch (err) {
      showToast(err.response?.data?.message || 'Publish failed.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  const handleScheduleSubmit = async (postId) => {
    const scheduledAt = scheduleDateMap[postId];
    if (!scheduledAt) {
      showToast('Select a schedule date and time first.', 'warning');
      return;
    }
    setActiveActionId(`schedule-${postId}`);
    try {
      await postService.schedulePost(postId, { scheduled_at: scheduledAt });
      showToast(`Post scheduled for ${new Date(scheduledAt).toLocaleString()}.`, 'success');
      setShowScheduleMap((prev) => ({ ...prev, [postId]: false }));
      fetchPosts();
    } catch (err) {
      showToast(err.response?.data?.message || 'Scheduling failed.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  const handleDeletePost = async (postId) => {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete Post #${postId}? This will remove the post, all AI and OCR scan results, and its image file.`
    );
    if (!confirmed) return;

    setActiveActionId(`delete-${postId}`);
    try {
      await postService.deletePost(postId);
      showToast(`Post #${postId} deleted successfully.`, 'success');

      // Remove from active state
      setPosts((prev) => prev.filter((p) => p.id !== postId));

      // Close drawer if this post is currently being inspected
      if (inspectingPost && inspectingPost.id === postId) {
        setInspectingPost(null);
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete post.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Counts for KPI Overview Metrics & Filter Tabs
  const actionNeededCount = useMemo(
    () => posts.filter((p) => ['ai_checking', 'changes_requested', 'failed'].includes(p.status)).length,
    [posts]
  );
  const inReviewCount = useMemo(
    () => posts.filter((p) => ['pending_manager', 'pending_admin'].includes(p.status)).length,
    [posts]
  );
  const readyCount = useMemo(
    () => posts.filter((p) => ['admin_approved', 'ready_to_publish'].includes(p.status)).length,
    [posts]
  );
  const scheduledLiveCount = useMemo(
    () => posts.filter((p) => ['scheduled', 'posted', 'completed'].includes(p.status)).length,
    [posts]
  );

  // Filtered Posts Calculation
  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      // 1. Client filter
      if (selectedClientFilter !== 'all' && String(post.client_id) !== String(selectedClientFilter)) {
        return false;
      }
      // 2. Status tab filter
      if (selectedTab === 'action_needed') {
        if (!['ai_checking', 'changes_requested', 'failed'].includes(post.status)) return false;
      } else if (selectedTab === 'in_review') {
        if (!['pending_manager', 'pending_admin'].includes(post.status)) return false;
      } else if (selectedTab === 'ready') {
        if (!['admin_approved', 'ready_to_publish'].includes(post.status)) return false;
      } else if (selectedTab === 'scheduled_live') {
        if (!['scheduled', 'posted', 'completed'].includes(post.status)) return false;
      }
      // 3. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const titleMatch = (post.title || '').toLowerCase().includes(q);
        const captionMatch = (post.caption || '').toLowerCase().includes(q);
        const clientMatch = (post.client_name || '').toLowerCase().includes(q);
        const idMatch = String(post.id).includes(q);
        if (!titleMatch && !captionMatch && !clientMatch && !idMatch) return false;
      }
      return true;
    });
  }, [posts, selectedTab, selectedClientFilter, searchQuery]);

  const isCreateFormValid =
    selectedClientId && title.trim().length > 0 && caption.trim().length > 0 && selectedFile !== null;

  // Render Workflow Action Buttons (Shared between Card & Inspection Drawer)
  const renderWorkflowActions = (post, isDrawer = false) => {
    const clientConnectedAccounts = clientAccountsMap[post.client_id] || [];

    return (
      <div className={`space-y-3 ${isDrawer ? 'w-full' : 'w-full'}`}>
        {/* Status: rejected */}
        {post.status === 'rejected' && (
          <div className="w-full text-xs text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-xl flex items-center gap-2">
            <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span><strong>Post Rejected:</strong> Reviewers rejected this post.</span>
          </div>
        )}

        {/* Status: changes_requested */}
        {post.status === 'changes_requested' && (
          <div className="w-full text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-xl flex items-center gap-2">
            <RotateCcw className="w-4 h-4 shrink-0 text-amber-600" />
            <span><strong>Changes Requested:</strong> Please revise copy/poster and resubmit for review.</span>
          </div>
        )}

        {/* Status: ai_checking or changes_requested -> Revise & Submit buttons */}
        {(post.status === 'ai_checking' || post.status === 'changes_requested') && (
          <div className="flex flex-wrap items-center gap-2 w-full">
            {!post.manual_review_required && post.recheck_count < 3 && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                onClick={() => startRevising(post)}
                disabled={activeActionId !== null}
              >
                Revise Post ({3 - post.recheck_count} left)
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              leftIcon={<Send className="w-3.5 h-3.5" />}
              loading={activeActionId === `submit-${post.id}`}
              disabled={activeActionId !== null}
              onClick={() => handleSubmitForReview(post.id)}
            >
              Submit for Manager Review
            </Button>
          </div>
        )}

        {/* Status: pending_manager */}
        {post.status === 'pending_manager' && (
          <div className="text-xs text-amber-800 font-medium flex items-center gap-2 bg-amber-50 border border-amber-200 px-3.5 py-2 rounded-xl">
            <Clock className="w-4 h-4 text-amber-600 animate-pulse" />
            <span><strong>Awaiting Manager Review:</strong> Sent to Manager inbox.</span>
          </div>
        )}

        {/* Status: pending_admin */}
        {post.status === 'pending_admin' && (
          <div className="text-xs text-purple-800 font-medium flex items-center gap-2 bg-purple-50 border border-purple-200 px-3.5 py-2 rounded-xl">
            <Clock className="w-4 h-4 text-purple-600 animate-pulse" />
            <span><strong>Manager Approved:</strong> Awaiting final Admin approval...</span>
          </div>
        )}

        {/* Status: admin_approved -> Select Platform */}
        {post.status === 'admin_approved' && (
          <div className="w-full space-y-2 p-3 rounded-2xl bg-sky-50/60 border border-sky-200">
            <div className="text-xs text-sky-900 font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-sky-600" />
              <span>Admin approved! Select this client's connected social account:</span>
            </div>

            {clientConnectedAccounts.length === 0 ? (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>No connected accounts found for this client. Please connect one in Client Details.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedPlatforms[post.id] || clientConnectedAccounts[0].platform}
                  onChange={(e) =>
                    setSelectedPlatforms({
                      ...selectedPlatforms,
                      [post.id]: e.target.value,
                    })
                  }
                  className="px-3 py-1.5 rounded-xl bg-white border border-[#E5E2DA] text-xs text-[#2B2A27] focus:outline-none focus:border-sky-500 cursor-pointer shadow-xs font-semibold"
                >
                  {clientConnectedAccounts.map((acc) => (
                    <option key={acc.id} value={acc.platform}>
                      {acc.platform.toUpperCase()}: {acc.account_name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="primary"
                  className="!bg-sky-600 hover:!bg-sky-700"
                  leftIcon={<Share2 className="w-3.5 h-3.5" />}
                  loading={activeActionId === `platform-${post.id}`}
                  disabled={activeActionId !== null}
                  onClick={() => handleSelectPlatform(post.id, post.client_id)}
                >
                  Confirm Platform
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Status: ready_to_publish */}
        {post.status === 'ready_to_publish' && (
          <div className="w-full space-y-3 p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Ready to Publish!
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="primary"
                  className="!bg-emerald-600 hover:!bg-emerald-700 font-semibold"
                  loading={activeActionId === `publish-now-${post.id}`}
                  disabled={activeActionId !== null}
                  onClick={() => handlePublishNow(post.id)}
                >
                  Abhi Post Karo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<Calendar className="w-3.5 h-3.5" />}
                  onClick={() =>
                    setShowScheduleMap((prev) => ({
                      ...prev,
                      [post.id]: !prev[post.id],
                    }))
                  }
                >
                  Schedule Karo
                </Button>
              </div>
            </div>

            {/* Schedule Inline Picker */}
            {showScheduleMap[post.id] && (
              <div className="p-3 rounded-xl bg-white border border-[#E5E2DA] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shadow-xs">
                <input
                  type="datetime-local"
                  value={scheduleDateMap[post.id] || ''}
                  onChange={(e) =>
                    setScheduleDateMap({
                      ...scheduleDateMap,
                      [post.id]: e.target.value,
                    })
                  }
                  className="px-3 py-1.5 rounded-lg border border-[#E5E2DA] bg-[#FAF9F6] text-xs font-mono"
                />
                <Button
                  size="sm"
                  variant="primary"
                  loading={activeActionId === `schedule-${post.id}`}
                  disabled={activeActionId !== null}
                  onClick={() => handleScheduleSubmit(post.id)}
                >
                  Confirm Schedule
                </Button>
              </div>
            )}

            {/* Manual link input */}
            <div className="pt-2 border-t border-emerald-200/60 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="url"
                value={liveUrls[post.id] || ''}
                onChange={(e) =>
                  setLiveUrls({ ...liveUrls, [post.id]: e.target.value })
                }
                placeholder="Ya manually link paste karo (e.g. https://instagram.com/p/...)"
                className="flex-1 px-3 py-1.5 rounded-xl bg-white border border-[#E5E2DA] text-xs text-[#2B2A27] placeholder-[#A8A29E] focus:outline-none focus:border-emerald-600 font-mono shadow-xs"
              />
              <Button
                size="sm"
                variant="outline"
                leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                loading={activeActionId === `publish-${post.id}`}
                disabled={activeActionId !== null}
                onClick={() => handlePublishUrlSubmit(post.id)}
              >
                Save Link
              </Button>
            </div>
          </div>
        )}

        {/* Status: scheduled */}
        {post.status === 'scheduled' && (
          <div className="w-full p-3.5 rounded-2xl bg-purple-50/70 border border-purple-200 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-700" />
              <span className="text-xs font-semibold text-purple-900">
                Scheduled for: <strong>{formatDate(post.scheduled_at)}</strong>
              </span>
            </div>
            <Button
              size="sm"
              variant="primary"
              loading={activeActionId === `publish-now-${post.id}`}
              disabled={activeActionId !== null}
              onClick={() => handlePublishNow(post.id)}
            >
              Abhi Post Karo
            </Button>
          </div>
        )}

        {/* Status: posted */}
        {post.status === 'posted' && (
          <div className="w-full p-3 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-xs text-emerald-900 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Successfully Published Live!</span>
            </div>
            {post.publish_results && (
              <div className="text-[11px] space-y-1 font-mono">
                {(typeof post.publish_results === 'string'
                  ? JSON.parse(post.publish_results)
                  : post.publish_results
                ).map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-bold uppercase text-stone-700">{r.platform}:</span>
                    {r.success ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 underline truncate max-w-xs font-semibold"
                      >
                        {r.url || 'View Live Post'}
                      </a>
                    ) : (
                      <span className="text-amber-700">{r.user_message || r.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status: failed */}
        {post.status === 'failed' && (
          <div className="w-full p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold">⚠️ Publishing Failed</span>
              <Button
                size="sm"
                variant="primary"
                className="!bg-rose-600 hover:!bg-rose-700"
                loading={activeActionId === `publish-now-${post.id}`}
                disabled={activeActionId !== null}
                onClick={() => handlePublishNow(post.id)}
              >
                Retry Publish
              </Button>
            </div>
          </div>
        )}

        {/* Status: completed */}
        {post.status === 'completed' && post.manual_publish_url && (
          <a
            href={post.manual_publish_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Published Live Post
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#2B2A27] pb-24">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Top Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-[#E5E2DA]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#2B2A27]">
                SMO Studio &amp; Post Hub
              </h1>
            </div>
            <p className="text-sm text-[#6B6A63] mt-1">
              Create client drafts, review Hindi/English spelling &amp; brand checks, and manage live social publishing.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchPosts}
              loading={isLoadingPosts}
              leftIcon={<RotateCcw className={`w-3.5 h-3.5 ${isLoadingPosts ? 'animate-spin' : ''}`} />}
              className="bg-white hover:bg-stone-50"
            >
              Refresh
            </Button>

            <Button
              variant="primary"
              size="md"
              leftIcon={<PlusCircle className="w-4 h-4" />}
              onClick={() => setShowCreateModal(true)}
              className="!bg-emerald-600 hover:!bg-emerald-700 shadow-sm font-semibold !rounded-xl"
            >
              + Create New Post
            </Button>
          </div>
        </div>

        {/* 4 Metric KPI Overview Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Posts */}
          <button
            onClick={() => setSelectedTab('all')}
            className={`p-4 rounded-3xl border transition-all text-left bg-white shadow-xs cursor-pointer ${
              selectedTab === 'all'
                ? 'border-emerald-600 ring-2 ring-emerald-500/20'
                : 'border-[#E5E2DA] hover:border-emerald-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#6B6A63]">Total Posts</span>
              <div className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center text-stone-600">
                <Layers className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-[#2B2A27]">{posts.length}</div>
            <p className="text-[11px] text-[#6B6A63] mt-1">Across all clients</p>
          </button>

          {/* Card 2: Action Needed */}
          <button
            onClick={() => setSelectedTab('action_needed')}
            className={`p-4 rounded-3xl border transition-all text-left bg-white shadow-xs cursor-pointer ${
              selectedTab === 'action_needed'
                ? 'border-amber-500 ring-2 ring-amber-500/20'
                : 'border-[#E5E2DA] hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Action Needed</span>
              <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                <AlertCircle className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-700">{actionNeededCount}</div>
            <p className="text-[11px] text-amber-800/80 mt-1">Drafts, revisions &amp; check</p>
          </button>

          {/* Card 3: In Review */}
          <button
            onClick={() => setSelectedTab('in_review')}
            className={`p-4 rounded-3xl border transition-all text-left bg-white shadow-xs cursor-pointer ${
              selectedTab === 'in_review'
                ? 'border-purple-600 ring-2 ring-purple-500/20'
                : 'border-[#E5E2DA] hover:border-purple-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800">In Review</span>
              <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-purple-700">{inReviewCount}</div>
            <p className="text-[11px] text-purple-800/80 mt-1">Manager / Admin approval</p>
          </button>

          {/* Card 4: Approved & Live */}
          <button
            onClick={() => setSelectedTab('ready')}
            className={`p-4 rounded-3xl border transition-all text-left bg-white shadow-xs cursor-pointer ${
              selectedTab === 'ready' || selectedTab === 'scheduled_live'
                ? 'border-emerald-600 ring-2 ring-emerald-500/20'
                : 'border-[#E5E2DA] hover:border-emerald-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Ready &amp; Live</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700">
              {readyCount + scheduledLiveCount}
            </div>
            <p className="text-[11px] text-emerald-800/80 mt-1">Approved, scheduled or live</p>
          </button>
        </div>

        {/* Filter, Tabs & Search Bar */}
        <div className="bg-white rounded-3xl p-4 border border-[#E5E2DA] shadow-xs space-y-3">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
              <button
                onClick={() => setSelectedTab('all')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  selectedTab === 'all'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-[#6B6A63] hover:text-[#2B2A27] hover:bg-stone-100'
                }`}
              >
                <span>All Posts</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    selectedTab === 'all' ? 'bg-emerald-700 text-white' : 'bg-stone-200 text-stone-700'
                  }`}
                >
                  {posts.length}
                </span>
              </button>

              <button
                onClick={() => setSelectedTab('action_needed')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  selectedTab === 'action_needed'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-[#6B6A63] hover:text-[#2B2A27] hover:bg-stone-100'
                }`}
              >
                <span>Action Needed</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    selectedTab === 'action_needed' ? 'bg-amber-700 text-white' : 'bg-stone-200 text-stone-700'
                  }`}
                >
                  {actionNeededCount}
                </span>
              </button>

              <button
                onClick={() => setSelectedTab('in_review')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  selectedTab === 'in_review'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-[#6B6A63] hover:text-[#2B2A27] hover:bg-stone-100'
                }`}
              >
                <span>In Review</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    selectedTab === 'in_review' ? 'bg-purple-700 text-white' : 'bg-stone-200 text-stone-700'
                  }`}
                >
                  {inReviewCount}
                </span>
              </button>

              <button
                onClick={() => setSelectedTab('ready')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  selectedTab === 'ready'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-[#6B6A63] hover:text-[#2B2A27] hover:bg-stone-100'
                }`}
              >
                <span>Ready to Publish</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    selectedTab === 'ready' ? 'bg-sky-700 text-white' : 'bg-stone-200 text-stone-700'
                  }`}
                >
                  {readyCount}
                </span>
              </button>

              <button
                onClick={() => setSelectedTab('scheduled_live')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  selectedTab === 'scheduled_live'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'text-[#6B6A63] hover:text-[#2B2A27] hover:bg-stone-100'
                }`}
              >
                <span>Scheduled &amp; Live</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    selectedTab === 'scheduled_live' ? 'bg-emerald-800 text-white' : 'bg-stone-200 text-stone-700'
                  }`}
                >
                  {scheduledLiveCount}
                </span>
              </button>
            </div>

            {/* Client Filter & Search Bar */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* Client Filter Dropdown */}
              <div className="relative min-w-[160px] flex-1 sm:flex-initial">
                <select
                  value={selectedClientFilter}
                  onChange={(e) => setSelectedClientFilter(e.target.value)}
                  className="w-full pl-8 pr-7 py-2 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-xs font-semibold text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white cursor-pointer shadow-xs"
                >
                  <option value="all">All Clients ({clients.length})</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Building2 className="w-3.5 h-3.5 text-stone-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {/* Search Bar */}
              <div className="relative min-w-[200px] flex-1 sm:flex-initial">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search title, caption, ID..."
                  className="w-full pl-8 pr-7 py-2 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-xs text-[#2B2A27] placeholder-[#A8A29E] focus:outline-none focus:border-emerald-600 focus:bg-white shadow-xs"
                />
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer text-xs"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Posts Grid Feed */}
        {isLoadingPosts ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="bg-white rounded-3xl p-5 border border-[#E5E2DA] animate-pulse space-y-4 shadow-xs"
              >
                <div className="flex justify-between items-center">
                  <div className="h-4 bg-stone-200 rounded-md w-28"></div>
                  <div className="h-5 bg-stone-200 rounded-full w-24"></div>
                </div>
                <div className="flex gap-4">
                  <div className="w-24 h-24 bg-stone-200 rounded-2xl shrink-0"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-stone-200 rounded w-3/4"></div>
                    <div className="h-3 bg-stone-200 rounded w-full"></div>
                    <div className="h-3 bg-stone-200 rounded w-1/2"></div>
                  </div>
                </div>
                <div className="h-9 bg-stone-100 rounded-xl"></div>
              </div>
            ))}
          </div>
        ) : filteredPosts.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-3xl p-12 border border-[#E5E2DA] text-center shadow-xs max-w-lg mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 mx-auto flex items-center justify-center text-emerald-600 mb-3">
              <Sparkles className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-[#2B2A27]">No posts found</h4>
            <p className="text-xs text-[#6B6A63] mt-1 max-w-xs mx-auto">
              {searchQuery || selectedClientFilter !== 'all' || selectedTab !== 'all'
                ? 'No posts match your active search or filters.'
                : 'Get started by creating your first campaign post.'}
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              {searchQuery || selectedClientFilter !== 'all' || selectedTab !== 'all' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedTab('all');
                    setSelectedClientFilter('all');
                    setSearchQuery('');
                  }}
                >
                  Reset Filters
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                leftIcon={<PlusCircle className="w-4 h-4" />}
                onClick={() => setShowCreateModal(true)}
              >
                + Create New Post
              </Button>
            </div>
          </div>
        ) : (
          /* Responsive 2-Column Grid of Compact Post Cards */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {filteredPosts.map((post) => {
              const rawImg = post.image_path || post.latest_revision?.image_path;
              const imgSrc = rawImg ? `${SERVER_URL}/${rawImg}` : null;
              const aiReport = post.latest_ai_check;
              const spellingIssues = aiReport?.spelling_issues || [];
              const bannedWords = aiReport?.banned_words_found || [];
              const missingMandatory = aiReport?.missing_mandatory_phrases || [];
              const grammarCount = (aiReport?.grammar_suggestions || []).filter((g) => g.type !== 'grammar_error').length;
              const hasKeyError = Boolean(aiReport?.key_error);

              return (
                <div
                  key={post.id}
                  className="bg-white rounded-3xl border border-[#E5E2DA] hover:border-emerald-300 transition-all shadow-xs hover:shadow-md flex flex-col justify-between overflow-hidden group"
                >
                  {/* Card Header */}
                  <div className="p-4 border-b border-[#E5E2DA] bg-[#FAF9F6]/50">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[#2B2A27] bg-white border border-[#E5E2DA] px-2 py-0.5 rounded-lg font-mono shadow-2xs">
                          #{post.id}
                        </span>
                        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-emerald-600" />
                          <span className="truncate max-w-[140px]">{post.client_name || 'Client'}</span>
                        </span>
                        <span className="text-[11px] text-[#6B6A63] flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3 text-[#A8A29E]" />
                          {formatDate(post.created_at)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {post.platform && (
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-stone-100 text-[#2B2A27] uppercase tracking-wider border border-[#E5E2DA]">
                            {post.platform}
                          </span>
                        )}
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${getStatusBadgeStyle(
                            post.status
                          )}`}
                        >
                          {post.status?.replace(/_/g, ' ')}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePost(post.id);
                          }}
                          disabled={activeActionId !== null}
                          title={`Delete Post #${post.id}`}
                          className="p-1 rounded-lg hover:bg-rose-50 text-stone-400 hover:text-rose-600 transition-colors cursor-pointer ml-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Card Body: Thumbnail + Content */}
                  <div className="p-4 flex-1 space-y-3">
                    <div className="flex items-start gap-3.5">
                      {/* Clickable Thumbnail */}
                      {imgSrc ? (
                        <div
                          onClick={() => navigate(`/posts/${post.id}/inspection`)}
                          className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border border-[#E5E2DA] bg-stone-50 shrink-0 relative cursor-pointer group/thumb hover:ring-2 hover:ring-emerald-500 transition-all flex items-center justify-center shadow-xs"
                          title="Click to inspect poster on dedicated full page"
                        >
                          <img
                            src={imgSrc}
                            alt={post.title}
                            className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.parentElement?.querySelector('.thumb-fallback');
                              if (fallback) fallback.classList.remove('hidden');
                            }}
                          />
                          <div className="thumb-fallback hidden absolute inset-0 flex flex-col items-center justify-center bg-stone-100 text-stone-400">
                            <Layers className="w-5 h-5 mb-0.5 text-stone-400" />
                            <span className="text-[9px] font-mono text-stone-500">Image</span>
                          </div>
                          <div className="absolute inset-0 bg-stone-900/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
                            <Eye className="w-5 h-5 drop-shadow" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border border-dashed border-[#E5E2DA] bg-stone-50 shrink-0 flex items-center justify-center text-stone-400">
                          <Layers className="w-6 h-6" />
                        </div>
                      )}

                      {/* Title & Caption */}
                      <div className="flex-1 min-w-0">
                        <h4
                          onClick={() => navigate(`/posts/${post.id}/inspection`)}
                          className="text-sm font-bold text-[#2B2A27] truncate hover:text-emerald-700 cursor-pointer transition-colors"
                        >
                          {post.title}
                        </h4>
                        <p className="text-xs text-[#6B6A63] line-clamp-2 leading-relaxed mt-1">
                          {post.caption || <span className="italic text-[#A8A29E]">No caption provided</span>}
                        </p>

                        {/* Quick AI Health Chips */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-2">
                          {aiReport?.image_status === 'pending' && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-[10px] font-bold flex items-center gap-1 border border-amber-200">
                              <Clock className="w-3 h-3 animate-spin text-amber-600" />
                              AI Scanning...
                            </span>
                          )}

                          {hasKeyError && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
                              ⚠️ Fallback Active
                            </span>
                          )}

                          {spellingIssues.length > 0 ? (
                            <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200">
                              ⚠️ {spellingIssues.length} Spell Check
                            </span>
                          ) : (
                            aiReport && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Clean
                              </span>
                            )
                          )}

                          {grammarCount > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-200">
                              💡 {grammarCount} Grammar
                            </span>
                          )}

                          {bannedWords.length > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-bold border border-rose-300">
                              🚫 Banned Word
                            </span>
                          )}

                          <span className="text-[10px] text-[#A8A29E] font-mono ml-auto">
                            Rechecks: {post.recheck_count}/3
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Inspection Trigger Button */}
                    <button
                      type="button"
                      onClick={() => navigate(`/posts/${post.id}/inspection`)}
                      className="w-full py-2 px-3 rounded-xl bg-stone-50 hover:bg-stone-100 border border-[#E5E2DA] text-xs font-semibold text-[#2B2A27] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-emerald-600" />
                      <span>View AI &amp; OCR Inspection Details</span>
                      <ChevronRight className="w-3.5 h-3.5 text-stone-400 ml-auto" />
                    </button>
                  </div>

                  {/* Card Footer: Contextual Workflow Actions */}
                  <div className="p-4 border-t border-[#E5E2DA] bg-white">
                    {renderWorkflowActions(post, false)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* RIGHT SLIDE-OVER DRAWER: AI & OCR INSPECTION DETAILS */}
        {inspectingPost && (
          <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex justify-end">
            <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col border-l border-[#E5E2DA] overflow-hidden animate-in slide-in-from-right duration-200">
              {/* Drawer Header */}
              <div className="p-5 border-b border-[#E5E2DA] flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold text-[#2B2A27] bg-stone-100 border border-[#E5E2DA] px-2.5 py-1 rounded-lg font-mono">
                    #{inspectingPost.id}
                  </span>
                  <div>
                    <h3 className="font-bold text-[#2B2A27] text-base leading-tight">
                      AI Inspection &amp; Quality Report
                    </h3>
                    <span className="text-xs text-emerald-800 font-semibold flex items-center gap-1 mt-0.5">
                      <Building2 className="w-3 h-3 text-emerald-600" />
                      {inspectingPost.client_name || 'Client'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${getStatusBadgeStyle(
                      inspectingPost.status
                    )}`}
                  >
                    {inspectingPost.status?.replace(/_/g, ' ')}
                  </span>
                  <button
                    onClick={() => setInspectingPost(null)}
                    className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Drawer Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#FAF9F6]">
                {/* Poster Image + OCR Bounding Boxes */}
                {inspectingPost.image_path || inspectingPost.latest_revision?.image_path ? (
                  <div className="bg-white rounded-3xl p-4 border border-[#E5E2DA] shadow-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-2.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#2B2A27] flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                        Poster OCR Visual Analysis
                      </span>
                      {inspectingPost.latest_ai_check?.ocr_confidence > 0 && (
                        <span className="text-[11px] font-mono text-emerald-800 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                          Confidence: {Math.round(inspectingPost.latest_ai_check.ocr_confidence)}%
                        </span>
                      )}
                    </div>

                    {inspectingPost.latest_ai_check?.image_status === 'pending' ? (
                      <ImageCheckSkeleton status="pending" />
                    ) : inspectingPost.latest_ai_check?.image_status === 'failed' ? (
                      <ImageCheckSkeleton
                        status="failed"
                        errorMessage={inspectingPost.latest_ai_check?.image_error}
                        onRetry={() => handleRetryImageCheck(inspectingPost.id)}
                        isRetrying={retryingPosts.has(inspectingPost.id)}
                      />
                    ) : (
                      <AnnotatedPosterOCR
                        imgSrc={`${SERVER_URL}/${inspectingPost.image_path || inspectingPost.latest_revision?.image_path}`}
                        boxes={inspectingPost.latest_ai_check?.ocr_issues || []}
                        ocrConfidence={inspectingPost.latest_ai_check?.ocr_confidence}
                        rawOcrText={inspectingPost.latest_ai_check?.ocr_extracted_text}
                        realErrors={(inspectingPost.latest_ai_check?.spelling_issues || []).filter(
                          (s) => s.source === 'image'
                        )}
                        ocrEngine={inspectingPost.latest_ai_check?.ocr_engine}
                        fallbackUsed={inspectingPost.latest_ai_check?.fallback_used}
                      />
                    )}
                    {/* Dedicated Brand Logo Verification Card */}
                    <div className="pt-2">
                      <LogoCheckCard
                        logoCheck={inspectingPost.latest_ai_check?.logo_check}
                        aiProvider={inspectingPost.latest_ai_check?.ai_provider}
                        fallbackUsed={inspectingPost.latest_ai_check?.fallback_used}
                        referenceLogoUrl={inspectingPost.reference_logo_url ? `${SERVER_URL}/${inspectingPost.reference_logo_url.replace(/^[/\\]+/, '')}` : null}
                      />
                    </div>
                  </div>
                ) : null}

                {/* Campaign Title & Caption */}
                <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#6B6A63]">
                    Post Title &amp; Copy
                  </span>
                  <h4 className="text-base font-bold text-[#2B2A27]">{inspectingPost.title}</h4>
                  <div className="p-3.5 rounded-2xl bg-[#FAF9F6] border border-[#E5E2DA] text-xs text-[#2B2A27] whitespace-pre-wrap leading-relaxed font-sans">
                    {inspectingPost.caption || <span className="italic text-[#A8A29E]">No caption provided.</span>}
                  </div>
                  <div className="text-[11px] text-[#6B6A63] text-right font-mono">
                    {inspectingPost.caption?.length || 0} characters
                  </div>
                </div>

                {/* Full AI Quality & Brand Rules Report */}
                {inspectingPost.latest_ai_check && (
                  <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-4">
                    <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-3">
                      <span className="text-xs font-bold text-[#2B2A27] uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                        AI &amp; Brand Rules Deep Scan
                      </span>
                      <span className="text-[11px] text-[#6B6A63] font-mono">
                        Rechecks: {inspectingPost.recheck_count}/3
                      </span>
                    </div>

                    {/* KEY ERROR / FALLBACK NOTIFICATION BANNER */}
                    {inspectingPost.latest_ai_check.key_error && (
                      <div className="p-3 bg-amber-50 border-l-4 border-amber-500 rounded-xl text-amber-900 text-xs flex items-start justify-between gap-2 shadow-xs">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-amber-900">
                              ⚠️ {inspectingPost.latest_ai_check.key_error.user_message}
                            </p>
                            <p className="text-[11px] text-amber-700 mt-0.5">
                              Service: {inspectingPost.latest_ai_check.key_error.service} | Status: Fallback Active
                            </p>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-mono font-bold whitespace-nowrap">
                          {inspectingPost.latest_ai_check.key_error.code}
                        </span>
                      </div>
                    )}

                    {/* GEMINI KEY EXPIRED ALERT */}
                    {inspectingPost.latest_ai_check.grammar_suggestions?.some((g) => g.type === 'grammar_error') && (
                      <div className="p-2.5 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span><strong>Grammar Check unavailable:</strong> Gemini Key expired / invalid</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-rose-200 text-rose-900 font-mono font-bold">
                          GEMINI_KEY_EXPIRED
                        </span>
                      </div>
                    )}

                    {/* GRAMMAR SUGGESTIONS (Gemini Powered) */}
                    {inspectingPost.latest_ai_check.grammar_suggestions?.filter((g) => g.type !== 'grammar_error').length > 0 && (
                      <div className="space-y-2">
                        <span className="text-xs font-bold text-purple-800 bg-purple-100 border border-purple-200 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-purple-600" />
                          Grammar Suggestions
                        </span>
                        <div className="space-y-1.5">
                          {inspectingPost.latest_ai_check.grammar_suggestions
                            .filter((g) => g.type !== 'grammar_error')
                            .map((g, idx) => (
                              <div
                                key={idx}
                                className="text-xs p-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 space-y-1"
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="line-through text-rose-700 font-mono font-medium">
                                    {g.original}
                                  </span>
                                  <span className="text-purple-600 font-bold">→</span>
                                  <span className="text-emerald-700 font-semibold font-mono">
                                    {g.suggestion}
                                  </span>
                                </div>
                                {g.reason && (
                                  <p className="text-[11px] text-purple-800 font-sans mt-0.5">
                                    {g.reason}
                                  </p>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* BANNED WORDS ALERT */}
                    {(inspectingPost.latest_ai_check.banned_words_found || []).length > 0 && (
                      <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                        <AlertOctagon className="w-4 h-4 shrink-0 text-rose-600" />
                        <span>
                          <strong>Banned Brand Words Found:</strong>{' '}
                          {inspectingPost.latest_ai_check.banned_words_found.join(', ')}
                        </span>
                      </div>
                    )}

                    {/* MISSING MANDATORY PHRASE ALERT */}
                    {(inspectingPost.latest_ai_check.missing_mandatory_phrases || []).length > 0 && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                        <span>
                          <strong>Missing Required Phrase:</strong>{' '}
                          {inspectingPost.latest_ai_check.missing_mandatory_phrases.join(', ')}
                        </span>
                      </div>
                    )}

                    {/* BRAND IDENTITY ALERTS */}
                    {inspectingPost.latest_ai_check.brand_identity_check?.possible_brand_name_error && (
                      <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                        <AlertOctagon className="w-4 h-4 shrink-0 text-rose-600" />
                        <span>
                          <strong>Brand Name Mismatch:</strong>{' '}
                          {inspectingPost.latest_ai_check.brand_identity_check.possible_brand_name_error}
                        </span>
                      </div>
                    )}

                    {(inspectingPost.latest_ai_check.brand_identity_check?.phone_verification || [])
                      .filter((p) => p.status !== 'clean')
                      .map((pv, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2"
                        >
                          <Phone className="w-4 h-4 shrink-0 text-rose-600" />
                          <span>
                            <strong>Phone Mismatch Alert:</strong> {pv.message}
                          </span>
                        </div>
                      ))}

                    {/* SPELLING ISSUES (Devanagari + Latin) */}
                    {(inspectingPost.latest_ai_check.spelling_issues || []).length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs text-rose-700 font-bold">
                          Spelling issues found ({inspectingPost.latest_ai_check.spelling_issues.length}):
                        </p>
                        <div className="space-y-1.5">
                          {inspectingPost.latest_ai_check.spelling_issues.map((issue, idx) => (
                            <div
                              key={idx}
                              className="text-xs px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between"
                            >
                              <div className="flex items-center gap-2">
                                {issue.script && (
                                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-stone-200 text-stone-700">
                                    {issue.script}
                                  </span>
                                )}
                                <span className="line-through font-mono font-medium text-rose-700">
                                  {issue.word}
                                </span>
                              </div>
                              {issue.suggestions?.length > 0 && (
                                <span className="text-emerald-700 font-medium">
                                  Suggest: {issue.suggestions.slice(0, 3).join(', ')}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-800 flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 rounded-xl font-medium">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                        <span>No Hindi or English spelling issues found. Whitelisted words are accepted.</span>
                      </p>
                    )}

                    {/* Manual Review Alert */}
                    {inspectingPost.manual_review_required && (
                      <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-xl font-semibold">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                        <span>AI recheck limit reached (3/3). The Manager will review this post manually.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Workflow Actions Section Inside Drawer */}
                <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#6B6A63] block">
                    Workflow Actions
                  </span>
                  {renderWorkflowActions(inspectingPost, true)}
                </div>
              </div>

              {/* Drawer Sticky Footer */}
              <div className="p-4 border-t border-[#E5E2DA] bg-white flex items-center justify-between gap-3 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="!text-rose-600 !border-rose-200 hover:!bg-rose-50 font-semibold"
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                  loading={activeActionId === `delete-${inspectingPost.id}`}
                  disabled={activeActionId !== null}
                  onClick={() => handleDeletePost(inspectingPost.id)}
                >
                  Delete Post
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInspectingPost(null)}
                >
                  Close Drawer
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: CREATE NEW POST */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white border border-[#E5E2DA] rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl my-8 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <PlusCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#2B2A27] text-base">Create New Client Post</h3>
                    <p className="text-xs text-[#6B6A63]">Draft campaign visual &amp; copy for AI scanning</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreatePost} className="space-y-4">
                {/* 1. SELECT CLIENT */}
                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Select Client <span className="text-emerald-600 font-bold">*</span></span>
                  </label>
                  {clients.length === 0 ? (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      No active clients found. Ask an Admin to add a client first.
                    </div>
                  ) : (
                    <select
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] font-semibold focus:outline-none focus:border-emerald-600 focus:bg-white cursor-pointer shadow-xs"
                    >
                      <option value="">-- Choose a Client --</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.is_active ? '' : '(Inactive)'}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 2. TITLE FIELD */}
                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                    Campaign / Post Title <span className="text-emerald-600 font-bold">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Diwali Fitness Promo / योग शिविर 2026"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white transition-all shadow-xs"
                  />
                </div>

                {/* 3. IMAGE UPLOAD */}
                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                    Poster Image <span className="text-emerald-600 font-bold">*</span>
                  </label>
                  <ImageUpload
                    onImageSelect={handleImageSelect}
                    previewUrl={imagePreview}
                    onRemove={handleRemoveImage}
                    onError={(err) => showToast(err, 'error')}
                  />
                </div>

                {/* 4. CAPTION FIELD */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider">
                      Caption &amp; Post Copy <span className="text-emerald-600 font-bold">*</span>
                    </label>
                    <span className="text-[11px] text-[#6B6A63] font-mono">
                      {caption.trim().length} chars
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Spelling checks support English or Hindi (Devanagari script), not Hinglish."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-[#2B2A27] placeholder-[#A8A29E] text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 focus:bg-white focus:outline-none resize-y transition-all shadow-xs"
                  />
                </div>

                {/* Submit & Cancel Buttons */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={creatingPost}
                    disabled={!isCreateFormValid || creatingPost}
                    rightIcon={<Send className="w-4 h-4" />}
                    size="md"
                    className="!bg-emerald-600 hover:!bg-emerald-700 !rounded-xl font-semibold"
                  >
                    {checkingImageSeconds > 0
                      ? `Checking Image... (${checkingImageSeconds} sec)`
                      : 'Create & Run AI Quality Check'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: REVISE POST */}
        {editingPost && (
          <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white border border-[#E5E2DA] rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-3">
                <h3 className="font-bold text-[#2B2A27] text-base">
                  Revise Post #{editingPost.id} (Attempt {editingPost.recheck_count + 1}/3)
                </h3>
                <button
                  onClick={() => setEditingPost(null)}
                  className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleReviseSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                    Post / Campaign Title
                  </label>
                  <input
                    type="text"
                    value={reviseTitle}
                    onChange={(e) => setReviseTitle(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:border-emerald-600 focus:bg-white focus:outline-none"
                  />
                </div>

                <ImageUpload
                  onImageSelect={(file) => {
                    setReviseFile(file);
                    setRevisePreview(URL.createObjectURL(file));
                  }}
                  previewUrl={revisePreview}
                  onRemove={() => {
                    setReviseFile(null);
                    setRevisePreview(null);
                  }}
                  onError={(err) => showToast(err, 'error')}
                />

                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                    Updated Caption
                  </label>
                  <textarea
                    rows={4}
                    value={reviseCaption}
                    onChange={(e) => setReviseCaption(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-[#2B2A27] text-sm focus:border-emerald-600 focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingPost(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={activeActionId === `revise-${editingPost.id}`}
                    disabled={activeActionId !== null || !reviseCaption.trim()}
                    leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                  >
                    Recheck &amp; Save Revision
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

export default SMODashboard;
