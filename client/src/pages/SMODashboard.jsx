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
} from 'lucide-react';

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
      showToast('Clients list load karne mein samasya aayi.', 'error');
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
      showToast('Posts list load karne mein samasya aayi. Kripya refresh karein.', 'error');
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
      showToast('Kripya post ke liye Client chunein.', 'warning');
      return;
    }

    if (!title.trim()) {
      showToast('Kripya post ka title likhein.', 'warning');
      return;
    }

    if (!caption.trim()) {
      showToast('Kripya post ke liye caption likhein.', 'warning');
      return;
    }

    if (!selectedFile) {
      showToast('Kripya post ke liye ek creative image upload karein.', 'warning');
      return;
    }

    setCreatingPost(true);
    try {
      const formData = new FormData();
      formData.append('client_id', selectedClientId);
      formData.append('title', title.trim());
      formData.append('caption', caption.trim());
      formData.append('image', selectedFile);

      await postService.createPost(formData);
      showToast('Post create ho gaya aur Bilingual + Brand AI check complete ho gaya!', 'success');

      // Clear form
      setTitle('');
      setCaption('');
      handleRemoveImage();

      // Refresh posts list
      fetchPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Post create karne mein samasya aayi. Kripya dobara try karein.';
      showToast(msg, 'error');
    } finally {
      setCreatingPost(false);
    }
  };

  // Open Revision Modal
  const startRevising = (post) => {
    if (post.recheck_count >= 3 || post.manual_review_required) {
      showToast('Aap 3 recheck attempts use kar chuke hain. Ab direct Manager review hoga.', 'warning');
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
      showToast('Title khali nahi ho sakta.', 'warning');
      return;
    }

    if (!reviseCaption.trim()) {
      showToast('Caption khali nahi ho sakta.', 'warning');
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

      await postService.revisePost(editingPost.id, formData);
      showToast('Revision submit ho gaya aur AI recheck complete ho gaya!', 'success');

      setEditingPost(null);
      setReviseTitle('');
      setReviseCaption('');
      setReviseFile(null);
      setRevisePreview(null);
      fetchPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Revision submit karne mein samasya aayi.';
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
      showToast('Post Manager review ke liye bhej diya gaya hai!', 'success');
      fetchPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Submit karne mein samasya aayi.';
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
      showToast(`Platform "${platform}" set ho gaya! Ab live post link paste karein.`, 'success');
      fetchPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Platform update karne mein samasya aayi.';
      showToast(msg, 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Submit Live Published URL
  const handlePublishUrlSubmit = async (postId) => {
    const url = (liveUrls[postId] || '').trim();
    if (!url) {
      showToast('Kripya published live post ka URL daalein.', 'warning');
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      showToast('URL sahi format mein hona chahiye (http:// ya https:// se shuru ho).', 'warning');
      return;
    }

    setActiveActionId(`publish-${postId}`);
    try {
      await postService.updatePublishUrl(postId, url);
      showToast('Live link save ho gaya! Post workflow successfully complete ho gaya.', 'success');
      fetchPosts();
    } catch (err) {
      const msg = err.response?.data?.message || 'Live URL save karne mein samasya aayi.';
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
              Draft for clients, verify Bilingual AI checks (Hindi + English + Brand Rules), and manage live publishing.
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
                      Koi active client nahi mila. Pehle Admin se client add karwayein.
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
                    placeholder="Type post copy in English or Hindi (Devanagari)... Spelling, OCR, and Client Brand Guidelines will be verified automatically."
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
                  Create & Run AI Quality Check
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
                <h4 className="text-base font-semibold text-[#2B2A27]">Abhi koi post create nahi hua hai</h4>
                <p className="text-xs text-[#6B6A63] mt-1 max-w-sm mx-auto">
                  Left side ke form se client select karein aur pehla creative submit karein.
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
                              Bilingual AI & Brand Rules Check
                            </span>
                            <span className="text-[11px] text-[#6B6A63] font-mono">
                              Rechecks: {post.recheck_count}/3
                            </span>
                          </div>

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
                              <span>Bilingual spelling clean hai (Whitelist words honored).</span>
                            </p>
                          )}

                          {/* OCR Extracted Text (Eng + Hin) */}
                          {ocrText && (
                            <div className="text-xs text-[#6B6A63] pt-2 border-t border-[#E5E2DA] space-y-1">
                              <span className="font-semibold text-[#2B2A27] flex items-center gap-1">
                                <Quote className="w-3 h-3 text-emerald-600" />
                                Image OCR Text (English + Hindi):
                              </span>
                              <div className="p-2.5 rounded-xl bg-white border border-[#E5E2DA] font-mono text-[#2B2A27] text-[11px] leading-relaxed">
                                "{ocrText}"
                              </div>
                            </div>
                          )}

                          {/* Manual Review Alert */}
                          {post.manual_review_required && (
                            <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-xl font-semibold">
                              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                              <span>
                                AI recheck limit khatam (3/3). Ab Manager manually dekh kar hi approve karenge.
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
                            <span><strong>Post Rejected:</strong> Yeh post reviewers dwara reject ho chuka hai.</span>
                          </div>
                        )}

                        {/* Status: changes_requested */}
                        {post.status === 'changes_requested' && (
                          <div className="w-full text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-xl flex items-center gap-2">
                            <RotateCcw className="w-4 h-4 shrink-0 text-amber-600" />
                            <span><strong>Changes Requested:</strong> Reviewer ne changes maange hain. Post revise karke submit karein.</span>
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
                            <span>Submitted: Manager ke review ka intezaar hai...</span>
                          </div>
                        )}

                        {/* Status: pending_admin */}
                        {post.status === 'pending_admin' && (
                          <div className="text-xs text-purple-800 font-medium flex items-center gap-1.5 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-xl">
                            <Clock className="w-3.5 h-3.5 text-purple-600" />
                            <span>Manager Approved: Final Admin approval ka intezaar hai...</span>
                          </div>
                        )}

                        {/* Status: admin_approved -> Select Platform (Client-Scoped) */}
                        {post.status === 'admin_approved' && (
                          <div className="w-full space-y-2">
                            <div className="text-xs text-sky-800 font-semibold flex items-center gap-1">
                              <span>Admin Approved! Ab is client ke connected social accounts mein se choose karein:</span>
                            </div>

                            {clientConnectedAccounts.length === 0 ? (
                              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                                <span>
                                  <strong>Is client ka koi social account connect nahi hai</strong>, pehle Admin se connect karwayein.
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
