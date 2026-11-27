import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  ArrowLeft,
  ShieldCheck,
  AlertOctagon,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Clock,
  RefreshCw,
  Send,
  Check,
  X,
  FileText,
  Sparkles,
  Building2,
  User,
  Phone,
  Trash2,
  Calendar,
  Layers,
  Copy,
  Image as ImageIcon,
} from 'lucide-react';

import AnnotatedPosterOCR from '../components/AnnotatedPosterOCR';
import LogoCheckCard from '../components/LogoCheckCard';
import ImageCheckSkeleton from '../components/ImageCheckSkeleton';
import ImageUpload from '../components/ImageUpload';
import Button from '../components/Button';
import postService from '../services/postService';
import { SERVER_URL } from '../utils/constants';
import { formatDate } from '../utils/helpers';

const PostInspection = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { showToast } = useToast();

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeActionId, setActiveActionId] = useState(null);
  const [isRetryingImage, setIsRetryingImage] = useState(false);

  // Revision state & modal
  const [editingPost, setEditingPost] = useState(null);
  const [reviseTitle, setReviseTitle] = useState('');
  const [reviseCaption, setReviseCaption] = useState('');
  const [reviseFile, setReviseFile] = useState(null);
  const [revisePreview, setRevisePreview] = useState(null);

  // Manager Reject state & modal
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Yellow Zone Confirmation modal & Manager acknowledgment
  const [yellowModalOpen, setYellowModalOpen] = useState(false);
  const [managerAck, setManagerAck] = useState(false);

  // Fetch full post details
  const fetchPostDetails = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await postService.getPostById(id);
      if (res.success && res.post) {
        setPost(res.post);
      } else {
        showToast('Post details nahi mil payi.', 'error');
      }
    } catch (err) {
      console.error('Error fetching post:', err);
      showToast(err.response?.data?.message || 'Failed to load post details.', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    fetchPostDetails();
  }, [fetchPostDetails]);

  // Background AI status polling if post's image OCR check is still pending
  useEffect(() => {
    if (!post) return;
    const isImagePending = post.latest_ai_check?.image_status === 'pending';

    if (!isImagePending) return;

    const interval = setInterval(async () => {
      try {
        const res = await postService.getAiStatus(id);
        if (res && res.image_status && res.image_status !== 'pending') {
          // Image check has completed or failed! Fetch fresh post details
          fetchPostDetails(true);
        }
      } catch (err) {
        console.warn('Status poll error:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [id, post?.latest_ai_check?.image_status, fetchPostDetails]);

  // Handle Retry Image Check
  const handleRetryImageCheck = async () => {
    setIsRetryingImage(true);
    try {
      await postService.checkImage(id);
      showToast('Retrying image check in background...', 'info');
      fetchPostDetails(true);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to retry image check.', 'error');
    } finally {
      setIsRetryingImage(false);
    }
  };

  // Handle Submit for Review (SMO)
  const handleSubmitForReview = async (overrideYellow = false) => {
    const enforcementState = post?.latest_ai_check?.enforcement_state || 'green_clean';
    if (enforcementState === 'red_block') {
      showToast('Submission Blocked: Post me critical brand compliance violations hain. Kripya pehle post revise karein.', 'error');
      return;
    }

    if (enforcementState === 'yellow_alert' && !overrideYellow) {
      setYellowModalOpen(true);
      return;
    }

    setActiveActionId(`submit-${id}`);
    try {
      await postService.submitForReview(id, { confirm_yellow_override: overrideYellow });
      showToast('Post Manager review ke liye submit kar diya gaya.', 'success');
      setYellowModalOpen(false);
      fetchPostDetails(true);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to submit post.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Handle Approve (Manager / Admin)
  const handleApprove = async () => {
    const enforcementState = post?.latest_ai_check?.enforcement_state || 'green_clean';
    if (enforcementState === 'red_block') {
      showToast('Cannot approve post: Post has unresolved RED BLOCK violations.', 'error');
      return;
    }
    if (enforcementState === 'yellow_alert' && !managerAck) {
      showToast('Kripya Yellow Zone warning ko acknowledge checkbox tick karein.', 'warning');
      return;
    }

    setActiveActionId(`approve-${id}`);
    try {
      const payload = { action: 'approve', manager_acknowledged: managerAck };
      if (role === 'admin') {
        await postService.adminReview(id, payload);
      } else {
        await postService.managerReview(id, payload);
      }
      showToast('Post approve kar diya gaya hai.', 'success');
      fetchPostDetails(true);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to approve post.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Handle Reject (Manager / Admin)
  const handleReject = async () => {
    if (!rejectReason.trim()) {
      showToast('Kripya rejection ka reason likhein.', 'warning');
      return;
    }
    setActiveActionId(`reject-${id}`);
    try {
      if (role === 'admin') {
        await postService.adminReview(id, { action: 'reject', comment: rejectReason });
      } else {
        await postService.managerReview(id, { action: 'reject', comment: rejectReason });
      }
      showToast('Post reject kar diya gaya.', 'success');
      setRejectModalOpen(false);
      setRejectReason('');
      fetchPostDetails(true);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to reject post.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Handle Delete
  const handleDeletePost = async () => {
    if (!window.confirm('Kya aap sach me is post ko delete karna chahte hain?')) return;
    setActiveActionId(`delete-${id}`);
    try {
      await postService.deletePost(id);
      showToast('Post delete ho gaya.', 'success');
      navigate(role === 'manager' ? '/manager' : role === 'admin' ? '/admin' : '/smo');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete post.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Open Revise Modal
  const handleOpenReviseModal = () => {
    setReviseTitle(post.title || '');
    setReviseCaption(post.caption || '');
    setReviseFile(null);
    setRevisePreview(
      post.image_path ? `${SERVER_URL}/${post.image_path}` : null
    );
    setEditingPost(post);
  };

  // Submit Revision
  const handleReviseSubmit = async (e) => {
    e.preventDefault();
    if (!reviseCaption.trim()) {
      showToast('Caption khali nahi ho sakta.', 'warning');
      return;
    }
    setActiveActionId(`revise-${id}`);
    const formData = new FormData();
    formData.append('title', reviseTitle);
    formData.append('caption', reviseCaption);
    if (reviseFile) {
      formData.append('image', reviseFile);
    }
    try {
      await postService.revisePost(id, formData);
      showToast('Revision submit ho gaya. AI re-check shuru ho chuka hai.', 'success');
      setEditingPost(null);
      fetchPostDetails(true);
    } catch (err) {
      showToast(err.response?.data?.message || 'Revision submit nahi ho paya.', 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  // Copy text helper
  const handleCopyText = (txt) => {
    navigator.clipboard.writeText(txt);
    showToast('Copied to clipboard!', 'info');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F5F2] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-stone-600">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-sm font-semibold">Post Details &amp; AI Analysis load ho rahi hain...</p>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-[#F6F5F2] flex items-center justify-center p-6">
        <div className="bg-white border border-[#E5E2DA] rounded-3xl p-8 max-w-md w-full text-center space-y-4 shadow-sm">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-lg font-bold text-[#2B2A27]">Post Not Found</h2>
          <p className="text-xs text-[#6B6A63]">ID #{id} wala post nahi mila ya access restricted hai.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(role === 'manager' ? '/manager' : role === 'admin' ? '/admin' : '/smo')}
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const latestAi = post.latest_ai_check || {};
  const isImagePending = latestAi.image_status === 'pending';
  const isImageFailed = latestAi.image_status === 'failed';
  const imgSrc = post.image_path ? `${SERVER_URL}/${post.image_path.replace(/^[/\\]+/, '')}` : null;
  const refLogoSrc = post.reference_logo_url ? `${SERVER_URL}/${post.reference_logo_url.replace(/^[/\\]+/, '')}` : null;
  const spellingIssues = latestAi.spelling_issues || [];
  const textSpellingIssues = spellingIssues.filter((s) => (s.source || 'text') === 'text');
  const imageSpellingIssues = spellingIssues.filter((s) => s.source === 'image');
  const grammarSuggestions = latestAi.grammar_suggestions || [];
  const bannedWords = latestAi.banned_words_found || [];
  const missingPhrases = latestAi.missing_mandatory_phrases || [];
  const brandCheck = latestAi.brand_identity_check || null;

  return (
    <div className="min-h-screen bg-[#F6F5F2] text-[#2B2A27] pb-16 font-sans">
      {/* Top Sticky Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-[#E5E2DA] px-4 sm:px-8 py-3.5 shadow-2xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(role === 'manager' ? '/manager' : role === 'admin' ? '/admin' : '/smo')}
              className="p-2 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] hover:bg-stone-100 text-[#2B2A27] transition-all cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
              title="Back to Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>

            <div className="h-6 w-[1px] bg-[#E5E2DA]" />

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-bold bg-stone-100 px-2.5 py-1 rounded-lg text-stone-700 border border-stone-200">
                #{post.id}
              </span>
              <span className="text-sm font-bold text-[#2B2A27] truncate max-w-[200px] sm:max-w-md">
                {post.title}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                <Building2 className="w-3 h-3 text-emerald-600" />
                {post.client_name || 'Client'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                post.status === 'approved'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : post.status === 'rejected'
                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                  : post.status === 'ai_checking'
                  ? 'bg-sky-100 text-sky-800 border border-sky-300'
                  : 'bg-amber-100 text-amber-900 border border-amber-300'
              }`}
            >
              {post.status.replace('_', ' ')}
            </span>
          </div>
        </div>
      </header>

      {/* Main 2-Column Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 space-y-5">
        {/* Inspection Engines Transparency Audit Banner */}
        <div className="bg-white rounded-2xl p-3.5 border border-[#E5E2DA] shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-[#2B2A27]">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>Inspection Engine Audit:</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Visual OCR Engine */}
            <div className="px-2.5 py-1 rounded-lg bg-stone-50 border border-stone-200 flex items-center gap-1.5 text-[11px]">
              <span className="text-stone-500 font-medium">Visual OCR:</span>
              <span className="font-bold text-stone-800 font-mono">
                {latestAi.ocr_engine === 'openrouter_multimodal'
                  ? '🤖 OpenRouter AI (Fallback 1)'
                  : latestAi.ocr_engine === 'gemini_multimodal' || latestAi.ocr_engine === 'gemini_ai'
                  ? '🌟 Google Gemini Vision (Primary)'
                  : '⚡ A2 PaddleOCR (Backup)'}
              </span>
            </div>

            {/* Logo Check Engine */}
            <div className="px-2.5 py-1 rounded-lg bg-stone-50 border border-stone-200 flex items-center gap-1.5 text-[11px]">
              <span className="text-stone-500 font-medium">Logo Check:</span>
              <span className="font-bold text-stone-800 font-mono">
                {latestAi.logo_check?.checked_by === 'Gemini'
                  ? '🌟 Google Gemini'
                  : latestAi.logo_check?.checked_by === 'OpenRouter'
                  ? '🤖 OpenRouter AI'
                  : latestAi.logo_check?.checked_by === 'Python'
                  ? '⚡ Python Matcher'
                  : latestAi.logo_check?.status === 'SKIPPED'
                  ? '⚪ Skipped'
                  : (latestAi.ai_provider || 'AI Engine')}
              </span>
            </div>

            {/* Text Language Engine */}
            <div className="px-2.5 py-1 rounded-lg bg-stone-50 border border-stone-200 flex items-center gap-1.5 text-[11px]">
              <span className="text-stone-500 font-medium">Grammar &amp; Spelling:</span>
              <span className="font-bold text-stone-800 font-mono">
                {latestAi.ai_provider === 'openrouter'
                  ? '🤖 OpenRouter AI'
                  : latestAi.ai_provider === 'dictionary'
                  ? '📚 Local Dictionary'
                  : '🌟 Google Gemini'}
              </span>
            </div>

            {/* Brand Rules Engine */}
            <div className="px-2.5 py-1 rounded-lg bg-stone-50 border border-stone-200 flex items-center gap-1.5 text-[11px]">
              <span className="text-stone-500 font-medium">Brand Compliance:</span>
              <span className="font-bold text-emerald-800 font-mono">🛡️ Rules Engine</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ======================================================== */}
          {/* LEFT COLUMN: Visual Poster OCR & Dedicated Logo Check   */}
          {/* ======================================================== */}
          <div className="lg:col-span-7 space-y-5">
            {/* Poster OCR Section */}
            <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#E5E2DA]">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#2B2A27]">
                    Poster Visual OCR Analysis
                  </span>
                </div>
                {latestAi.ocr_confidence > 0 && (
                  <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Confidence: {Math.round(latestAi.ocr_confidence)}%
                  </span>
                )}
              </div>

              {imgSrc ? (
                isImagePending ? (
                  <ImageCheckSkeleton status="pending" />
                ) : isImageFailed ? (
                  <ImageCheckSkeleton
                    status="failed"
                    errorMessage={latestAi.image_error}
                    onRetry={handleRetryImageCheck}
                    isRetrying={isRetryingImage}
                  />
                ) : (
                  <AnnotatedPosterOCR
                    imgSrc={imgSrc}
                    boxes={latestAi.ocr_issues || []}
                    ocrConfidence={latestAi.ocr_confidence}
                    rawOcrText={latestAi.ocr_extracted_text}
                    realErrors={spellingIssues.filter((s) => s.source === 'image')}
                    ocrEngine={latestAi.ocr_engine}
                    fallbackUsed={latestAi.fallback_used}
                  />
                )
              ) : (
                <div className="p-8 text-center bg-[#FAF9F6] border border-[#E5E2DA] rounded-2xl text-xs text-[#6B6A63]">
                  Is post me koi image / poster upload nahi hai (Text-Only Post).
                </div>
              )}
            </div>

            {/* Dedicated Brand Logo Verification Card */}
            {imgSrc && (
              <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-2">
                <LogoCheckCard
                  logoCheck={latestAi.logo_check}
                  aiProvider={latestAi.ai_provider}
                  fallbackUsed={latestAi.fallback_used}
                  referenceLogoUrl={refLogoSrc}
                />
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* RIGHT COLUMN: Post Copy, AI Issues & Workflow Actions    */}
          {/* ======================================================== */}
          <div className="lg:col-span-5 space-y-5">
            {/* Post Title & Caption Card */}
            <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#E5E2DA]">
                <span className="text-xs font-bold uppercase tracking-wider text-[#6B6A63]">
                  Post Copy &amp; Metadata
                </span>
                <span className="text-[11px] text-[#6B6A63] flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDate(post.created_at)}
                </span>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-[#8C8B85] uppercase tracking-wider block mb-1">
                  Campaign Title
                </span>
                <h3 className="text-base font-bold text-[#2B2A27]">{post.title}</h3>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-[#8C8B85] uppercase tracking-wider">
                    Post Caption / Body
                  </span>
                  {post.caption && (
                    <button
                      onClick={() => handleCopyText(post.caption)}
                      className="text-[11px] text-emerald-700 hover:text-emerald-800 flex items-center gap-1 font-semibold cursor-pointer"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  )}
                </div>
                <div className="p-3.5 rounded-2xl bg-[#FAF9F6] border border-[#E5E2DA] text-xs text-[#2B2A27] whitespace-pre-wrap leading-relaxed font-sans max-h-48 overflow-y-auto">
                  {post.caption || <span className="italic text-[#A8A29E]">No caption provided.</span>}
                </div>
              </div>
            </div>

            {/* Brand Identity & Guidelines Checks */}
            {brandCheck && (
              <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#6B6A63] block pb-2 border-b border-[#E5E2DA]">
                  Brand Compliance Check
                </span>

                {/* Brand Name Match */}
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-700">Official Brand Name Match:</span>
                    <span
                      className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                        brandCheck.brand_name_correct
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      Score: {brandCheck.brand_name_match_score || 0}%
                    </span>
                  </div>
                  {brandCheck.matched_brand_text && (
                    <p className="text-[11px] text-stone-600">
                      Found in OCR: <span className="font-semibold">{brandCheck.matched_brand_text}</span>
                    </p>
                  )}
                  {brandCheck.possible_brand_name_error && (
                    <p className="text-xs text-rose-700 font-semibold mt-1">
                      ⚠️ {brandCheck.possible_brand_name_error}
                    </p>
                  )}
                </div>

                {/* Phone Verification */}
                {Array.isArray(brandCheck.phone_verification) &&
                  brandCheck.phone_verification.length > 0 && (
                    <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1 text-xs">
                      <span className="font-semibold text-stone-700 block">Phone Verification:</span>
                      {brandCheck.phone_verification.map((pv, pIdx) => (
                        <div key={pIdx} className="text-[11px] text-stone-600 flex items-center gap-1.5">
                          <Phone className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>{pv.message || `${pv.found_phone} verified`}</span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {/* Banned Words Alert */}
            {bannedWords.length > 0 && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-2">
                <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                  <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Banned Words Detected ({bannedWords.length}):</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {bannedWords.map((word, wIdx) => (
                    <span
                      key={wIdx}
                      className="px-2 py-0.5 rounded-md bg-rose-200/80 text-rose-900 text-xs font-semibold"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Missing Mandatory Phrases */}
            {missingPhrases.length > 0 && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Mandatory Phrases Missing ({missingPhrases.length}):</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {missingPhrases.map((phrase, pIdx) => (
                    <span
                      key={pIdx}
                      className="px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-950 text-xs font-semibold"
                    >
                      {phrase}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Linguistic Quality: Spelling & Grammar Cards */}
            <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-[#6B6A63] block pb-2 border-b border-[#E5E2DA]">
                AI Linguistic &amp; Copy Quality
              </span>

              {/* 1. Caption & Title Text Spelling */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-stone-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <FileText className="w-3.5 h-3.5 text-stone-500" />
                    <span>Caption &amp; Title Spelling</span>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
                      {latestAi.ai_provider === 'openrouter'
                        ? '🤖 OpenRouter AI (Fallback 1)'
                        : latestAi.ai_provider === 'dictionary'
                        ? '📚 Node Local Dictionary (Backup)'
                        : '🌟 Google Gemini AI (Primary)'}
                    </span>
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      textSpellingIssues.length > 0
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {textSpellingIssues.length === 0 ? '0 (Clean)' : textSpellingIssues.length}
                  </span>
                </span>

                {textSpellingIssues.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {textSpellingIssues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-rose-50/70 border border-rose-200 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-rose-900 line-through">
                            {issue.word || issue.original}
                          </span>
                          <span className="text-emerald-700">
                            {issue.suggestions?.length > 0
                              ? `→ ${issue.suggestions.slice(0, 3).join(', ')}`
                              : issue.suggestion
                              ? `→ ${issue.suggestion}`
                              : 'No suggestions'}
                          </span>
                        </div>
                        {issue.reason && (
                          <p className="text-[11px] text-stone-600">{issue.reason}</p>
                        )}
                        <span className="inline-block text-[9px] uppercase tracking-wider font-semibold text-rose-700 bg-rose-100/60 px-1.5 py-0.5 rounded">
                          Found in Caption / Title
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Caption &amp; Title text me 0 spelling mistakes hain.</span>
                  </div>
                )}
              </div>

              {/* 2. Poster Image Spelling (OCR Visual) */}
              <div className="space-y-2 pt-2 border-t border-[#E5E2DA]">
                <span className="text-xs font-bold text-stone-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <ImageIcon className="w-3.5 h-3.5 text-stone-500" />
                    <span>Poster Image Spelling (OCR)</span>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
                      {latestAi.ocr_engine === 'openrouter_multimodal'
                        ? '🤖 OpenRouter AI (Fallback 1)'
                        : latestAi.ocr_engine === 'gemini_multimodal' || latestAi.ocr_engine === 'gemini_ai'
                        ? '🌟 Google Gemini Vision (Primary)'
                        : '⚡ A2 PaddleOCR + Dictionary (Backup)'}
                    </span>
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      imageSpellingIssues.length > 0
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {imageSpellingIssues.length === 0 ? '0 (Clean)' : imageSpellingIssues.length}
                  </span>
                </span>

                {imageSpellingIssues.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {imageSpellingIssues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-rose-50/70 border border-rose-200 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-rose-900 line-through">
                            {issue.word || issue.original}
                          </span>
                          <span className="text-emerald-700">
                            {issue.suggestions?.length > 0
                              ? `→ ${issue.suggestions.slice(0, 3).join(', ')}`
                              : issue.suggestion
                              ? `→ ${issue.suggestion}`
                              : 'No suggestions'}
                          </span>
                        </div>
                        {issue.reason && (
                          <p className="text-[11px] text-stone-600">{issue.reason}</p>
                        )}
                        <span className="inline-block text-[9px] uppercase tracking-wider font-semibold text-stone-500 bg-white px-1.5 py-0.5 rounded border border-stone-200">
                          Found in Poster (OCR)
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Poster image text me koi spelling issue nahi mila.</span>
                  </div>
                )}
              </div>

              {/* Grammar Suggestions */}
              <div className="space-y-2 pt-2 border-t border-[#E5E2DA]">
                <span className="text-xs font-bold text-stone-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span>Grammar &amp; Punctuation</span>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
                      {latestAi.ai_provider === 'openrouter'
                        ? '🤖 OpenRouter AI (Fallback 1)'
                        : '🌟 Google Gemini AI (Primary)'}
                    </span>
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      grammarSuggestions.length > 0
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {grammarSuggestions.length}
                  </span>
                </span>

                {grammarSuggestions.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {grammarSuggestions.map((g, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-amber-950">{g.original}</span>
                          <span className="text-emerald-700">→ {g.suggestion}</span>
                        </div>
                        {g.reason && (
                          <p className="text-[11px] text-stone-600">{g.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Grammar and tone are clean.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Workflow Actions Section */}
            <div className="bg-white rounded-3xl p-5 border border-[#E5E2DA] shadow-xs space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#6B6A63] block pb-2 border-b border-[#E5E2DA]">
                Workflow &amp; Approval Actions
              </span>

              {/* Strict 2-Tier Enforcement Gate Banners */}
              {post.latest_ai_check?.enforcement_state === 'red_block' && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-300 text-rose-950 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-rose-900">
                      Submission Blocked (RED BLOCK)
                    </span>
                  </div>

                  {/* Clarification on Logo Status */}
                  {post.latest_ai_check?.logo_check?.status === 'PASS' && (
                    <div className="text-[11px] font-medium text-emerald-800 bg-emerald-50/80 border border-emerald-200 px-2 py-1 rounded-lg flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                      <span><strong>Logo Check PASS:</strong> Logo mil gaya hai ({post.latest_ai_check.logo_check.location_hindi || post.latest_ai_check.logo_check.location || 'Top-Left'}). Block poster ke content/spelling ki wajah se hai.</span>
                    </div>
                  )}

                  {/* Dynamic Violation Reasons */}
                  <div className="text-xs text-rose-900 leading-relaxed space-y-1">
                    {Array.isArray(post.latest_ai_check?.enforcement_reasons) && post.latest_ai_check.enforcement_reasons.length > 0 ? (
                      post.latest_ai_check.enforcement_reasons.map((reason, idx) => (
                        <p key={idx} className="flex items-start gap-1.5">
                          <span className="font-semibold text-rose-600">•</span>
                          <span>{reason}</span>
                        </p>
                      ))
                    ) : (
                      <p>
                        {post.latest_ai_check?.summary ||
                          (post.latest_ai_check?.logo_check?.status === 'PASS'
                            ? 'Poster par spelling mistakes ya brand mismatch detect hua hai. Submit karne ke liye pehle revise karein.'
                            : 'Is post me critical brand compliance violations hain. Submit karne ke liye pehle revise karein.')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {post.latest_ai_check?.enforcement_state === 'yellow_alert' && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-900">
                      Yellow Zone Warning (Soft Gate)
                    </span>
                  </div>
                  <div className="text-xs text-amber-900 leading-relaxed space-y-1">
                    {Array.isArray(post.latest_ai_check?.enforcement_reasons) && post.latest_ai_check.enforcement_reasons.length > 0 ? (
                      post.latest_ai_check.enforcement_reasons.map((reason, idx) => (
                        <p key={idx} className="flex items-start gap-1.5">
                          <span className="font-semibold text-amber-600">•</span>
                          <span>{reason}</span>
                        </p>
                      ))
                    ) : (
                      <p>
                        {post.latest_ai_check?.summary || 'Client identity verify ho gayi hai. Is post ko review ke liye aage submit kiya ja sakta hai.'}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* SMO Actions */}
              {(role === 'smo' || role === 'admin') && (
                <div className="space-y-2">
                  {post.status !== 'approved' && post.status !== 'posted' && (
                    <Button
                      size="sm"
                      variant="primary"
                      className="w-full justify-center !py-2.5 font-bold"
                      leftIcon={<Send className="w-4 h-4" />}
                      loading={activeActionId === `submit-${post.id}`}
                      disabled={
                        activeActionId !== null ||
                        isImagePending ||
                        post.status === 'pending_manager' ||
                        post.latest_ai_check?.enforcement_state === 'red_block'
                      }
                      onClick={() => handleSubmitForReview(false)}
                    >
                      {post.status === 'pending_manager'
                        ? 'Already Submitted (In Review)'
                        : isImagePending
                        ? 'AI Image Check in Progress...'
                        : post.latest_ai_check?.enforcement_state === 'red_block'
                        ? '🚫 Submission Blocked (Fix Errors)'
                        : 'Submit for Manager Review'}
                    </Button>
                  )}

                  {post.recheck_count < 3 && post.status !== 'approved' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full justify-center !py-2"
                      leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                      disabled={activeActionId !== null || isImagePending}
                      onClick={handleOpenReviseModal}
                    >
                      Revise Post ({3 - post.recheck_count} attempts left)
                    </Button>
                  )}
                </div>
              )}

              {/* Manager Actions */}
              {(role === 'manager' || role === 'admin') && post.status === 'pending_manager' && (
                <div className="pt-2 flex flex-col gap-2">
                  {post.latest_ai_check?.enforcement_state === 'yellow_alert' && (
                    <label className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={managerAck}
                        onChange={(e) => setManagerAck(e.target.checked)}
                        className="mt-0.5 rounded text-amber-600 focus:ring-amber-500"
                      />
                      <span>
                        Maine Yellow Zone warning (partial branding) dekh li hai aur mai is post ko approve karne ke liye agree karta/karti hoon.
                      </span>
                    </label>
                  )}

                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full justify-center !py-2.5 !bg-emerald-600 hover:!bg-emerald-700 font-bold"
                    leftIcon={<Check className="w-4 h-4" />}
                    loading={activeActionId === `approve-${post.id}`}
                    disabled={
                      activeActionId !== null ||
                      (post.latest_ai_check?.enforcement_state === 'yellow_alert' && !managerAck) ||
                      post.latest_ai_check?.enforcement_state === 'red_block'
                    }
                    onClick={handleApprove}
                  >
                    Approve Post
                  </Button>

                  <Button
                    size="sm"
                    variant="danger"
                    className="w-full justify-center !py-2 font-semibold"
                    leftIcon={<X className="w-4 h-4" />}
                    disabled={activeActionId !== null}
                    onClick={() => setRejectModalOpen(true)}
                  >
                    Reject Post
                  </Button>
                </div>
              )}

              {/* Delete Option */}
              <div className="pt-2 border-t border-[#E5E2DA] flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="!text-rose-600 !border-rose-200 hover:!bg-rose-50 text-xs"
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                  loading={activeActionId === `delete-${post.id}`}
                  disabled={activeActionId !== null}
                  onClick={handleDeletePost}
                >
                  Delete Post
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ======================================================== */}
      {/* MODAL: REVISE POST                                      */}
      {/* ======================================================== */}
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
                  Post Title
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
                <Button variant="outline" size="sm" onClick={() => setEditingPost(null)}>
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

      {/* ======================================================== */}
      {/* MODAL: MANAGER REJECT POST                              */}
      {/* ======================================================== */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E2DA] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-3">
              <h3 className="font-bold text-[#2B2A27] text-base">Reject Post #{post.id}</h3>
              <button
                onClick={() => setRejectModalOpen(false)}
                className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-1.5">
                Rejection Reason
              </label>
              <textarea
                rows={3}
                placeholder="Reason likhein taaki creator ise theek kar sake..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-sm text-[#2B2A27] focus:border-rose-600 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setRejectModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={activeActionId === `reject-${post.id}`}
                disabled={activeActionId !== null || !rejectReason.trim()}
                onClick={handleReject}
              >
                Confirm Reject
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* ======================================================== */}
      {/* MODAL: YELLOW ZONE SMO SUBMISSION CONFIRMATION           */}
      {/* ======================================================== */}
      {yellowModalOpen && (
        <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E2DA] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E5E2DA] pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-[#2B2A27] text-base">Yellow Zone Confirmation</h3>
              </div>
              <button
                onClick={() => setYellowModalOpen(false)}
                className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 space-y-2">
              <p className="text-xs text-amber-900 leading-relaxed">
                Is post me <strong>Logo</strong> ya <strong>Official Brand Name</strong> me se sirf ek element detect hua hai. Dono complete nahi hain.
              </p>
              <p className="text-xs text-amber-900 font-semibold">
                Kya aap sure hain ki ise bina complete branding ke Manager Review ke liye submit karna chahte hain?
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setYellowModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="!bg-amber-600 hover:!bg-amber-700 font-bold"
                loading={activeActionId === `submit-${id}`}
                onClick={() => handleSubmitForReview(true)}
              >
                Confirm &amp; Submit Anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PostInspection;
