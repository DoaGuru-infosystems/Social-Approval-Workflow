import React, { useState, useEffect } from 'react';
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
  Quote,
  Building2,
  AlertOctagon,
  Tag,
  Phone,
  MapPin,
} from 'lucide-react';
import ImageCheckSkeleton from '../components/ImageCheckSkeleton';
import AnnotatedPosterOCR from '../components/AnnotatedPosterOCR';

const SMODashboard = () => {
  const { showToast } = useToast();

  // Multi-Client State
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

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

  const isCreateFormValid =
    selectedClientId && title.trim().length > 0 && caption.trim().length > 0 && selectedFile !== null;

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#2B2A27] pb-16">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#2B2A27]">SMO Studio & Post Hub</h1>
            <p className="text-sm text-[#6B6A63] mt-0.5">
              Create client drafts, review Hindi and English spelling and brand checks, and manage live publishing.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPosts}
            loading={isLoadingPosts}
            leftIcon={<RotateCcw className={`w-3.5 h-3.5 ${isLoadingPosts ? 'animate-spin' : ''}`} />}
          >
            Refresh Posts
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Post Creation Form (5 cols) */}
          <div className="lg:col-span-5">
            <div className="bg-[#FFFFFF] rounded-3xl p-6 border border-[#E5E2DA] shadow-xs sticky top-24">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <PlusCircle className="w-4 h-4" />
                </div>
                <h2 className="text-lg font-bold text-[#2B2A27]">New Client Campaign Post</h2>
              </div>

              <form onSubmit={handleCreatePost} className="space-y-4">
                {/* 1. SELECT CLIENT DROPDOWN (Mandatory First) */}
                <div>
                  <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Select Client <span className="text-emerald-600 font-bold">*</span></span>
                  </label>
                  {clients.length === 0 ? (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      No active clients were found. Ask an Admin to add a client first.
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
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:outline-none focus:border-emerald-600 focus:bg-white transition-all"
                  />
                </div>

                {/* 3. IMAGE UPLOAD */}
                <ImageUpload
                  onImageSelect={handleImageSelect}
                  previewUrl={imagePreview}
                  onRemove={handleRemoveImage}
                  onError={(err) => showToast(err, 'error')}
                />

                {/* 4. CAPTION FIELD */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider">
                      Caption & Post Copy <span className="text-emerald-600 font-bold">*</span>
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
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-[#2B2A27] placeholder-[#A8A29E] text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 focus:bg-white focus:outline-none resize-y transition-all"
                  />
                </div>

                <Button
                  type="submit"
                  loading={creatingPost}
                  disabled={!isCreateFormValid || creatingPost}
                  rightIcon={<Send className="w-4 h-4" />}
                  size="lg"
                  className="w-full !rounded-xl"
                >
                  {checkingImageSeconds > 0
                    ? `Checking Image... (${checkingImageSeconds} sec)`
                    : 'Create & Run AI Quality Check'}
                </Button>
              </form>
            </div>
          </div>

          {/* Posts Feed & Workflow Actions (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#2B2A27] text-base">Your Active Posts</h3>
              <span className="text-xs text-[#6B6A63] font-mono">{posts.length} posts</span>
            </div>

            {/* Skeleton / Loading State */}
            {isLoadingPosts ? (
              <div className="space-y-4">
                {[1, 2].map((n) => (
                  <div
                    key={n}
                    className="bg-stone-100 rounded-3xl p-6 border border-[#E5E2DA] animate-pulse space-y-4"
                  >
                    <div className="flex justify-between items-center">
                      <div className="h-4 bg-stone-200 rounded w-24"></div>
                      <div className="h-4 bg-stone-200 rounded w-28"></div>
                    </div>
                    <div className="h-44 bg-stone-200 rounded-2xl"></div>
                    <div className="h-4 bg-stone-200 rounded w-3/4"></div>
                    <div className="h-3 bg-stone-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : posts.length === 0 ? (
              /* Empty State */
              <div className="bg-[#FFFFFF] rounded-3xl p-12 border border-[#E5E2DA] text-center shadow-xs">
                <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-[#E5E2DA] mx-auto flex items-center justify-center text-[#6B6A63] mb-3">
                  <Sparkles className="w-7 h-7 text-emerald-600" />
                </div>
                <h4 className="text-base font-semibold text-[#2B2A27]">No posts have been created yet</h4>
                <p className="text-xs text-[#6B6A63] mt-1 max-w-sm mx-auto">
                  Select a client in the form and submit your first post.
                </p>
              </div>
            ) : (
              posts.map((post) => {
                const rawImg = post.image_path || post.latest_revision?.image_path;
                const imgSrc = rawImg ? `${SERVER_URL}/${rawImg}` : null;
                const aiReport = post.latest_ai_check;
                const spellingIssues = aiReport?.spelling_issues || [];
                const bannedWords = aiReport?.banned_words_found || [];
                const missingMandatory = aiReport?.missing_mandatory_phrases || [];
                const ocrText = aiReport?.ocr_extracted_text;
                const clientConnectedAccounts = clientAccountsMap[post.client_id] || [];

                return (
                  <div
                    key={post.id}
                    className="bg-[#FFFFFF] rounded-3xl border border-[#E5E2DA] overflow-hidden shadow-xs"
                  >
                    {/* Card Header: Client + Title + Status */}
                    <div className="p-4 border-b border-[#E5E2DA] space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#2B2A27] bg-stone-100 border border-[#E5E2DA] px-2.5 py-0.5 rounded-md font-mono">
                            #{post.id}
                          </span>
                          <span className="text-xs text-[#6B6A63] flex items-center gap-1">
                            <Clock className="w-3 h-3 text-[#A8A29E]" />
                            {formatDate(post.created_at)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {post.platform && (
                            <span className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-stone-100 text-[#2B2A27] capitalize border border-[#E5E2DA]">
                              {post.platform}
                            </span>
                          )}
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${getStatusBadgeStyle(
                              post.status
                            )}`}
                          >
                            {post.status?.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>

                      {/* Client Badge & Campaign Title */}
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {post.client_name || 'Client'}
                        </span>
                        <h4 className="text-sm font-bold text-[#2B2A27] line-clamp-1">
                          {post.title}
                        </h4>
                      </div>
                    </div>

                    {/* Content & Visual */}
                    <div className="p-5 space-y-4">
                      {imgSrc && (
                        <div className="rounded-2xl overflow-hidden bg-stone-50 border border-[#E5E2DA] max-h-72 flex items-center justify-center p-1">
                          <img
                            src={imgSrc}
                            alt="Post visual"
                            className="w-full h-full max-h-72 object-contain rounded-xl"
                          />
                        </div>
                      )}

                      <div>
                        <span className="text-[11px] text-[#6B6A63] uppercase tracking-wider font-semibold block mb-1">
                          Post Caption:
                        </span>
                        <p className="text-sm text-[#2B2A27] leading-relaxed whitespace-pre-wrap">
                          {post.caption || <span className="italic text-[#A8A29E]">No caption</span>}
                        </p>
                      </div>

                      {/* AI Quality & Brand Rules Box */}
                      {aiReport && (
                        <div className="rounded-2xl p-4 bg-[#FAF9F6] border border-[#E5E2DA] space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                              Hindi and English AI & Brand Rules Check
                            </span>
                            <span className="text-[11px] text-[#6B6A63] font-mono">
                              Rechecks: {post.recheck_count}/3
                            </span>
                          </div>

                          {/* KEY ERROR / FALLBACK NOTIFICATION BANNER */}
                          {aiReport.key_error && (
                            <div className="p-3 bg-amber-50 border-l-4 border-amber-500 rounded-xl text-amber-900 text-xs flex items-start justify-between gap-2 shadow-sm">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="font-semibold text-amber-900">
                                    ⚠️ {aiReport.key_error.user_message}
                                  </p>
                                  <p className="text-[11px] text-amber-700 mt-0.5">
                                    Service: {aiReport.key_error.service} | Status: Fallback Active
                                  </p>
                                </div>
                              </div>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-mono font-bold whitespace-nowrap">
                                {aiReport.key_error.code}
                              </span>
                            </div>
                          )}

                          {/* GEMINI KEY EXPIRED / ERROR RED CHIP */}
                          {aiReport.grammar_suggestions && aiReport.grammar_suggestions.some((g) => g.type === 'grammar_error') && (
                            <div className="p-2.5 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                                <span><strong>Grammar Check unavailable:</strong> Gemini Key expired / invalid</span>
                              </div>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-200 text-rose-900 font-mono font-bold">
                                GEMINI_KEY_EXPIRED
                              </span>
                            </div>
                          )}

                          {/* GRAMMAR SUGGESTIONS CHIP (Gemini Powered) */}
                          {aiReport.grammar_suggestions && aiReport.grammar_suggestions.filter((g) => g.type !== 'grammar_error').length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-purple-800 bg-purple-100 border border-purple-200 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                  <Sparkles className="w-3 h-3 text-purple-600" />
                                  Grammar Suggestion
                                </span>
                                <span className="text-[11px] text-purple-700 font-medium">
                                  Yahan kya sudhar sakte ho:
                                </span>
                              </div>
                              <div className="space-y-1">
                                {aiReport.grammar_suggestions
                                  .filter((g) => g.type !== 'grammar_error')
                                  .map((g, idx) => (
                                    <div
                                      key={idx}
                                      className="text-xs px-3 py-2 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 flex flex-col gap-0.5"
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
                          {bannedWords.length > 0 && (
                            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                              <AlertOctagon className="w-4 h-4 shrink-0 text-rose-600" />
                              <span>
                                <strong>Banned Brand Words Found:</strong> {bannedWords.join(', ')}
                              </span>
                            </div>
                          )}

                          {/* MISSING MANDATORY PHRASE ALERT */}
                          {missingMandatory.length > 0 && (
                            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                              <span>
                                <strong>Missing Required Phrase:</strong> {missingMandatory.join(', ')}
                              </span>
                            </div>
                          )}

                          {/* BRAND IDENTITY ALERTS */}
                          {aiReport.brand_identity_check?.possible_brand_name_error && (
                            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                              <AlertOctagon className="w-4 h-4 shrink-0 text-rose-600" />
                              <span>
                                <strong>Brand Name Mismatch:</strong> {aiReport.brand_identity_check.possible_brand_name_error}
                              </span>
                            </div>
                          )}

                          {aiReport.brand_identity_check?.phone_verification?.filter((p) => p.status !== 'clean').map((pv, idx) => (
                            <div key={idx} className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                              <Phone className="w-4 h-4 shrink-0 text-rose-600" />
                              <span>
                                <strong>Phone Mismatch Alert:</strong> {pv.message}
                              </span>
                            </div>
                          ))}

                          {/* SPELLING ISSUES (Devanagari + Latin) */}
                          {spellingIssues.length > 0 ? (
                            <div className="space-y-1.5 pt-1">
                              <p className="text-xs text-rose-700 font-semibold">
                                Spelling issues found ({spellingIssues.length}):
                              </p>
                              <div className="space-y-1">
                                {spellingIssues.map((issue, idx) => (
                                  <div
                                    key={idx}
                                    className="text-xs px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between"
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
                                        Sugest: {issue.suggestions.slice(0, 3).join(', ')}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-emerald-800 flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
                              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                              <span>No Hindi or English spelling issues were found. Whitelisted words are accepted.</span>
                            </p>
                          )}

                          {/* IMAGE CHECK SECTION: SKELETON / RETRY / OCR RESULT */}
                          {imgSrc && (
                            <div className="pt-2 border-t border-[#E5E2DA] space-y-2">
                              {aiReport.image_status === 'pending' ? (
                                <ImageCheckSkeleton status="pending" />
                              ) : aiReport.image_status === 'failed' ? (
                                <ImageCheckSkeleton
                                  status="failed"
                                  errorMessage={aiReport.image_error}
                                  onRetry={() => handleRetryImageCheck(post.id)}
                                  isRetrying={retryingPosts.has(post.id)}
                                />
                              ) : (
                                <div className="space-y-3 transition-all duration-500 ease-in-out opacity-100">
                                  <AnnotatedPosterOCR
                                    imgSrc={imgSrc}
                                    boxes={aiReport.ocr_issues || []}
                                    ocrConfidence={aiReport.ocr_confidence}
                                    rawOcrText={ocrText}
                                    realErrors={spellingIssues.filter((s) => s.source === 'image')}
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {/* Manual Review Alert */}
                          {post.manual_review_required && (
                            <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-xl font-semibold">
                              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                              <span>
                                AI recheck limit reached (3/3). The Manager must review this post manually.
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* WORKFLOW ACTION BAR */}
                      <div className="pt-3 border-t border-[#E5E2DA] flex flex-wrap items-center gap-3">
                        {/* Status: rejected */}
                        {post.status === 'rejected' && (
                          <div className="w-full text-xs text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-xl flex items-center gap-2">
                            <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
                            <span><strong>Post Rejected:</strong> Reviewers have rejected this post.</span>
                          </div>
                        )}

                        {/* Status: changes_requested */}
                        {post.status === 'changes_requested' && (
                          <div className="w-full text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-xl flex items-center gap-2">
                            <RotateCcw className="w-4 h-4 shrink-0 text-amber-600" />
                            <span><strong>Changes Requested:</strong> The reviewer requested changes. Revise and resubmit the post.</span>
                          </div>
                        )}

                        {/* Status: ai_checking or changes_requested -> Revise & Submit buttons */}
                        {(post.status === 'ai_checking' || post.status === 'changes_requested') && (
                          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
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
                          <div className="text-xs text-amber-800 font-medium flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Submitted: Waiting for Manager review...</span>
                          </div>
                        )}

                        {/* Status: pending_admin */}
                        {post.status === 'pending_admin' && (
                          <div className="text-xs text-purple-800 font-medium flex items-center gap-1.5 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-xl">
                            <Clock className="w-3.5 h-3.5 text-purple-600" />
                            <span>Manager Approved: Waiting for final Admin approval...</span>
                          </div>
                        )}

                        {/* Status: admin_approved -> Select Platform (Client-Scoped) */}
                        {post.status === 'admin_approved' && (
                          <div className="w-full space-y-2">
                            <div className="text-xs text-sky-800 font-semibold flex items-center gap-1">
                              <span>Admin approved. Select one of this client's connected social accounts:</span>
                            </div>

                            {clientConnectedAccounts.length === 0 ? (
                              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                                <span>
                                  <strong>This client has no connected social accounts.</strong> Ask an Admin to connect one first.
                                </span>
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
                                  className="px-3 py-1.5 rounded-lg bg-white border border-[#E5E2DA] text-xs text-[#2B2A27] focus:outline-none focus:border-sky-500 cursor-pointer shadow-xs font-semibold"
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
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                            <input
                              type="url"
                              value={liveUrls[post.id] || ''}
                              onChange={(e) =>
                                setLiveUrls({ ...liveUrls, [post.id]: e.target.value })
                              }
                              placeholder="Paste published URL (e.g. https://instagram.com/p/...)"
                              className="flex-1 px-3 py-1.5 rounded-xl bg-[#FAF9F6] border border-[#E5E2DA] text-xs text-[#2B2A27] placeholder-[#A8A29E] focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                            />
                            <Button
                              size="sm"
                              variant="primary"
                              leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                              loading={activeActionId === `publish-${post.id}`}
                              disabled={activeActionId !== null}
                              onClick={() => handlePublishUrlSubmit(post.id)}
                            >
                              Publish Complete
                            </Button>
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
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* REVISION MODAL */}
        {editingPost && (
          <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFFFF] border border-[#E5E2DA] rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl shadow-stone-900/10">
              <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-3">
                <h3 className="font-bold text-[#2B2A27] text-base">
                  Revise Post #{editingPost.id} (Attempt {editingPost.recheck_count + 1}/3)
                </h3>
                <button
                  onClick={() => setEditingPost(null)}
                  className="text-[#6B6A63] hover:text-[#2B2A27] text-sm cursor-pointer"
                >
                  ✕
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
                    Recheck & Save Revision
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
